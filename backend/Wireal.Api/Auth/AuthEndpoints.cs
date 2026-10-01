using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.AspNetCore.DataProtection;

namespace Wireal.Api.Auth;

public sealed record RegistrationRequest(string? Email, string? Password, string? DisplayName, string? TurnstileToken);
public sealed record LoginRequest(string? Email, string? Password, string? TurnstileToken);
public sealed record ResendRequest(string? Email, string? TurnstileToken);
public sealed record VerificationRequest(string? Token);
public sealed record ChallengeRequest(string? TurnstileToken, string? AuthorizationId = null);

public sealed class OAuthGate(IMemoryCache cache)
{
    private readonly object sync = new();
    public string Issue()
    {
        var token = TokenService.RandomToken();
        cache.Set("oauth-gate:" + token, true, TimeSpan.FromMinutes(2));
        return token;
    }
    public bool Consume(string? token)
    {
        if (token?.Length != 43) return false;
        lock (sync)
        {
            var key = "oauth-gate:" + token;
            if (!cache.TryGetValue(key, out bool _)) return false;
            cache.Remove(key);
            return true;
        }
    }
}

public static class AuthEndpoints
{
    public const string RefreshCookie = "__Host-wireal-refresh";
    private const string GateCookie = "__Host-wireal-github-gate";
    private static CookieOptions Cookie(DateTimeOffset? expires = null) => new()
    {
        HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = "/", Expires = expires
    };
    private static IResult GenericAccepted() => Results.Accepted(value: new
    {
        message = "If this address is eligible, a verification email will arrive shortly."
    });
    private static IResult InvalidInput() => Results.Problem(statusCode: 400, title: "Invalid input");
    private static IResult ChallengeFailed() => Results.Problem(statusCode: 400, title: "Complete a new security challenge and try again.");

