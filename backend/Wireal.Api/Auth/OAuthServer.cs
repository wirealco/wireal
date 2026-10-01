using System.Security.Claims;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Wireal.Api.Data;
using Wireal.Api.Projects;

namespace Wireal.Api.Auth;

public sealed class OAuthClient
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string RedirectUris { get; set; } = "[]";
    public string Uri { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public sealed class OAuthAuthorization
{
    public string Id { get; set; } = TokenService.RandomToken();
    public string ClientId { get; set; } = "";
    public string RedirectUri { get; set; } = "";
    public string Challenge { get; set; } = "";
    public string State { get; set; } = "";
    public string Scope { get; set; } = "";
    public string Resource { get; set; } = "";
    public Guid? UserId { get; set; }
    public Guid? SessionId { get; set; }
    public string? CodeHash { get; set; }
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(10);
    public DateTime? DecidedAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public Guid Version { get; set; } = Guid.NewGuid();
}
// OAuth code/refresh exchanges have their own PKCE/client binding. They do not
// use cookies. This marker never applies to browser account or consent routes.
public sealed record OAuthProtocolEndpoint;

public static class OAuthServer
{
    public static void ConfigureModel(ModelBuilder model)
    {
        var clients = model.Entity<OAuthClient>(); clients.HasKey(x => x.Id);
        clients.Property(x => x.Id).HasMaxLength(36); clients.Property(x => x.Name).HasMaxLength(160);
        clients.Property(x => x.Uri).HasMaxLength(2048); clients.Property(x => x.RedirectUris).HasMaxLength(22000);
        var auth = model.Entity<OAuthAuthorization>(); auth.HasKey(x => x.Id);
        auth.Property(x => x.Id).HasMaxLength(43); auth.Property(x => x.ClientId).HasMaxLength(36);
        auth.Property(x => x.RedirectUri).HasMaxLength(2048); auth.Property(x => x.Challenge).HasMaxLength(43);
        auth.Property(x => x.State).HasMaxLength(2048); auth.Property(x => x.Scope).HasMaxLength(200);
        auth.Property(x => x.Resource).HasMaxLength(2048); auth.Property(x => x.CodeHash).HasMaxLength(64);
        auth.HasIndex(x => x.CodeHash).IsUnique(); auth.Property(x => x.Version).IsConcurrencyToken();
        auth.HasOne<OAuthClient>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
        auth.HasIndex(x => x.ExpiresAt);
    }
    private static IResult Error(string error, string description, int status = 400) => Results.Json(new { error, error_description = description }, statusCode: status);
    private static bool RedirectAllowed(string value) => value.Length <= 2048 &&
        System.Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Fragment.Length == 0 && uri.UserInfo.Length == 0 &&
        (uri.Scheme == "https" || uri.Scheme == "http" && uri.IsLoopback);
    private static object ClientView(OAuthClient client) => new { id = client.Id, name = client.Name, uri = client.Uri, logo_uri = "" };
    private static bool Browser(ClaimsPrincipal principal) => principal.FindFirst("client_id") is null;
    private static bool SerializationConflict(Exception exception) =>
        (exception as Npgsql.PostgresException ?? exception.InnerException as Npgsql.PostgresException)?.SqlState is
            Npgsql.PostgresErrorCodes.SerializationFailure or Npgsql.PostgresErrorCodes.DeadlockDetected;

    public static void MapOAuthServer(this WebApplication app, Uri publicOrigin, Uri clientOrigin)
    {
        var issuer = publicOrigin.AbsoluteUri.TrimEnd('/') + "/oauth";
        // The MCP server's origin, which every token is bound to. Unset, it is the web app's host with
        // "mcp." in front (wireal.co -> mcp.wireal.co), the same pairing the MCP server assumes in reverse.
        var resource = new Uri(app.Configuration["App:McpResource"] is { Length: > 0 } configured
            ? configured
            : new UriBuilder(clientOrigin) { Host = "mcp." + clientOrigin.Host }.Uri.AbsoluteUri).AbsoluteUri;
        bool ResourceMatches(string input) => Uri.TryCreate(input, UriKind.Absolute, out var parsed) && parsed.AbsoluteUri == resource;
        object Metadata() => new
        {
            issuer, authorization_endpoint = issuer + "/authorize", token_endpoint = issuer + "/token",
            registration_endpoint = issuer + "/register", revocation_endpoint = issuer + "/revoke",
            authorization_response_iss_parameter_supported = true,
            response_types_supported = new[] { "code" }, grant_types_supported = new[] { "authorization_code", "refresh_token" },
            code_challenge_methods_supported = new[] { "S256" }, token_endpoint_auth_methods_supported = new[] { "none" },
            scopes_supported = new[] { "wireal", "offline_access" }
        };
        IResult AuthorizationError(string redirect, string state, string error, string description, bool includeState = true)
        {
            var parameters = new Dictionary<string, string?> { ["error"] = error, ["error_description"] = description, ["iss"] = issuer };
            if (includeState && state.Length > 0) parameters["state"] = state;
            return Results.Redirect(QueryHelpers.AddQueryString(redirect, parameters));
        }
        app.MapGet("/.well-known/oauth-authorization-server/oauth", () => Metadata()).AllowAnonymous();
        app.MapGet("/oauth/.well-known/oauth-authorization-server", () => Metadata()).AllowAnonymous();
        app.MapGet("/.well-known/oauth-authorization-server", () => Metadata()).AllowAnonymous();
        var protocol = app.MapGroup("/oauth").AllowAnonymous().RequireRateLimiting("auth");
        protocol.MapPost("/register", async (JsonObject input, AppDbContext db, CancellationToken ct) =>
        {
            if (input["redirect_uris"] is not JsonArray uris || uris.Count is < 1 or > 10 || uris.Any(x => x is not JsonValue v || !v.TryGetValue<string>(out var u) || !RedirectAllowed(u)))
                return Error("invalid_redirect_uri", "Supply exact HTTPS or loopback redirect URIs.");
            if (input["token_endpoint_auth_method"]?.GetValue<string>() is not (null or "none")) return Error("invalid_client_metadata", "Only public PKCE clients are supported.");
            if (input["grant_types"] is JsonArray grants && grants.Any(x => x?.GetValue<string>() is not ("authorization_code" or "refresh_token")) ||
                input["response_types"] is JsonArray responses && responses.Any(x => x?.GetValue<string>() != "code")) return Error("invalid_client_metadata", "Only authorization code and refresh grants are supported.");
            var name = input["client_name"]?.GetValue<string>()?.Trim() ?? "MCP client";
            if (name.Length is < 1 or > 160) return Error("invalid_client_metadata", "Invalid client name.");
            var client = new OAuthClient { Name = name, RedirectUris = uris.ToJsonString() };
            if (input["client_uri"]?.GetValue<string>() is string uri && RedirectAllowed(uri)) client.Uri = uri;
            db.Set<OAuthClient>().Add(client); await db.SaveChangesAsync(ct);
            return Results.Json(new { client_id = client.Id, client_name = name, redirect_uris = uris,
                token_endpoint_auth_method = "none", grant_types = new[] { "authorization_code", "refresh_token" }, response_types = new[] { "code" } }, statusCode: 201);
        }).WithMetadata(new OAuthProtocolEndpoint()).RequireRateLimiting("login");
        protocol.MapGet("/authorize", async (HttpRequest request, AppDbContext db, CancellationToken ct) =>
        {
            var q = request.Query; var clientId = q["client_id"].ToString(); var redirect = q["redirect_uri"].ToString();
            var client = await db.Set<OAuthClient>().FindAsync([clientId], ct);
            if (client is null || !JsonNode.Parse(client.RedirectUris)!.AsArray().Any(x => x!.GetValue<string>() == redirect))
                return Error("invalid_request", "Unknown client or redirect URI.");
            var state = q["state"].ToString();
            if (state.Length > 2048) return AuthorizationError(redirect, state, "invalid_request", "State is too long.", false);
            if (q["response_type"] != "code" || q["code_challenge_method"] != "S256" || !Regex.IsMatch(q["code_challenge"].ToString(), "^[A-Za-z0-9_-]{43}$"))
                return AuthorizationError(redirect, state, "invalid_request", "Authorization code with S256 PKCE is required.");
            var scopes = q["scope"].ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();
            if (scopes.Any(x => x is not ("wireal" or "offline_access"))) return AuthorizationError(redirect, state, "invalid_scope", "Supported scopes: wireal offline_access.");
            if (q["resource"].Count != 1 || !ResourceMatches(q["resource"].ToString())) return AuthorizationError(redirect, state, "invalid_target", "The Wireal MCP resource is required.");
            var authorization = new OAuthAuthorization { ClientId = clientId, RedirectUri = redirect,
                Challenge = q["code_challenge"].ToString(), State = state, Resource = resource,
                Scope = string.Join(' ', scopes.Prepend("wireal").Distinct()) };
            db.Set<OAuthAuthorization>().Add(authorization); await db.SaveChangesAsync(ct);
            return Results.Redirect(QueryHelpers.AddQueryString(new Uri(clientOrigin, "/oauth/consent").AbsoluteUri, "authorization_id", authorization.Id));
        });
        protocol.MapPost("/token", async (HttpRequest request, AppDbContext db, AccountService accounts, TokenService tokens, JwtSettings settings, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) return Error("invalid_request", "Use form encoding.");
            var form = await request.ReadFormAsync(ct); var clientId = form["client_id"].ToString();
            if (form["resource"].Count != 1 || !ResourceMatches(form["resource"].ToString())) return Error("invalid_target", "The Wireal MCP resource is required.");
            if (form["grant_type"] == "refresh_token")
            {
                var raw = form["refresh_token"].ToString(); var hash = TokenService.Hash(raw);
                var refresh = await db.RefreshTokens.AsNoTracking().Include(x => x.Session).SingleOrDefaultAsync(x => x.Hash == hash, ct);
                if (refresh?.Session.OAuthClientId != clientId || refresh.Session.Resource != resource) return Error("invalid_grant", "Invalid refresh token.");
                var issued = await accounts.RefreshAsync(raw, ct);
                return issued is null ? Error("invalid_grant", "Expired or revoked refresh token.") : Results.Ok(new
                { access_token = issued.Access.AccessToken, token_type = "Bearer", expires_in = issued.Access.ExpiresIn, refresh_token = issued.Refresh, scope = refresh.Session.Scope });
            }
            if (form["grant_type"] != "authorization_code") return Error("unsupported_grant_type", "Use authorization_code or refresh_token.");
            var codeHash = TokenService.Hash(form["code"].ToString());
            var authorization = await db.Set<OAuthAuthorization>().SingleOrDefaultAsync(x => x.CodeHash == codeHash, ct);
            if (authorization is null || authorization.ClientId != clientId || authorization.RedirectUri != form["redirect_uri"] || authorization.Resource != resource || authorization.UserId is null)
                return Error("invalid_grant", "Invalid authorization code.");
            if (authorization.ConsumedAt is not null)
            {
                await db.AuthSessions.Where(x => x.Id == authorization.SessionId).ExecuteUpdateAsync(x => x.SetProperty(s => s.RevokedAt, DateTime.UtcNow), ct);
                return Error("invalid_grant", "Authorization code has already been used.");
            }
            var verifier = form["code_verifier"].ToString();
            if (authorization.ExpiresAt <= DateTime.UtcNow || !Regex.IsMatch(verifier, "^[A-Za-z0-9._~-]{43,128}$") ||
                Base64UrlEncoder.Encode(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(verifier))) != authorization.Challenge)
                return Error("invalid_grant", "Invalid or expired authorization code.");
            var user = await db.Users.SingleOrDefaultAsync(x => x.Id == authorization.UserId && !x.Disabled, ct);
            if (user is null) return Error("invalid_grant", "Account unavailable.");
            var session = new AuthSession { User = user, ExpiresAt = DateTime.UtcNow.AddDays(settings.SessionDays),
                OAuthClientId = clientId, Scope = authorization.Scope, Resource = resource };
            authorization.ConsumedAt = DateTime.UtcNow; authorization.SessionId = session.Id;
            db.AuthSessions.Add(session);
            var rawRefresh = TokenService.RandomToken();
            var offline = authorization.Scope.Split(' ').Contains("offline_access");
            if (offline) db.RefreshTokens.Add(new RefreshToken { Session = session, Hash = TokenService.Hash(rawRefresh) });
            else session.ExpiresAt = DateTime.UtcNow.AddMinutes(settings.AccessMinutes);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { return Error("invalid_grant", "Authorization code has already been used."); }
            var access = tokens.Access(user, session);
            return Results.Ok(new { access_token = access.AccessToken, token_type = "Bearer", expires_in = access.ExpiresIn,
                refresh_token = offline ? rawRefresh : null, scope = session.Scope });
        }).WithMetadata(new OAuthProtocolEndpoint());
        protocol.MapPost("/revoke", async (HttpRequest request, AppDbContext db, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) return Error("invalid_request", "Use form encoding.");
            var form = await request.ReadFormAsync(ct); var hash = TokenService.Hash(form["token"].ToString()); var clientId = form["client_id"].ToString();
            var refresh = await db.RefreshTokens.AsNoTracking().Include(x => x.Session).SingleOrDefaultAsync(x => x.Hash == hash, ct);
            if (refresh is not null && refresh.Session.OAuthClientId == clientId)
                await db.AuthSessions.Where(x => x.Id == refresh.SessionId).ExecuteUpdateAsync(x => x.SetProperty(s => s.RevokedAt, DateTime.UtcNow), ct);
            return Results.Ok();
        }).WithMetadata(new OAuthProtocolEndpoint());

        var consent = app.MapGroup("/auth/oauth").RequireAuthorization();
        consent.MapGet("/authorizations/{id}", async (string id, ClaimsPrincipal principal, AppDbContext db, CancellationToken ct) =>
        {
            if (!Browser(principal)) return Results.Forbid();
            var authorization = await db.Set<OAuthAuthorization>().FindAsync([id], ct);
            if (authorization is null || authorization.ExpiresAt <= DateTime.UtcNow || authorization.DecidedAt is not null) return Error("invalid_request", "Authorization request is invalid or expired.");
            var client = await db.Set<OAuthClient>().FindAsync([authorization.ClientId], ct);
            var user = await db.Users.FindAsync([ProjectService.Owner(principal)], ct);
            return Results.Ok(new { authorization_id = id, redirect_uri = authorization.RedirectUri, client = ClientView(client!),
                user = new { id = user!.Id, email = user.Email ?? "", display_name = user.DisplayName }, scope = authorization.Scope });
        });
        consent.MapPost("/authorizations/{id}/{decision}", async (string id, string decision, ClaimsPrincipal principal, AppDbContext db, CancellationToken ct) =>
        {
            if (!Browser(principal)) return Results.Forbid();
            var authorization = await db.Set<OAuthAuthorization>().FindAsync([id], ct);
            if (authorization is null || authorization.ExpiresAt <= DateTime.UtcNow || authorization.DecidedAt is not null || decision is not ("approve" or "deny")) return Error("invalid_request", "Authorization request is invalid or expired.");
            authorization.DecidedAt = DateTime.UtcNow;
            var parameters = new Dictionary<string, string?> { ["state"] = authorization.State, ["iss"] = issuer };
            if (decision == "approve")
            {
                var code = TokenService.RandomToken(); authorization.UserId = ProjectService.Owner(principal);
                authorization.CodeHash = TokenService.Hash(code); authorization.ExpiresAt = DateTime.UtcNow.AddMinutes(2); parameters["code"] = code;
            }
            else parameters["error"] = "access_denied";
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { return Error("invalid_request", "Authorization already decided."); }
            return Results.Ok(new { redirect_url = QueryHelpers.AddQueryString(authorization.RedirectUri, parameters) });
        });
        consent.MapGet("/grants", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken ct) =>
        {
            if (!Browser(principal)) return Results.Forbid();
            var owner = ProjectService.Owner(principal); var now = DateTime.UtcNow;
            var ids = await db.AuthSessions.Where(x => x.UserId == owner && x.OAuthClientId != null && x.RevokedAt == null && x.ExpiresAt > now).Select(x => x.OAuthClientId).Distinct().ToArrayAsync(ct);
            var clients = await db.Set<OAuthClient>().Where(x => ids.Contains(x.Id)).ToArrayAsync(ct);
            var activeSessions = db.AuthSessions.Where(x => x.UserId == owner && x.RevokedAt == null && x.ExpiresAt > now).Select(x => x.Id);
            var decisions = await db.Set<OAuthAuthorization>().AsNoTracking().Where(x => x.UserId == owner && x.SessionId != null && activeSessions.Contains(x.SessionId.Value)).ToListAsync(ct);
            return Results.Ok(clients.Select(x =>
            {
                var grant = decisions.Where(d => d.ClientId == x.Id).OrderByDescending(d => d.DecidedAt).First();
                return new { client = ClientView(x), scopes = grant.Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries), granted_at = grant.DecidedAt };
            }));
        });
        consent.MapDelete("/grants/{clientId}", async (string clientId, ClaimsPrincipal principal, AppDbContext db, CancellationToken ct) =>
        {
            if (!Browser(principal)) return Results.Forbid();
            var owner = ProjectService.Owner(principal);
            // PostgreSQL answers a serializable conflict by aborting one side (40001, or 40P01 for a deadlock)
            // instead of blocking; both statements are idempotent, so the whole transaction is simply retried.
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
                    await db.AuthSessions.Where(x => x.UserId == owner && x.OAuthClientId == clientId).ExecuteUpdateAsync(x => x.SetProperty(s => s.RevokedAt, DateTime.UtcNow), ct);
                    await db.Set<OAuthAuthorization>().Where(x => x.UserId == owner && x.ClientId == clientId && x.ConsumedAt == null)
                        .ExecuteUpdateAsync(x => x.SetProperty(a => a.ExpiresAt, DateTime.UtcNow).SetProperty(a => a.Version, Guid.NewGuid()), ct);
                    await tx.CommitAsync(ct); return Results.NoContent();
                }
                catch (Exception exception) when (attempt < 5 && SerializationConflict(exception))
                {
                    await Task.Delay(TimeSpan.FromMilliseconds(20 * attempt), ct);
                }
            }
        });
    }
}
