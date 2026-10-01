using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Wireal.Api.Data;

namespace Wireal.Api.Auth;

public sealed record AccessTokenResponse(string AccessToken, string TokenType, int ExpiresIn);
public sealed record IssuedTokens(AccessTokenResponse Access, string Refresh, DateTime RefreshExpiresAt);

public sealed class TokenService(JwtSettings settings, TimeProvider clock)
{
    public static string RandomToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public AccessTokenResponse Access(AppUser user, AuthSession session)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var expires = new[] { now.AddMinutes(settings.AccessMinutes), session.ExpiresAt }.Min();
        var claims = new List<Claim> { new("sub", user.Id.ToString()), new("sid", session.Id.ToString()),
            new("jti", Guid.NewGuid().ToString()), new("name", user.DisplayName) };
        if (session.OAuthClientId is not null)
            claims.AddRange([new("client_id", session.OAuthClientId), new("scope", session.Scope), new("resource", session.Resource)]);
        var jwt = new JwtSecurityToken(settings.Issuer, settings.Audience, claims,
            now, expires, new SigningCredentials(settings.Key(), SecurityAlgorithms.HmacSha256));
        return new(new JwtSecurityTokenHandler().WriteToken(jwt), "Bearer", Math.Max(0, (int)(expires - now).TotalSeconds));
    }
}
