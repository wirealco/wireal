using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class OAuthFlowTests
{
    private const string Verifier = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private const string Redirect = "http://127.0.0.1:45678/callback";
    private const string Issuer = "https://localhost:7080/oauth";
    internal static async Task<string> Register(HttpClient client, string clientName = "Test MCP")
    {
        var response = await client.PostAsJsonAsync("/oauth/register", new { client_name = clientName, redirect_uris = new[] { Redirect }, token_endpoint_auth_method = "none" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonObject>())!["client_id"]!.GetValue<string>();
    }
    internal static string Authorize(string clientId, string redirect = Redirect, string resource = "https://mcp.example.test") => "/oauth/authorize?" +
        new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId, ["redirect_uri"] = redirect, ["response_type"] = "code", ["state"] = "original-state",
            ["code_challenge"] = Base64UrlEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(Verifier))), ["code_challenge_method"] = "S256",
            ["scope"] = "wireal offline_access", ["resource"] = resource
        }).ReadAsStringAsync().GetAwaiter().GetResult();
    private static async Task<string> Approve(HttpClient browser, HttpClient protocol, string clientId)
    {
        var redirect = await protocol.GetAsync(Authorize(clientId)); Assert.Equal(HttpStatusCode.Redirect, redirect.StatusCode);
        var id = QueryHelpers.ParseQuery(redirect.Headers.Location!.Query)["authorization_id"].ToString();
        var details = await browser.GetAsync("/auth/oauth/authorizations/" + id); Assert.Equal(HttpStatusCode.OK, details.StatusCode);
        var csrf = await browser.GetFromJsonAsync<JsonObject>("/auth/csrf");
        browser.DefaultRequestHeaders.Remove("X-CSRF-TOKEN"); browser.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!["token"]!.GetValue<string>());
        var approved = await browser.PostAsJsonAsync("/auth/oauth/authorizations/" + id + "/approve", new { }); Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        var url = new Uri((await approved.Content.ReadFromJsonAsync<JsonObject>())!["redirect_url"]!.GetValue<string>());
        Assert.Equal("original-state", QueryHelpers.ParseQuery(url.Query)["state"].ToString());
        Assert.Equal(Issuer, QueryHelpers.ParseQuery(url.Query)["iss"].ToString());
        return QueryHelpers.ParseQuery(url.Query)["code"].ToString();
    }
    private static Task<HttpResponseMessage> Exchange(HttpClient client, string clientId, string code, string verifier = Verifier, string resource = "https://mcp.example.test") =>
        client.PostAsync("/oauth/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code", ["client_id"] = clientId, ["code"] = code, ["code_verifier"] = verifier,
            ["redirect_uri"] = Redirect, ["resource"] = resource
        }));
    private static Task<HttpResponseMessage> Refresh(HttpClient client, string clientId, string token) => client.PostAsync("/oauth/token", new FormUrlEncodedContent(new Dictionary<string, string>
    {
        ["grant_type"] = "refresh_token", ["client_id"] = clientId, ["refresh_token"] = token, ["resource"] = "https://mcp.example.test/"
    }));

    [Fact]
    public async Task ProfilesExposeRegisteredClientNameOnlyForOAuthSessions()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (browser, _) = await ProjectFlowTests.SignIn(factory);
        using (browser) using (var protocol = factory.Client())
        {
            var clientId = await Register(protocol, "Codex CLI");
            var code = await Approve(browser, protocol, clientId);
            var response = await Exchange(protocol, clientId, code); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var tokens = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
            using var agent = factory.Client(); agent.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens["access_token"]!.GetValue<string>());

            var identity = await agent.GetFromJsonAsync<JsonObject>("/auth/me");
            Assert.Equal("Codex CLI", identity!["client_name"]!.GetValue<string>());

            var browserIdentity = await browser.GetFromJsonAsync<JsonObject>("/auth/me");
            Assert.Null(browserIdentity!["client_name"]);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Set<OAuthClient>().Remove((await db.Set<OAuthClient>().FindAsync(clientId))!);
            await db.SaveChangesAsync();
            identity = await agent.GetFromJsonAsync<JsonObject>("/auth/me");
            Assert.Null(identity!["client_name"]);
        }
    }

    [Fact]
    public async Task PkceRedirectResourceRotationAndRevocationAreEnforced()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (browser, _) = await ProjectFlowTests.SignIn(factory);
        using (browser) using (var protocol = factory.Client())
        {
            var clientId = await Register(protocol);
            Assert.Equal(HttpStatusCode.BadRequest, (await protocol.GetAsync(Authorize(clientId, "https://evil.example/callback"))).StatusCode);
            var invalidTarget = await protocol.GetAsync(Authorize(clientId, resource: "https://evil.example"));
            Assert.Equal(HttpStatusCode.Redirect, invalidTarget.StatusCode);
            var targetError = QueryHelpers.ParseQuery(invalidTarget.Headers.Location!.Query);
            Assert.Equal("invalid_target", targetError["error"].ToString());
            Assert.Equal("original-state", targetError["state"].ToString());
            Assert.Equal(Issuer, targetError["iss"].ToString());
            var code = await Approve(browser, protocol, clientId);
            Assert.Equal(HttpStatusCode.BadRequest, (await Exchange(protocol, clientId, code, new string('b', 43))).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Exchange(protocol, clientId, code, resource: "https://evil.example")).StatusCode);
            var response = await Exchange(protocol, clientId, code); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var tokens = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
            using var agent = factory.Client(); agent.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens["access_token"]!.GetValue<string>());
            var identity = await agent.GetFromJsonAsync<JsonObject>("/auth/me");
            Assert.Equal(clientId, identity!["client_id"]!.GetValue<string>());
            Assert.Equal("https://mcp.example.test/", identity["resource"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.Forbidden, (await agent.GetAsync("/auth/oauth/grants")).StatusCode);
            var otherClientId = await Register(protocol);
            Assert.Equal(HttpStatusCode.BadRequest, (await Refresh(protocol, otherClientId, tokens["refresh_token"]!.GetValue<string>())).StatusCode);
            var rotatedResponse = await Refresh(protocol, clientId, tokens["refresh_token"]!.GetValue<string>()); Assert.Equal(HttpStatusCode.OK, rotatedResponse.StatusCode);
            var rotated = (await rotatedResponse.Content.ReadFromJsonAsync<JsonObject>())!;
            Assert.NotEqual(tokens["refresh_token"]!.GetValue<string>(), rotated["refresh_token"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.NoContent, (await browser.DeleteAsync("/auth/oauth/grants/" + clientId)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await agent.GetAsync("/auth/me")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Refresh(protocol, clientId, rotated["refresh_token"]!.GetValue<string>())).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/auth/me")).StatusCode);
        }
    }

    [Fact]
    public async Task ReplayingCodesOrRefreshTokensRevokesOnlyThatGrant()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (browser, _) = await ProjectFlowTests.SignIn(factory);
        using (browser) using (var protocol = factory.Client())
        {
            var clientId = await Register(protocol); var code = await Approve(browser, protocol, clientId);
            var issued = await Exchange(protocol, clientId, code); var token = (await issued.Content.ReadFromJsonAsync<JsonObject>())!["access_token"]!.GetValue<string>();
            Assert.Equal(HttpStatusCode.BadRequest, (await Exchange(protocol, clientId, code)).StatusCode);
            using var agent = factory.Client(); agent.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            Assert.Equal(HttpStatusCode.Unauthorized, (await agent.GetAsync("/auth/me")).StatusCode);
            code = await Approve(browser, protocol, clientId);
            var next = (await (await Exchange(protocol, clientId, code)).Content.ReadFromJsonAsync<JsonObject>())!;
            var refresh = next["refresh_token"]!.GetValue<string>();
            var rotated = (await (await Refresh(protocol, clientId, refresh)).Content.ReadFromJsonAsync<JsonObject>())!;
            Assert.Equal(HttpStatusCode.BadRequest, (await Refresh(protocol, clientId, refresh)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Refresh(protocol, clientId, rotated["refresh_token"]!.GetValue<string>())).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/auth/me")).StatusCode);
        }
    }

    [Fact]
    public async Task RegistrationRejectsUnsafeRedirectsAndConsentCannotUseCookiesWithoutCsrf()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        using var protocol = factory.Client();
        foreach (var redirect in new[] { "javascript:alert(1)", "http://evil.example", "https://example.com/#fragment", "https://name:password@example.com" })
            Assert.Equal(HttpStatusCode.BadRequest, (await protocol.PostAsJsonAsync("/oauth/register", new { redirect_uris = new[] { redirect } })).StatusCode);
        var (browser, _) = await ProjectFlowTests.SignIn(factory); using (browser)
        {
            var id = await Register(protocol);
            var redirect = await protocol.GetAsync(Authorize(id));
            var authorizationId = QueryHelpers.ParseQuery(redirect.Headers.Location!.Query)["authorization_id"].ToString();
            Assert.Equal(HttpStatusCode.BadRequest, (await browser.PostAsJsonAsync("/auth/oauth/authorizations/" + authorizationId + "/approve", new { })).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await protocol.GetAsync("/auth/oauth/authorizations/" + authorizationId)).StatusCode);
        }
    }

    [Fact]
    public async Task ConsentDetailsCarryDisplayNameWhenGitHubAccountHasNoEmail()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (browser, userId) = await ProjectFlowTests.SignIn(factory);
        using (browser) using (var protocol = factory.Client())
        {
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var user = await db.Users.SingleAsync(x => x.Id == userId);
                user.Email = null; user.NormalizedEmail = null; user.EmailVerified = false; user.GitHubId = "123"; user.DisplayName = "octocat";
                await db.SaveChangesAsync();
            }
            var clientId = await Register(protocol);
            var redirect = await protocol.GetAsync(Authorize(clientId));
            var authorizationId = QueryHelpers.ParseQuery(redirect.Headers.Location!.Query)["authorization_id"].ToString();
            var details = await browser.GetFromJsonAsync<JsonObject>("/auth/oauth/authorizations/" + authorizationId);
            Assert.Equal("", details!["user"]!["email"]!.GetValue<string>());
            Assert.Equal("octocat", details["user"]!["display_name"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task IssuerIdentificationIsAdvertisedAndReturnedWhenConsentIsDenied()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (browser, _) = await ProjectFlowTests.SignIn(factory);
        using (browser) using (var protocol = factory.Client())
        {
            var metadata = await protocol.GetFromJsonAsync<JsonObject>("/.well-known/oauth-authorization-server/oauth");
            Assert.Equal(Issuer, metadata!["issuer"]!.GetValue<string>());
            Assert.True(metadata["authorization_response_iss_parameter_supported"]!.GetValue<bool>());

            var clientId = await Register(protocol);
            var redirect = await protocol.GetAsync(Authorize(clientId));
            var authorizationId = QueryHelpers.ParseQuery(redirect.Headers.Location!.Query)["authorization_id"].ToString();
            var csrf = await browser.GetFromJsonAsync<JsonObject>("/auth/csrf");
            browser.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!["token"]!.GetValue<string>());
            var denied = await browser.PostAsJsonAsync("/auth/oauth/authorizations/" + authorizationId + "/deny", new { });
            var deniedUrl = new Uri((await denied.Content.ReadFromJsonAsync<JsonObject>())!["redirect_url"]!.GetValue<string>());
            var deniedQuery = QueryHelpers.ParseQuery(deniedUrl.Query);
            Assert.Equal("access_denied", deniedQuery["error"].ToString());
            Assert.Equal("original-state", deniedQuery["state"].ToString());
            Assert.Equal(metadata["issuer"]!.GetValue<string>(), deniedQuery["iss"].ToString());
        }
    }
}
