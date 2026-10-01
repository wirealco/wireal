using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;
using Wireal.Api.Projects;

namespace Wireal.Api.Auth;

public static class ProfileEndpoints
{
    public static object UserView(AppUser user, ClaimsPrincipal? principal = null, string? clientName = null) => new
    {
        id = user.Id, email = user.Email, user_metadata = new { full_name = user.DisplayName, avatar_url = user.AvatarUrl },
        identities = new[] { user.PasswordHash is not null && user.EmailVerified ? "email" : null, user.GitHubId is not null ? "github" : null, user.GoogleId is not null ? "google" : null }
            .Where(x => x is not null).Select(x => new { identity_id = x, provider = x }),
        client_id = principal?.FindFirstValue("client_id"), client_name = clientName, resource = principal?.FindFirstValue("resource")
    };
    public static void MapProfileEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/auth").RequireAuthorization();
        auth.MapGet("/me", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken ct) =>
        {
            var clientId = principal.FindFirstValue("client_id");
            var clientName = clientId is null ? null : (await db.Set<OAuthClient>().FindAsync([clientId], ct))?.Name;
            return UserView(await db.Users.SingleAsync(x => x.Id == ProjectService.Owner(principal), ct), principal, clientName);
        });
        auth.MapPatch("/profile", async (JsonObject input, ClaimsPrincipal principal, AppDbContext db, AccountService accounts, IPasswordHasher<AppUser> hasher, CancellationToken ct) =>
        {
            if (principal.HasClaim(x => x.Type == "client_id")) return Results.Forbid();
            var user = await db.Users.SingleAsync(x => x.Id == ProjectService.Owner(principal), ct);
            if (input["data"] is JsonObject data)
            {
                if (data["full_name"] is not null)
                {
                    var name = data["full_name"]!.GetValue<string>().Trim();
                    if (name.Length is < 1 or > 200) return Results.Problem(statusCode: 400, title: "Display name must contain 1–200 characters.");
                    user.DisplayName = name;
                }
                if (data["avatar_url"] is not null)
                {
                    var avatar = data["avatar_url"]!.GetValue<string>();
                    var expected = app.Configuration["App:PublicApiOrigin"]!.TrimEnd('/') + "/api/avatars/" + user.Id;
                    if (avatar.Split('?')[0] != expected || avatar.Length > 2048 || !await db.Avatars.AnyAsync(x => x.UserId == user.Id, ct))
                        return Results.Problem(statusCode: 400, title: "Upload an avatar before selecting it.");
                    user.AvatarUrl = avatar;
                }
            }
            if (input["password"] is not null)
            {
                var password = input["password"]!.GetValue<string>();
                if (password.Length is < 15 or > 128) return Results.Problem(statusCode: 400, title: "Use a password of 15–128 characters.");
                if (user.Email is null || !user.EmailVerified) return Results.Problem(statusCode: 400, title: "Add and verify your email before setting a password.");
                user.PasswordHash = hasher.HashPassword(user, password);
                var current = Guid.Parse(principal.FindFirstValue("sid")!);
                var sessions = await db.AuthSessions.Where(x => x.UserId == user.Id && x.Id != current && x.RevokedAt == null).ToListAsync(ct);
                foreach (var session in sessions) session.RevokedAt = DateTime.UtcNow;
            }
            if (input["email"] is not null)
            {
                var email = input["email"]!.GetValue<string>();
                if (EmailAddress.Normalize(email) is null) return Results.Problem(statusCode: 400, title: "Enter a valid email address.");
                try { await accounts.ChangeEmailAsync(user, email, ct); }
                catch (DataFault error) { return Results.Problem(statusCode: error.Status, title: error.Message); }
            }
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { return Results.Problem(statusCode: 409, title: "Account changed concurrently. Try again."); }
            return Results.Ok(UserView(user));
        });
        auth.MapPost("/identities/{provider}", async (string provider, HttpContext context, AppDbContext db, IDataProtectionProvider protection, ClientOrigins origins, CancellationToken ct) =>
        {
            if (context.User.HasClaim(x => x.Type == "client_id")) return Results.Forbid();
            if (provider is not ("github" or "google") || string.IsNullOrEmpty(app.Configuration[provider == "github" ? "GitHub:App:ClientId" : "Authentication:Google:ClientId"]))
                return Results.Problem(statusCode: 400, title: "This sign-in provider is not configured.");
            var id = ProjectService.Owner(context.User);
            if (!await db.Users.AnyAsync(x => x.Id == id && !x.Disabled, ct)) return Results.Unauthorized();
            var ticket = protection.CreateProtector("Wireal.LinkIdentity.v1").Protect(string.Join('|', id, context.User.FindFirstValue("sid"), provider, DateTime.UtcNow.AddMinutes(2).Ticks));
            context.Response.Cookies.Append("__Host-wireal-link", ticket, new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromMinutes(2) });
            return Results.Ok(new { url = Microsoft.AspNetCore.WebUtilities.QueryHelpers.AddQueryString(
                origins.ProviderPath(provider, null, context.Request.Headers.Origin.ToString()), "link", "true") });
        });
        auth.MapDelete("/identities/{provider}", async (string provider, ClaimsPrincipal principal, AppDbContext db, CancellationToken ct) =>
        {
            if (principal.HasClaim(x => x.Type == "client_id")) return Results.Forbid();
            var user = await db.Users.SingleAsync(x => x.Id == ProjectService.Owner(principal), ct);
            var methods = (user.PasswordHash is not null && user.EmailVerified ? 1 : 0) + (user.GitHubId is not null ? 1 : 0) + (user.GoogleId is not null ? 1 : 0);
            if (methods <= 1) return Results.Problem(statusCode: 400, title: "Keep at least one sign-in method.");
            if (provider == "github") user.GitHubId = null;
            else if (provider == "google") user.GoogleId = null;
            else return Results.Problem(statusCode: 400, title: "Unknown sign-in provider.");
            await db.SaveChangesAsync(ct); return Results.NoContent();
        });
    }
}
