using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.IdentityModel.Tokens;

namespace Wireal.Api.GitHub;

public sealed class GitHubAppSettings
{
    public long AppId { get; set; }
    public string Slug { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string PrivateKey { get; set; } = "";
    public string PrivateKeyPath { get; set; } = "";

    public bool Configured => AppId > 0;

    private RsaSecurityKey? signing;
    public RsaSecurityKey SigningKey() => signing ?? throw new InvalidOperationException("The GitHub App is not configured.");

    public void Load()
    {
        if (!Configured) return;
        if (!string.IsNullOrWhiteSpace(PrivateKeyPath))
        {
            if (!Path.IsPathFullyQualified(PrivateKeyPath)) throw new InvalidOperationException("GitHub:App:PrivateKeyPath must be an absolute path.");
            if (!File.Exists(PrivateKeyPath)) throw new InvalidOperationException("GitHub:App:PrivateKeyPath does not name a readable file.");
            PrivateKey = File.ReadAllText(PrivateKeyPath);
        }
        if (!Regex.IsMatch(Slug, "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$") ||
            string.IsNullOrWhiteSpace(ClientId) || string.IsNullOrWhiteSpace(ClientSecret) || string.IsNullOrWhiteSpace(PrivateKey))
            throw new InvalidOperationException("Configure GitHub:App slug, client ID, client secret and private key, or remove GitHub:App:AppId.");
        var rsa = RSA.Create();
        try { rsa.ImportFromPem(PrivateKey); }
        catch (Exception error) when (error is ArgumentException or CryptographicException)
        {
            rsa.Dispose();
            throw new InvalidOperationException("GitHub:App:PrivateKey must be the PEM private key GitHub issued for the app.");
        }
        signing = new RsaSecurityKey(rsa);
        PrivateKey = "";
    }
}
