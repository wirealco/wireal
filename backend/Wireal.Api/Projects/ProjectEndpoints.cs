using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Projects;

public static class ProjectEndpoints
{
    public static void MapProjectEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireAuthorization().AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (DataFault error) { return Results.Json(new DataResult(null, new { message = error.Message, code = error.Status.ToString() }), statusCode: error.Status); }
            catch (DbUpdateConcurrencyException) { return Results.Json(new DataResult(null, new { message = "Data changed concurrently. Reload and retry.", code = "409" }), statusCode: 409); }
            catch (Exception error) when (error is FormatException or InvalidOperationException or System.Text.Json.JsonException or ArgumentException)
            { return Results.Json(new DataResult(null, new { message = "Invalid request data.", code = "400" }), statusCode: 400); }
        });
        api.MapPost("/query", (ClaimsPrincipal user, DataQuery query, ProjectService service, CancellationToken ct) => service.Query(ProjectService.Owner(user), query, ct));
        api.MapPost("/commands/{command}", async (ClaimsPrincipal user, string command, JsonObject args, ProjectService service, CancellationToken ct) =>
            new DataResult(await service.Command(ProjectService.Owner(user), command, args, ct)));
        var teams = api.MapGroup("/teams").RequireRateLimiting("auth").AddEndpointFilter(async (context, next) =>
            context.HttpContext.User.HasClaim(c => c.Type == "client_id") ? Results.Forbid() : await next(context));
        teams.MapGet("/invitations", (ClaimsPrincipal user, WorkspaceTeams service, CancellationToken ct) => service.Inbox(ProjectService.Owner(user), ct));
        teams.MapPost("/invitations/{id:guid}/accept", (Guid id, ClaimsPrincipal user, WorkspaceTeams service, CancellationToken ct) => service.Respond(ProjectService.Owner(user), id, true, ct));
        teams.MapPost("/invitations/{id:guid}/decline", (Guid id, ClaimsPrincipal user, WorkspaceTeams service, CancellationToken ct) => service.Respond(ProjectService.Owner(user), id, false, ct));
        teams.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal user, WorkspaceTeams service, CancellationToken ct) => service.Team(ProjectService.Owner(user), id, ct));
        teams.MapPost("/{id:guid}/invitations", (Guid id, InviteWorkspaceRequest input, ClaimsPrincipal user, WorkspaceTeams service, CancellationToken ct) => service.Invite(ProjectService.Owner(user), id, input, ct)).RequireRateLimiting("login");
        teams.MapDelete("/{id:guid}/invitations/{invitationId:guid}", async (Guid id, Guid invitationId, ClaimsPrincipal user, WorkspaceTeams service, CancellationToken ct) =>
        { await service.Revoke(ProjectService.Owner(user), id, invitationId, ct); return Results.NoContent(); });
        teams.MapDelete("/{id:guid}/members/{memberId:guid}", async (Guid id, Guid memberId, ClaimsPrincipal user, WorkspaceTeams service, CancellationToken ct) =>
        { await service.Remove(ProjectService.Owner(user), id, memberId, ct); return Results.NoContent(); });
        // Short authenticated polls work across replicas and proxy restarts.
        // Only revisions travel unless data has actually changed.
        api.MapGet("/workspace-changes", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var owner = ProjectService.Owner(user);
            return await WorkspaceAccess.Changes(db, owner, ct);
        });
        api.MapGet("/workspace-events", async (HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var owner = ProjectService.Owner(context.User);
            if (!Guid.TryParse(context.User.FindFirstValue("sid"), out var sid)) { context.Response.StatusCode = 401; return; }
            context.Response.ContentType = "text/event-stream";
            context.Response.Headers["X-Accel-Buffering"] = "no";
            var expires = DateTime.UtcNow.AddSeconds(55);
            if (long.TryParse(context.User.FindFirstValue("exp"), out var exp)) expires = new[] { expires, DateTimeOffset.FromUnixTimeSeconds(exp).UtcDateTime }.Min();
            string? previous = null;
            while (!ct.IsCancellationRequested && DateTime.UtcNow < expires)
            {
                if (!await db.AuthSessions.AsNoTracking().AnyAsync(x => x.Id == sid && x.UserId == owner && x.RevokedAt == null && x.ExpiresAt > DateTime.UtcNow && !x.User.Disabled, ct)) break;
                var rows = await WorkspaceAccess.Changes(db, owner, ct);
                var fingerprint = System.Text.Json.JsonSerializer.Serialize(rows);
                await context.Response.WriteAsync(fingerprint != previous ? "data: " + fingerprint + "\n\n" : ": heartbeat\n\n", ct);
                await context.Response.Body.FlushAsync(ct); previous = fingerprint;
                await Task.Delay(TimeSpan.FromSeconds(1), ct);
            }
        });
        api.MapPut("/avatars/{userId:guid}", async (Guid userId, HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            if (ProjectService.Owner(context.User) != userId) return Results.Forbid();
            const int max = 2 * 1024 * 1024;
            if (context.Request.ContentLength > max) return Results.StatusCode(413);
            using var data = new MemoryStream();
            var buffer = new byte[8192]; int read;
            while ((read = await context.Request.Body.ReadAsync(buffer, ct)) > 0)
            {
                if (data.Length + read > max) return Results.StatusCode(413);
                await data.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            var bytes = data.ToArray();
            var type = ImageType(bytes);
            if (type is null || type != context.Request.ContentType) return Results.Problem(statusCode: 400, title: "Upload a PNG, JPEG, WebP or GIF image.");
            var avatar = await db.Avatars.SingleOrDefaultAsync(x => x.UserId == userId, ct);
            if (avatar is null) { avatar = new UserAvatar { UserId = userId }; db.Avatars.Add(avatar); }
            avatar.Content = bytes; avatar.ContentType = type;
            var user = await db.Users.SingleAsync(x => x.Id == userId, ct);
            user.AvatarUrl = app.Configuration["App:PublicApiOrigin"]!.TrimEnd('/') + "/api/avatars/" + userId;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { path = userId + "/avatar" });
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(2 * 1024 * 1024));
        // Avatars were public in the previous storage bucket; only owners upload.
        api.MapGet("/avatars/{userId:guid}", async (Guid userId, AppDbContext db, CancellationToken ct) =>
        {
            var avatar = await db.Avatars.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == userId, ct);
            return avatar is null ? Results.NotFound() : Results.File(avatar.Content, avatar.ContentType);
        }).AllowAnonymous();
    }

    internal static string? ImageType(byte[] bytes)
    {
        if (bytes.Length < 12) return null;
        if (bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255) return "image/jpeg";
        if (System.Text.Encoding.ASCII.GetString(bytes, 0, 6) is "GIF87a" or "GIF89a") return "image/gif";
        if (System.Text.Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && System.Text.Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP") return "image/webp";
        return null;
    }
}