    public static void MapAccountEndpoints(this WebApplication app, Uri publicOrigin)
    {
        var auth = app.MapGroup("/auth").RequireRateLimiting("auth");
        auth.MapGet("/config", (TurnstileSettings settings, IConfiguration config) => Results.Ok(new { turnstileSiteKey = settings.SiteKey, clientOrigin = config["App:ClientOrigin"] })).AllowAnonymous();
        auth.MapGet("/csrf", (HttpContext context, IAntiforgery antiforgery) =>
            Results.Ok(new { token = antiforgery.GetAndStoreTokens(context).RequestToken })).AllowAnonymous();

        auth.MapPost("/register", async (RegistrationRequest input, HttpContext context, ITurnstileVerifier turnstile, AccountService accounts, CancellationToken ct) =>
        {
            if (EmailAddress.Normalize(input.Email) is null || input.Password is null || input.Password.Length is < 15 or > 128 ||
                string.IsNullOrWhiteSpace(input.DisplayName) || input.DisplayName.Trim().Length > 200) return InvalidInput();
            if (!await turnstile.VerifyAsync(input.TurnstileToken, "register", context.Connection.RemoteIpAddress?.ToString(), ct)) return ChallengeFailed();
            await accounts.RegisterAsync(input.Email!, input.Password, input.DisplayName, ct);
            return GenericAccepted();
        }).AllowAnonymous().RequireRateLimiting("login");

        auth.MapPost("/login", async (LoginRequest input, HttpContext context, ITurnstileVerifier turnstile, AccountService accounts, CancellationToken ct) =>
        {
            if (EmailAddress.Normalize(input.Email) is null || string.IsNullOrEmpty(input.Password) || input.Password.Length > 128) return InvalidInput();
            if (!await turnstile.VerifyAsync(input.TurnstileToken, "login", context.Connection.RemoteIpAddress?.ToString(), ct)) return ChallengeFailed();
            var issued = await accounts.LoginAsync(input.Email!, input.Password, ct);
            if (issued is null) return Results.Problem(statusCode: 401, title: "Unable to sign in with these credentials.");
            context.Response.Cookies.Append(RefreshCookie, issued.Refresh, Cookie(new DateTimeOffset(issued.RefreshExpiresAt, TimeSpan.Zero)));
            return Results.Ok(issued.Access);
        }).AllowAnonymous().RequireRateLimiting("login");

        auth.MapPost("/verification/resend", async (ResendRequest input, HttpContext context, ITurnstileVerifier turnstile, AccountService accounts, CancellationToken ct) =>
        {
            if (EmailAddress.Normalize(input.Email) is null) return InvalidInput();
            if (!await turnstile.VerifyAsync(input.TurnstileToken, "resend", context.Connection.RemoteIpAddress?.ToString(), ct)) return ChallengeFailed();
            await accounts.ResendAsync(input.Email!, ct);
            return GenericAccepted();
        }).AllowAnonymous().RequireRateLimiting("login");

        auth.MapPost("/verification/confirm", async (VerificationRequest input, AccountService accounts, CancellationToken ct) =>
            input.Token is not null && await accounts.VerifyEmailAsync(input.Token, ct)
                ? Results.Ok(new { message = "Email verified. You can now sign in." })
                : Results.Problem(statusCode: 400, title: "This verification link is invalid or expired.")).AllowAnonymous();

        auth.MapPost("/github/prepare", async (ChallengeRequest input, HttpContext context, ITurnstileVerifier turnstile, OAuthGate gate, ClientOrigins origins, IConfiguration config, CancellationToken ct) =>
        {
            if (!GitHubLogin.Enabled(config)) return Results.Problem(statusCode: 400, title: "GitHub sign-in is not configured.");
            if (!await turnstile.VerifyAsync(input.TurnstileToken, "github", context.Connection.RemoteIpAddress?.ToString(), ct)) return ChallengeFailed();
            context.Response.Cookies.Append(GateCookie, gate.Issue(), Cookie(DateTimeOffset.UtcNow.AddMinutes(2)));
            return Results.Ok(new { url = origins.ProviderPath("github", input.AuthorizationId, context.Request.Headers.Origin.ToString()) });
        }).AllowAnonymous().RequireRateLimiting("login");
        auth.MapGet("/github", (HttpContext context, OAuthGate gate, IDataProtectionProvider protection, ClientOrigins origins, IConfiguration config) =>
        {
            if (!GitHubLogin.Enabled(config)) return Results.NotFound();
            var linking = ExternalAccounts.LinkProperties(context, "github", protection);
            var permitted = linking is not null || gate.Consume(context.Request.Cookies[GateCookie]);
            context.Response.Cookies.Delete(GateCookie, Cookie());
            var properties = linking ?? new AuthenticationProperties();
            properties.RedirectUri = origins.ProviderReturn(context.Request.Query["authorization_id"], context.Request.Query["client_origin"]);
            return permitted
                ? Results.Challenge(properties, ["GitHub"])
                : Results.Problem(statusCode: 400, title: "Complete the security challenge before GitHub login.");
        }).AllowAnonymous().RequireRateLimiting("login");
        auth.MapPost("/google/prepare", async (ChallengeRequest input, HttpContext context, ITurnstileVerifier turnstile, OAuthGate gate, IConfiguration config, ClientOrigins origins, CancellationToken ct) =>
        {
            if (string.IsNullOrEmpty(config["Authentication:Google:ClientId"])) return Results.Problem(statusCode: 400, title: "Google sign-in is not configured.");
            if (!await turnstile.VerifyAsync(input.TurnstileToken, "google", context.Connection.RemoteIpAddress?.ToString(), ct)) return ChallengeFailed();
            context.Response.Cookies.Append("__Host-wireal-google-gate", gate.Issue(), Cookie(DateTimeOffset.UtcNow.AddMinutes(2)));
            return Results.Ok(new { url = origins.ProviderPath("google", input.AuthorizationId, context.Request.Headers.Origin.ToString()) });
        }).AllowAnonymous().RequireRateLimiting("login");
        auth.MapGet("/google", (HttpContext context, OAuthGate gate, IDataProtectionProvider protection, IConfiguration config, ClientOrigins origins) =>
        {
            if (string.IsNullOrEmpty(config["Authentication:Google:ClientId"])) return Results.NotFound();
            var linking = ExternalAccounts.LinkProperties(context, "google", protection);
            var permitted = linking is not null || gate.Consume(context.Request.Cookies["__Host-wireal-google-gate"]);
            context.Response.Cookies.Delete("__Host-wireal-google-gate", Cookie());
            var properties = linking ?? new AuthenticationProperties();
            properties.RedirectUri = origins.ProviderReturn(context.Request.Query["authorization_id"], context.Request.Query["client_origin"]);
            return permitted ? Results.Challenge(properties, ["Google"]) : ChallengeFailed();
        }).AllowAnonymous().RequireRateLimiting("login");

        // Only the GitHub cookie bridge can be exchanged; a JWT cannot mint another refresh family.
        auth.MapPost("/token", async (HttpContext context, AccountService accounts, CancellationToken ct) =>
        {
            var bridge = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            if (!bridge.Succeeded) return Results.Unauthorized();
            var issued = await accounts.ExchangeAsync(bridge.Principal!, ct);
            if (issued is null) return Results.Unauthorized();
            context.Response.Cookies.Append(RefreshCookie, issued.Refresh, Cookie(new DateTimeOffset(issued.RefreshExpiresAt, TimeSpan.Zero)));
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(issued.Access);
        });
        auth.MapPost("/refresh", async (HttpContext context, AccountService accounts, CancellationToken ct) =>
        {
            var issued = await accounts.RefreshAsync(context.Request.Cookies[RefreshCookie], ct);
            if (issued is null)
            {
                context.Response.Cookies.Delete(RefreshCookie, Cookie());
                return Results.Unauthorized();
            }
            context.Response.Cookies.Append(RefreshCookie, issued.Refresh, Cookie(new DateTimeOffset(issued.RefreshExpiresAt, TimeSpan.Zero)));
            return Results.Ok(issued.Access);
        }).AllowAnonymous();
        auth.MapPost("/logout", async (HttpContext context, AccountService accounts, CancellationToken ct) =>
        {
            await accounts.LogoutAsync(context.User, context.Request.Cookies[RefreshCookie], ct);
            context.Response.Cookies.Delete(RefreshCookie, Cookie());
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).AllowAnonymous();
    }
}
