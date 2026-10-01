using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.WebUtilities;

namespace Wireal.Api.Auth;

/// <summary>One exact allowlist for credentialed CORS and browser login returns.</summary>
public sealed class ClientOrigins
{
    public string Primary { get; }
    public string[] All { get; }

    public ClientOrigins(Uri primary, IEnumerable<string> additional)
    {
        Primary = primary.GetLeftPart(UriPartial.Authority);
        var origins = new List<string> { Primary };
        foreach (var value in additional)
        {
            if (!TryOrigin(value, out var origin) || !origin.StartsWith("https://", StringComparison.Ordinal))
                throw new InvalidOperationException("App:AdditionalClientOrigins must contain exact HTTPS origins, without paths, credentials, queries or wildcards.");
            origins.Add(origin);
        }
        All = origins.Distinct(StringComparer.Ordinal).ToArray();
    }

    private static bool TryOrigin(string? value, out string origin)
    {
        origin = "";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("https" or "http") || uri.Host.Contains('*') ||
            uri.AbsolutePath != "/" || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != "") return false;
        origin = uri.GetLeftPart(UriPartial.Authority);
        return true;
    }

    public string Resolve(string? requested) =>
        TryOrigin(requested, out var origin) && All.Contains(origin, StringComparer.Ordinal) ? origin : Primary;

    public string ProviderPath(string provider, string? authorizationId, string? origin)
    {
        var path = "/auth/" + provider;
        if (ValidAuthorizationId(authorizationId))
            path = QueryHelpers.AddQueryString(path, "authorization_id", authorizationId!);
        var target = Resolve(origin);
        return target == Primary ? path : QueryHelpers.AddQueryString(path, "client_origin", target);
    }

    public string ProviderReturn(string? authorizationId, string? origin) =>
        // MCP consent belongs to its primary frontend, even when login began elsewhere.
        ValidAuthorizationId(authorizationId)
            ? Primary + "/oauth/consent?authorization_id=" + authorizationId + "#oauth"
            : Resolve(origin) + "/#oauth";

    public string LoginFailure(AuthenticationProperties? properties)
    {
        var origin = Uri.TryCreate(properties?.RedirectUri, UriKind.Absolute, out var uri)
            ? Resolve(uri.GetLeftPart(UriPartial.Authority)) : Primary;
        return origin + "/login?error=authentication_failed";
    }

    private static bool ValidAuthorizationId(string? id) => id is not null &&
        System.Text.RegularExpressions.Regex.IsMatch(id, "^[A-Za-z0-9_-]{43}$");
}
