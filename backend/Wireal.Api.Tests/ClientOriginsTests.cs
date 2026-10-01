using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Wireal.Api.Auth;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class ClientOriginsTests
{
    private const string Development = "https://dev.example.test:5173";

    [Fact]
    public void OnlyExactConfiguredOriginsCanReceiveLoginReturns()
    {
        var origins = new ClientOrigins(new Uri("https://app.example.test"), [Development]);
        Assert.Equal(Development + "/#oauth", origins.ProviderReturn(null, Development));
        foreach (var untrusted in new[] { "https://evil.example", "https://dev.example.test:5174", "https://dev.example.test.evil.example:5173", Development + "/path", "//evil.example", "null" })
            Assert.Equal("https://app.example.test/#oauth", origins.ProviderReturn(null, untrusted));
        foreach (var invalid in new[] { "http://dev.example.test:5173", "https://*.example.test", Development + "/path", Development + "?next=evil", "https://user:password@dev.example.test" })
            Assert.Throws<InvalidOperationException>(() => new ClientOrigins(new Uri("https://app.example.test"), [invalid]));
        Assert.Equal("https://app.example.test/oauth/consent?authorization_id=" + new string('a', 43) + "#oauth",
            origins.ProviderReturn(new string('a', 43), Development));
        Assert.Equal(Development + "/login?error=authentication_failed",
            origins.LoginFailure(new AuthenticationProperties { RedirectUri = Development + "/#oauth" }));
        Assert.Equal("https://app.example.test/#oauth", new ClientOrigins(new Uri("https://app.example.test"), []).ProviderReturn(null, Development));
    }

    [Fact]
    public async Task AdditionalOriginGetsCorsAndProtectedOAuthReturnWithoutChangingPrimary()
    {
        await using var factory = new ApiFactory(additionalClientOrigin: Development);
        using var client = factory.Client();
        foreach (var origin in new[] { "https://localhost:5173", Development, "https://evil.example" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Options, "/auth/login");
            request.Headers.Add("Origin", origin);
            request.Headers.Add("Access-Control-Request-Method", "POST");
            request.Headers.Add("Access-Control-Request-Headers", "content-type,x-csrf-token");
            var response = await client.SendAsync(request);
            if (origin == "https://evil.example") Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
            else
            {
                Assert.Equal(origin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
                Assert.Equal("true", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Credentials")));
            }
        }
        client.DefaultRequestHeaders.Add("Origin", Development);
        var csrfResponse = await client.GetAsync("/auth/csrf");
        Assert.Contains(csrfResponse.Headers.GetValues("Set-Cookie"), cookie => cookie.Contains("samesite=strict", StringComparison.OrdinalIgnoreCase));
        var csrf = await csrfResponse.Content.ReadFromJsonAsync<JsonObject>();
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!["token"]!.GetValue<string>());
        var prepare = await client.PostAsJsonAsync("/auth/github/prepare", new { turnstileToken = "valid" });
        prepare.EnsureSuccessStatusCode();
        var body = await prepare.Content.ReadFromJsonAsync<JsonObject>();
        var challenge = await client.GetAsync(body!["url"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
        var query = QueryHelpers.ParseQuery(challenge.Headers.Location!.Query);
        var options = factory.Services.GetRequiredService<IOptionsMonitor<OAuthOptions>>().Get("GitHub");
        var properties = options.StateDataFormat.Unprotect(query["state"].ToString());
        Assert.Equal(Development + "/#oauth", properties!.RedirectUri);
        Assert.Equal("https://localhost/auth/github/callback", query["redirect_uri"].ToString());
    }
}
