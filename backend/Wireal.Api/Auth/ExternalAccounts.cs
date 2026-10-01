using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Auth;

public static class ExternalAccounts
{
    public static async Task CreateTicket(OAuthCreatingTicketContext context, string provider)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, context.Options.UserInformationEndpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", context.AccessToken);
        request.Headers.UserAgent.ParseAdd("Wireal.Api/1.0");
        request.Headers.Accept.ParseAdd("application/json");
        using var response = await context.Backchannel.SendAsync(request, context.HttpContext.RequestAborted);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted));
        var json = document.RootElement;
        var externalId = provider == "github" ? json.GetProperty("id").GetInt64().ToString(System.Globalization.CultureInfo.InvariantCulture) : json.GetProperty("sub").GetString()!;
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var jwt = context.HttpContext.RequestServices.GetRequiredService<JwtSettings>();
        var ct = context.HttpContext.RequestAborted;
        var matched = await db.Users.SingleOrDefaultAsync(x => provider == "github" ? x.GitHubId == externalId : x.GoogleId == externalId, ct);
        AppUser? user;
        if (context.Properties.Items.TryGetValue("linkUser", out var linkUser))
        {
            var id = Guid.Parse(linkUser!); var sid = Guid.Parse(context.Properties.Items["linkSession"]!);
            if (!await db.AuthSessions.AnyAsync(x => x.Id == sid && x.UserId == id && x.OAuthClientId == null && x.RevokedAt == null && x.ExpiresAt > DateTime.UtcNow, ct))
                throw new InvalidOperationException("Linking session expired.");
            user = await db.Users.SingleAsync(x => x.Id == id, ct);
            if (matched is not null && matched.Id != id || provider == "github" && user.GitHubId is not null && user.GitHubId != externalId ||
                provider == "google" && user.GoogleId is not null && user.GoogleId != externalId) throw new InvalidOperationException("Identity already connected.");
            if (provider == "github") user.GitHubId = externalId; else user.GoogleId = externalId;
        }
        else
        {
            user = matched;
            if (user is null)
            {
                string? email = provider == "google" && json.TryGetProperty("email_verified", out var verified) && verified.ValueKind == JsonValueKind.True
                    ? json.GetProperty("email").GetString() : null;
                var invited = provider == "github"
                    ? RegistrationPolicy.AllowsGitHub(config, externalId)
                    : RegistrationPolicy.AllowsEmail(config, email);
                invited = invited || await Wireal.Api.Projects.WorkspaceTeams.Invited(db, provider == "github" ? "github" : "email",
                    provider == "github" ? externalId : EmailAddress.Normalize(email), ct);
                if (!invited) throw new InvalidOperationException("Account is not eligible for registration.");
                user = new AppUser
                {
                    GitHubId = provider == "github" ? externalId : null, GoogleId = provider == "google" ? externalId : null,
                    DisplayName = json.TryGetProperty(provider == "github" ? "login" : "name", out var name) ? name.GetString()! : "Wireal user",
                    Email = email, NormalizedEmail = EmailAddress.Normalize(email), EmailVerified = email is not null
                };
                // An existing email never implicitly links two identities.
                if (user.NormalizedEmail is not null && await db.Users.AnyAsync(x => x.NormalizedEmail == user.NormalizedEmail, ct))
                    throw new InvalidOperationException("Sign in with the existing account to connect this provider.");
                db.Users.Add(user);
            }
        }
        if (user.Disabled) throw new InvalidOperationException("Account disabled.");
        var session = new AuthSession { User = user, ExpiresAt = DateTime.UtcNow.AddDays(jwt.SessionDays) };
        db.AuthSessions.Add(session);
        await db.SaveChangesAsync(ct);
        context.Identity!.AddClaim(new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()));
        context.Identity.AddClaim(new Claim(ClaimTypes.Name, user.DisplayName));
        context.Identity.AddClaim(new Claim("sid", session.Id.ToString()));
    }

    public static AuthenticationProperties? LinkProperties(HttpContext context, string provider, IDataProtectionProvider protection)
    {
        if (context.Request.Query["link"] != "true") return null;
        var cookie = context.Request.Cookies["__Host-wireal-link"];
        context.Response.Cookies.Delete("__Host-wireal-link", new CookieOptions { Secure = true, HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/" });
        try
        {
            var values = protection.CreateProtector("Wireal.LinkIdentity.v1").Unprotect(cookie ?? "").Split('|');
            if (values.Length != 4 || values[2] != provider || long.Parse(values[3]) <= DateTime.UtcNow.Ticks) return null;
            return new AuthenticationProperties(new Dictionary<string, string?> { ["linkUser"] = values[0], ["linkSession"] = values[1] });
        }
        catch (Exception error) when (error is System.Security.Cryptography.CryptographicException or FormatException) { return null; }
    }
}
