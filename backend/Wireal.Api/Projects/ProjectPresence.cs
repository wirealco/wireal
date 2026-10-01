using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Projects;

// Presence of people working through the Wireal MCP from their own Claude Code
// or Codex session, outside any runner, so runners and the board can see them.
public sealed partial class ProjectService
{
    private const int PresenceLiveMinutes = 10;
    private const int PresenceKeepHours = 24;
    private const int MaxPresenceSessionLength = 100;
    private const int MaxPresenceClientLength = 60;
    private const int MaxPresenceHandleLength = 60;
    private const int MaxPresenceNoteLength = 200;

    private static string? Blank(string text) => text.Length > 0 ? text : null;

    private async Task<JsonObject> TouchPresence(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var session = Required(args, "session", MaxPresenceSessionLength);
        var client = Clipped(Text(args, "client"), MaxPresenceClientLength);
        if (client.Length == 0) throw new DataFault("Invalid client.");
        var handle = Blank(Clipped(Text(args, "handle"), MaxPresenceHandleLength));
        var note = Blank(Clipped(Text(args, "note"), MaxPresenceNoteLength));
        var taskId = Text(args, "task_id").Trim();
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct);
        // A task that is not in this workspace is dropped rather than refused:
        // the session is still present, only its pointer was wrong.
        var task = taskId.Length is > 0 and <= 200 && Find(Json(workspace.Data), taskId) is not null ? taskId : null;
        var now = DateTime.UtcNow;
        var row = await db.WorkspacePresence.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.UserId == owner && x.Session == session, ct);
        if (row is null)
        {
            row = new WorkspacePresence { WorkspaceId = id, UserId = owner, Session = session };
            db.WorkspacePresence.Add(row);
        }
        row.Client = client;
        row.Handle = handle;
        row.TaskId = task;
        row.Note = note;
        row.LastSeen = now;
        var expired = now.AddHours(-PresenceKeepHours);
        db.WorkspacePresence.RemoveRange(await db.WorkspacePresence
            .Where(x => x.WorkspaceId == id && x.LastSeen < expired).ToListAsync(ct));
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) when (db.Entry(row).State == EntityState.Added)
        {
            // Two touches from one session raced to insert; the other one won
            // and already says the same thing.
            db.ChangeTracker.Clear();
        }
        return new JsonObject { ["ok"] = true };
    }

    private async Task<JsonObject> EndPresence(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var session = Required(args, "session", MaxPresenceSessionLength);
        await WorkspaceAccess.Require(db, owner, id, ct);
        var row = await db.WorkspacePresence.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.UserId == owner && x.Session == session, ct);
        if (row is not null)
        {
            db.WorkspacePresence.Remove(row);
            await db.SaveChangesAsync(ct);
        }
        return new JsonObject { ["ok"] = true };
    }

    private async Task<JsonObject> ListPresence(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        await WorkspaceAccess.Require(db, owner, id, ct);
        return new JsonObject { ["presence"] = await LivePresence(id, DateTime.UtcNow, ct) };
    }

    private async Task<JsonArray> LivePresence(Guid id, DateTime now, CancellationToken ct)
    {
        var live = now.AddMinutes(-PresenceLiveMinutes);
        var rows = await db.WorkspacePresence.AsNoTracking()
            .Where(x => x.WorkspaceId == id && x.LastSeen >= live)
            .OrderBy(x => x.UserId).ThenBy(x => x.Session).ToListAsync(ct);
        if (rows.Count == 0) return [];
        var names = await DisplayNames(rows.Select(x => x.UserId), ct);
        return new JsonArray(rows.Select(x => (JsonNode?)new JsonObject
        {
            ["workspace_id"] = x.WorkspaceId.ToString(),
            ["session"] = x.Session,
            ["user_id"] = x.UserId.ToString(),
            ["user_name"] = names.GetValueOrDefault(x.UserId, ""),
            ["client"] = x.Client,
            ["handle"] = x.Handle,
            ["task_id"] = x.TaskId,
            ["note"] = x.Note,
            ["last_seen"] = Stamp(x.LastSeen)
        }).ToArray());
    }
}
