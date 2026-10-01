using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;
using Serilog.Events;
using Serilog.Parsing;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Wireal.Api.Logging;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class ProviderAndTokenTests
{
    [Theory]
    [InlineData(true, "app.example.com", "login", 0, true)]
    [InlineData(false, "app.example.com", "login", 0, false)]
    [InlineData(true, "evil.example.com", "login", 0, false)]
    [InlineData(true, "app.example.com", "register", 0, false)]
    [InlineData(true, "app.example.com", "login", -6, false)]
    [InlineData(true, "app.example.com", "login", 2, false)]
    public async Task TurnstileChecksSuccessHostnameActionAndAge(bool success, string hostname, string action, int ageMinutes, bool expected)
    {
        using var http = new HttpClient(new FakeHttp(async request =>
        {
            Assert.Equal("https://challenges.cloudflare.com/turnstile/v0/siteverify", request.RequestUri!.AbsoluteUri);
            var body = await request.Content!.ReadAsStringAsync();
            Assert.Contains("secret=secret", body);
            Assert.Contains("response=response-token", body);
            return Json(new { success, hostname, action, challenge_ts = DateTimeOffset.UtcNow.AddMinutes(ageMinutes) });
        }));
        var verifier = new TurnstileVerifier(http, new TurnstileSettings { SecretKey = "secret", Hostnames = ["app.example.com"] },
            TimeProvider.System, NullLogger<TurnstileVerifier>.Instance);
        Assert.Equal(expected, await verifier.VerifyAsync("response-token", "login", "127.0.0.1", default));
    }

    [Fact]
    public async Task TurnstileNetworkFailureFailsClosed()
    {
        using var http = new HttpClient(new FakeHttp(_ => throw new HttpRequestException("provider unavailable")));
        var verifier = new TurnstileVerifier(http, new TurnstileSettings(), TimeProvider.System, NullLogger<TurnstileVerifier>.Instance);
        Assert.False(await verifier.VerifyAsync("token", "login", null, default));
        Assert.False(await verifier.VerifyAsync(new string('a', 2049), "login", null, default));
    }

    [Fact]
    public async Task CloudflareEmailUsesConfiguredSenderAndChecksRecipientAcceptance()
    {
        using var http = new HttpClient(new FakeHttp(async request =>
        {
            Assert.Equal("https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/email/sending/send", request.RequestUri!.AbsoluteUri);
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            Assert.Equal("secret", request.Headers.Authorization.Parameter);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            Assert.Equal("accounts@example.com", body.RootElement.GetProperty("from").GetProperty("address").GetString());
            Assert.Equal("invited@example.com", body.RootElement.GetProperty("to")[0].GetString());
            // Both parts travel: a transactional message with no plain-text alternative, or
            // no HTML at all, is scored down before a recipient ever sees it.
            var html = body.RootElement.GetProperty("html").GetString()!;
            Assert.Contains("<img src=\"https://app.example.com/logo.png\"", html);
            Assert.Contains("https://api.example.com/auth/ui/#verify=example", html);
            Assert.Contains("invited@example.com", html);
            Assert.Contains("https://api.example.com/auth/ui/#verify=example", body.RootElement.GetProperty("text").GetString()!);
            return Json(new { success = true, result = new { queued = new[] { "invited@example.com" }, delivered = Array.Empty<string>() } });
        }));
        var sender = new CloudflareEmailSender(http, new CloudflareEmailSettings
        {
            AccountId = new string('a', 32), ApiToken = "secret", FromAddress = "accounts@example.com",
            LogoUrl = "https://app.example.com/logo.png"
        });
        await sender.SendAsync("invited@example.com", "https://api.example.com/auth/ui/#verify=example", default);
    }

    [Theory]
    [InlineData("{\"success\":false}", false)]
    [InlineData("{\"success\":true,\"result\":{\"queued\":[],\"delivered\":[],\"permanent_bounces\":[\"invited@example.com\"]}}", true)]
    [InlineData("{\"success\":true,\"result\":{\"queued\":[],\"delivered\":[],\"suppressed_recipients\":[\"invited@example.com\"]}}", true)]
    public async Task RejectedOrBouncedEmailIsNotReportedAsDelivered(string json, bool permanent)
    {
        using var http = new HttpClient(new FakeHttp(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json")
        })));
        var sender = new CloudflareEmailSender(http, new CloudflareEmailSettings { AccountId = new string('a', 32) });
        // Only a refusal the provider would repeat ends the outbox message; a
        // rejected request stays retryable.
        var failure = await Assert.ThrowsAsync<EmailDeliveryException>(
            () => sender.SendAsync("invited@example.com", "https://example.com", default));
        Assert.Equal(permanent, failure.Permanent);
    }

    [Theory]
    [InlineData("issuer")]
    [InlineData("audience")]
    [InlineData("key")]
    [InlineData("expired")]
    [InlineData("algorithm")]
    public void JwtRejectsInvalidSecurityProperties(string invalid)
    {
        var settings = Settings();
        var token = new JwtSecurityToken(
            invalid == "issuer" ? "https://evil.example" : settings.Issuer,
            invalid == "audience" ? "another-api" : settings.Audience,
            [new Claim("sub", Guid.NewGuid().ToString())], DateTime.UtcNow.AddHours(-1),
            invalid == "expired" ? DateTime.UtcNow.AddMinutes(-1) : DateTime.UtcNow.AddMinutes(10),
            new SigningCredentials(invalid == "key" ? Settings().Key() : settings.Key(),
                invalid == "algorithm" ? SecurityAlgorithms.HmacSha384 : SecurityAlgorithms.HmacSha256));
        var handler = new JwtSecurityTokenHandler();
        Assert.ThrowsAny<SecurityTokenException>(() => handler.ValidateToken(handler.WriteToken(token), settings.ValidationParameters(), out _));
    }

    [Fact]
    public void AccessTokenHasBoundedLifetimeAndSessionIdentifier()
    {
        var settings = Settings();
        var user = new AppUser { DisplayName = "A user" };
        var session = new AuthSession { User = user, ExpiresAt = DateTime.UtcNow.AddDays(30) };
        var issued = new TokenService(settings, TimeProvider.System).Access(user, session);
        var principal = new JwtSecurityTokenHandler { MapInboundClaims = false }.ValidateToken(issued.AccessToken, settings.ValidationParameters(), out _);
        Assert.Equal(user.Id.ToString(), principal.FindFirstValue("sub"));
        Assert.Equal(session.Id.ToString(), principal.FindFirstValue("sid"));
        Assert.InRange(issued.ExpiresIn, 1, 600);
    }

    [Fact]
    public void LogOutputRendersMessagesAndExceptionsWithoutDumpingUnreferencedProperties()
    {
        var log = new LogEvent(DateTimeOffset.UtcNow, LogEventLevel.Error, new Exception("Request failed"),
            new MessageTemplateParser().Parse("HTTP {RequestMethod} {Route} responded {StatusCode}"),
            [new("RequestMethod", new ScalarValue("POST")), new("Route", new ScalarValue("/auth/login")),
             new("StatusCode", new ScalarValue(401)), new("RequestPath", new ScalarValue("/secret-path")),
             new("Password", new ScalarValue("secret-password")), new("Authorization", new ScalarValue("secret-jwt")),
             new("QueryString", new ScalarValue("?code=secret-code"))]);
        using var writer = new StringWriter();
        new Serilog.Formatting.Display.MessageTemplateTextFormatter(LogOutput.Template, System.Globalization.CultureInfo.InvariantCulture).Format(log, writer);
        var output = writer.ToString();
        Assert.DoesNotContain("secret-", output);
        Assert.Contains("[ERR]", output);
        Assert.Contains("HTTP POST /auth/login responded 401", output);
        Assert.Contains("System.Exception: Request failed", output);
    }

    private static JwtSettings Settings() => new()
    {
        Issuer = "https://api.example.com", Audience = "wireal-api",
        SigningKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(64))
    };
    private static HttpResponseMessage Json(object body) => new(HttpStatusCode.OK) { Content = System.Net.Http.Json.JsonContent.Create(body) };
    private sealed class FakeHttp(Func<HttpRequestMessage, Task<HttpResponseMessage>> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => handler(request);
    }
}
