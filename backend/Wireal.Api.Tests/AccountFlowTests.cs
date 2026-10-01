using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class AccountFlowTests
{
    private const string Password = "a long test passphrase 2026!";

    public static async Task<HttpResponseMessage> PostAsync(HttpClient client, string path, object body)
    {
        var csrfResponse = await client.GetAsync("/auth/csrf");
        csrfResponse.EnsureSuccessStatusCode();
        var csrf = await csrfResponse.Content.ReadFromJsonAsync<CsrfResponse>();
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-CSRF-TOKEN", csrf!.Token);
        return await client.SendAsync(request);
    }

    private static async Task RegisterAsync(HttpClient client) => Assert.Equal(HttpStatusCode.Accepted,
        (await PostAsync(client, "/auth/register", new { email = "invited@example.com", password = Password, displayName = "Invited", turnstileToken = "valid" })).StatusCode);

    private static async Task<string> DeliverAsync(ApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<EmailOutboxProcessor>().ProcessBatchAsync(default);
        var email = Assert.Single(((TestEmailSender)scope.ServiceProvider.GetRequiredService<IVerificationEmailSender>()).Messages);
        return new Uri(email.Url).Fragment["#verify=".Length..];
    }

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string password = Password) =>
        PostAsync(client, "/auth/login", new { email = "invited@example.com", password, turnstileToken = "valid" });

    [Fact]
    public async Task OutboxFailureRetainsEncryptedPayloadAndRetries()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        await RegisterAsync(client);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var processor = new EmailOutboxProcessor(db,
                scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>(),
                new FailingSender(), scope.ServiceProvider.GetRequiredService<CloudflareEmailSettings>(), TimeProvider.System,
                Microsoft.Extensions.Logging.Abstractions.NullLogger<EmailOutboxProcessor>.Instance);
            await processor.ProcessBatchAsync(default);
            var message = await db.EmailOutbox.SingleAsync();
            Assert.Null(message.CompletedAt);
            Assert.Equal(1, message.Attempts);
            Assert.True(message.NextAttemptAt > DateTime.UtcNow);
            Assert.DoesNotContain("invited@example.com", message.ProtectedPayload);
            Assert.DoesNotContain("#verify=", message.ProtectedPayload);
            message.NextAttemptAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        Assert.Equal(43, (await DeliverAsync(factory)).Length);
    }

    [Fact]
    public async Task GitHubBridgeExchangeIsSingleUse()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        Guid sessionId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var session = new AuthSession { User = new AppUser { GitHubId = "123", DisplayName = "GitHub user" }, ExpiresAt = DateTime.UtcNow.AddDays(1) };
            db.AuthSessions.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sid", sessionId.ToString())], "Cookies"));
        using (var scope = factory.Services.CreateScope())
            Assert.NotNull(await scope.ServiceProvider.GetRequiredService<AccountService>().ExchangeAsync(principal, default));
        using (var scope = factory.Services.CreateScope())
            Assert.Null(await scope.ServiceProvider.GetRequiredService<AccountService>().ExchangeAsync(principal, default));
    }

    [Fact]
    public async Task RegistrationVerificationLoginRefreshReplayAndRevocation()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        await RegisterAsync(client);
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client)).StatusCode);

        var verificationToken = await DeliverAsync(factory);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync();
            Assert.NotEqual(Password, user.PasswordHash);
            Assert.False(user.EmailVerified);
            Assert.Equal(TokenService.Hash(verificationToken), (await db.EmailVerifications.SingleAsync()).Hash);
            Assert.Equal("", (await db.EmailOutbox.SingleAsync()).ProtectedPayload);
        }
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(client, "/auth/verification/confirm", new { token = verificationToken })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/auth/verification/confirm", new { token = verificationToken })).StatusCode);
        var login = await LoginAsync(client);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var access = (await login.Content.ReadFromJsonAsync<AccessTokenResponse>())!;
        Assert.InRange(access.ExpiresIn, 1, 600);
        var refreshCookie = login.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith(AuthEndpoints.RefreshCookie + "="));
        Assert.Contains("httponly", refreshCookie);
        Assert.Contains("secure", refreshCookie);
        Assert.Contains("samesite=strict", refreshCookie);
        var oldRefresh = refreshCookie.Split(';')[0];
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", access.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/auth/me")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        var rotated = await PostAsync(client, "/auth/refresh", new { });
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var currentAccess = (await rotated.Content.ReadFromJsonAsync<AccessTokenResponse>())!;

        using var replayClient = factory.Client();
        replayClient.DefaultRequestHeaders.Add("Cookie", oldRefresh);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(replayClient, "/auth/refresh", new { })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", currentAccess.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/auth/me")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/auth/refresh", new { })).StatusCode);
    }

    [Fact]
    public async Task InvalidTurnstileOrMissingCsrfCannotCreateUsersOrQueueMail()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        var input = new { email = "invited@example.com", password = Password, displayName = "Invited", turnstileToken = "invalid" };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/auth/register", input)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/auth/register", input)).StatusCode);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(0, await db.Users.CountAsync());
        Assert.Equal(0, await db.EmailOutbox.CountAsync());
    }

    [Fact]
    public async Task ExistingAndUninvitedAddressesReceiveSameResponseWithoutAnotherEmail()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        await RegisterAsync(client);
        await RegisterAsync(client);
        var unknown = await PostAsync(client, "/auth/register", new { email = "unknown@example.com", password = Password, displayName = "Unknown", turnstileToken = "valid" });
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(1, await db.EmailOutbox.CountAsync());
    }

    [Fact]
    public async Task VerificationExpiresAndResendIsThrottled()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        await RegisterAsync(client);
        var token = await DeliverAsync(factory);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.EmailVerifications.SingleAsync()).ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/auth/verification/confirm", new { token })).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await PostAsync(client, "/auth/verification/resend", new { email = "invited@example.com", turnstileToken = "valid" })).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(1, await db.EmailOutbox.CountAsync());
            (await db.Users.SingleAsync()).LastVerificationSentAt = DateTime.UtcNow.AddMinutes(-3);
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Accepted, (await PostAsync(client, "/auth/verification/resend", new { email = "invited@example.com", turnstileToken = "valid" })).StatusCode);
        using var finalScope = factory.Services.CreateScope();
        Assert.Equal(2, await finalScope.ServiceProvider.GetRequiredService<AppDbContext>().EmailOutbox.CountAsync());
    }

    [Fact]
    public async Task FiveWrongPasswordsLockEvenCorrectPassword()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        await RegisterAsync(client);
        var token = await DeliverAsync(factory);
        await PostAsync(client, "/auth/verification/confirm", new { token });
        for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client, "incorrect password")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client)).StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.True((await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.SingleAsync()).LockoutEnd > DateTime.UtcNow);
    }

    [Fact]
    public async Task LogoutRevokesAccessAndRefresh()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        await RegisterAsync(client);
        await PostAsync(client, "/auth/verification/confirm", new { token = await DeliverAsync(factory) });
        var response = await LoginAsync(client);
        var access = (await response.Content.ReadFromJsonAsync<AccessTokenResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", access.AccessToken);
        Assert.Equal(HttpStatusCode.NoContent, (await PostAsync(client, "/auth/logout", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/auth/me")).StatusCode);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/auth/refresh", new { })).StatusCode);
    }

    [Fact]
    public async Task GitHubRequiresSingleUseChallengeGate()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/auth/github")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/auth/github/prepare", new { turnstileToken = "invalid" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(client, "/auth/github/prepare", new { turnstileToken = "valid" })).StatusCode);
        Assert.Equal(HttpStatusCode.Redirect, (await client.GetAsync("/auth/github")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/auth/github")).StatusCode);
    }

    [Fact]
    public async Task DisabledUserLosesExistingJwtAccess()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        await factory.InitializeDatabaseAsync();
        await RegisterAsync(client);
        await PostAsync(client, "/auth/verification/confirm", new { token = await DeliverAsync(factory) });
        var response = await LoginAsync(client);
        var access = (await response.Content.ReadFromJsonAsync<AccessTokenResponse>())!;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Users.SingleAsync()).Disabled = true;
            await db.SaveChangesAsync();
        }
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", access.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/auth/me")).StatusCode);
    }

    private sealed record CsrfResponse(string Token);
    private sealed class FailingSender : IVerificationEmailSender
    {
        public Task SendAsync(string recipient, string verificationUrl, CancellationToken cancellationToken) => throw new EmailDeliveryException("test", false);
    }
}
