using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Wireal.Api.Auth;

/// <summary>
/// The address a request really came from. Behind Cloudflare and a reverse proxy on the same machine, the
/// loopback proxy is trusted, but its X-Forwarded-For names the Cloudflare edge, so <c>CF-Connecting-IP</c>
/// (stamped by Cloudflare, only trusted when the connection is from a known proxy) is the visitor.
/// </summary>
public static class ClientAddress
{
    private const string Item = "Wireal.ClientAddress";

    /// <summary>Runs before the forwarded-headers middleware, while the connection address is still the proxy.</summary>
    public static void Capture(HttpContext context, ForwardedHeadersOptions options)
    {
        if (context.Connection.RemoteIpAddress is not { } remote || !IsKnownProxy(Normalize(remote), options)) return;
        if (IPAddress.TryParse(context.Request.Headers["CF-Connecting-IP"].ToString(), out var visitor))
            context.Items[Item] = Normalize(visitor);
    }

    public static IPAddress? Of(HttpContext context) =>
        context.Items.TryGetValue(Item, out var captured) ? (IPAddress?)captured : context.Connection.RemoteIpAddress;

    public static string Key(HttpContext context) => Of(context)?.ToString() ?? "unknown";

    private static bool IsKnownProxy(IPAddress address, ForwardedHeadersOptions options) =>
        options.KnownProxies.Contains(address) || options.KnownIPNetworks.Any(network => network.Contains(address));

    private static IPAddress Normalize(IPAddress address) => address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
}

/// <summary>
/// Identifies the signed-in user for rate limiting before authentication runs, so limits apply before any
/// database or provider work. A bearer token proves the user through its signature and a session cookie through
/// data protection; neither needs the session row, which authentication still checks afterwards.
/// </summary>
public sealed class ClientIdentity(JwtSettings jwt, IOptionsMonitor<CookieAuthenticationOptions> cookies)
{
    private const string Item = "Wireal.ClientIdentity";
    private readonly TokenValidationParameters validation = jwt.ValidationParameters();
    private readonly JsonWebTokenHandler tokens = new() { MapInboundClaims = false };

    /// <summary>Resolves the user once per request, ahead of the rate limiter; read it back with <see cref="UserId"/>.</summary>
    public async Task Prepare(HttpContext context) => context.Items[Item] = await Resolve(context);

    /// <summary>The user id when the request carries valid credentials, otherwise null.</summary>
    public static string? UserId(HttpContext context) => context.Items.TryGetValue(Item, out var user) ? (string?)user : null;

    private async Task<string?> Resolve(HttpContext context)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var result = await tokens.ValidateTokenAsync(authorization["Bearer ".Length..].Trim(), validation);
            return result.IsValid ? result.ClaimsIdentity.FindFirst("sub")?.Value : null;
        }
        var options = cookies.Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var cookie = options.CookieManager.GetRequestCookie(context, options.Cookie.Name!);
        if (string.IsNullOrEmpty(cookie)) return null;
        return options.TicketDataFormat.Unprotect(cookie)?.Principal.FindFirstValue(ClaimTypes.NameIdentifier);
    }
}
