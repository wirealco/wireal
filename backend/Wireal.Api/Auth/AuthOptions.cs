using System.Net.Mail;
using Microsoft.IdentityModel.Tokens;

namespace Wireal.Api.Auth;

public static class RegistrationPolicy
{
    // Missing configuration preserves the existing invitation-only behavior.
    private static bool WhitelistEnabled(IConfiguration config) => config.GetValue("Authentication:WhitelistEnabled", true);

    public static bool AllowsEmail(IConfiguration config, string? email)
    {
        var normalized = EmailAddress.Normalize(email);
        return normalized is not null && (!WhitelistEnabled(config) ||
            (config.GetSection("Authentication:AllowedEmails").Get<string[]>() ?? [])
                .Any(x => EmailAddress.Normalize(x) == normalized));
    }

    public static bool AllowsGitHub(IConfiguration config, string externalId) => !WhitelistEnabled(config) ||
        (config.GetSection("Authentication:GitHub:AllowedUserIds").Get<string[]>() ?? [])
            .Contains(externalId, StringComparer.Ordinal);
}

public static class GitHubLogin
{
    /// <summary>GitHub sign-in uses the GitHub App's OAuth credentials; with neither set it is turned off.</summary>
    public static bool Enabled(IConfiguration config) =>
        !string.IsNullOrWhiteSpace(config["GitHub:App:ClientId"]) || !string.IsNullOrWhiteSpace(config["GitHub:App:ClientSecret"]);
}

/// <summary>What production requires of the PostgreSQL connection: a server on this machine (TCP loopback or a
/// Unix socket), a certificate-validated TLS connection, or a network the operator declares private
/// (<c>Database:PrivateNetwork</c>, which the Docker Compose file sets for its internal network).</summary>
public static class DatabaseConnection
{
    public static bool Protected(string connection, bool privateNetwork)
    {
        var settings = new Npgsql.NpgsqlConnectionStringBuilder(connection);
        if (privateNetwork || settings.SslMode is Npgsql.SslMode.VerifyFull or Npgsql.SslMode.VerifyCA) return true;
        var hosts = (settings.Host ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return hosts.Length > 0 && hosts.All(host => host.StartsWith('/') || host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
            (System.Net.IPAddress.TryParse(host, out var address) && System.Net.IPAddress.IsLoopback(address)));
    }
}

public sealed class JwtSettings
{
    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "";
    public string SigningKey { get; set; } = "";
    public int AccessMinutes { get; set; } = 10;
    public int SessionDays { get; set; } = 30;

    public SymmetricSecurityKey Key()
    {
        var bytes = Convert.FromBase64String(SigningKey);
        if (bytes.Length < 32) throw new InvalidOperationException("JWT signing key must contain at least 32 random bytes, Base64 encoded.");
        return new SymmetricSecurityKey(bytes);
    }

    public void Validate()
    {
        if (!Uri.TryCreate(Issuer, UriKind.Absolute, out var issuer) || issuer.Scheme != "https" ||
            string.IsNullOrWhiteSpace(Audience) || AccessMinutes is < 1 or > 15 || SessionDays is < 1 or > 30)
            throw new InvalidOperationException("Configure Jwt issuer, audience, access lifetime (1–15 minutes), and session lifetime (1–30 days).");
        _ = Key();
    }

    public TokenValidationParameters ValidationParameters() => new()
    {
        ValidateIssuer = true, ValidIssuer = Issuer,
        ValidateAudience = true, ValidAudience = Audience,
        ValidateLifetime = true, RequireExpirationTime = true,
        ValidateIssuerSigningKey = true, RequireSignedTokens = true, IssuerSigningKey = Key(),
        ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
        ClockSkew = TimeSpan.FromSeconds(30), NameClaimType = "name"
    };
}

public sealed class TurnstileSettings
{
    public string SiteKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string[] Hostnames { get; set; } = [];

    /// <summary>Turnstile is off only when neither key is set; one key without the other is a mistake.</summary>
    public bool Enabled => !string.IsNullOrWhiteSpace(SiteKey) || !string.IsNullOrWhiteSpace(SecretKey);
}

public sealed class CloudflareEmailSettings
{
    public string AccountId { get; set; } = "";
    public string ApiToken { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "Wireal";

    /// <summary>The logo at the top of each message. Program.cs sets it to the web app's own
    /// <c>/logo.png</c> under <c>App:ClientOrigin</c>, so a self-hosted server links its own copy.
    /// Empty leaves the logo out.</summary>
    public string LogoUrl { get; set; } = "";

    /// <summary>Messages the outbox may have accepted in a UTC day before it stops sending.
    /// Deliberately under the provider's own daily quota: a send the provider counts and we
    /// do not — a retry it accepted twice, anything else sending as this account — comes out
    /// of the difference, and exhausting the provider's quota costs sender reputation, not
    /// just the rest of the day.</summary>
    public int DailyBudget { get; set; } = 150;

    /// <summary>Verification emails one account may ask for in 24 hours. Registering is one;
    /// the rest are resends, which anyone can trigger for an address they hold.</summary>
    public int PerAccountDailyLimit { get; set; } = 3;

    /// <summary>Email is off only when none of the provider fields is set; a partial configuration is a mistake.</summary>
    public bool Enabled => !string.IsNullOrWhiteSpace(AccountId) || !string.IsNullOrWhiteSpace(ApiToken) ||
        !string.IsNullOrWhiteSpace(FromAddress);
}

public static class EmailAddress
{
    public static string? Normalize(string? value)
    {
        var input = value?.Trim();
        if (string.IsNullOrEmpty(input) || input.Length > 254 || input.Any(char.IsControl) ||
            !MailAddress.TryCreate(input, out var address) || address.Address != input || !address.Host.Contains('.')) return null;
        return input.ToUpperInvariant();
    }
}
