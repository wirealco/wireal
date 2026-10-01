using System.Security.Claims;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Projects;

public sealed partial class ProjectService(AppDbContext db)
{
    private const int MaxWorkspacesPerOwner = 20;
    private const int MaxProjectsPerWorkspace = 20;

    public static Guid Owner(ClaimsPrincipal user) => Guid.Parse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private static JsonObject Json(string value) => JsonNode.Parse(value)!.AsObject();
    private static string Text(JsonObject value, string key) => value[key]?.GetValue<string>() ?? "";
    private static string Required(JsonObject value, string key, int maximum)
    {
        var text = Text(value, key).Trim();
        if (text.Length < 1 || text.Length > maximum) throw new DataFault($"Invalid {key}.");
        value[key] = text;
        return text;
    }
    private static JsonObject WorkspaceRow(WorkspaceDocument row, Guid viewer, Guid? active) => new()
    {
        ["id"] = row.Id.ToString(), ["user_id"] = row.UserId.ToString(), ["data"] = JsonNode.Parse(row.Data),
        ["is_active"] = row.Id == active, ["revision"] = row.Revision, ["role"] = row.UserId == viewer ? "owner" : "collaborator",
        ["created_at"] = row.CreatedAt.ToString("O"), ["updated_at"] = row.UpdatedAt.ToString("O")
    };

    public async Task<DataResult> Query(Guid owner, DataQuery query, CancellationToken ct)
    {
        DataQueries.Validate(query);
        if (query.Operation != "select") return await Mutate(owner, query, ct);
        if (query.Table == "workspaces")
        {
            var active = await WorkspaceAccess.ActiveId(db, owner, ct);
            var rows = FilterWorkspaces(WorkspaceAccess.Visible(db, owner).AsNoTracking(), query, active);
            var count = query.Count ? await rows.CountAsync(ct) : (int?)null;
            var results = await rows.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).Skip(query.Offset).Take(query.Limit).ToListAsync(ct);
            return DataQueries.Result(results.Select(row => WorkspaceRow(row, owner, active)), query, count);
        }
        if (query.Table == "runners") return await Runners(owner, query, ct);
        if (query.Table == "flow_requests") return await FlowRequests(owner, query, ct);
        if (query.Table == "task_locks") return await TaskLocks(owner, query, ct);
        if (query.Table != "profiles") throw new DataFault("Unknown collection.", 404);
        var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == owner, ct);
        if ((query.Filters ?? []).Any(f => (f.Field is not ("id" or "user_id")) || f.Op != "eq" || f.Value?.GetValue<string>() != owner.ToString()))
            return DataQueries.Result([], query);
        return DataQueries.Result([new JsonObject
        {
            ["id"] = owner.ToString(), ["display_name"] = user.DisplayName, ["onboarding_done"] = user.OnboardingDone,
            ["language_prompt_done"] = user.LanguagePromptDone, ["preferred_language"] = user.PreferredLanguage
        }], query);
    }

    private static IQueryable<WorkspaceDocument> FilterWorkspaces(IQueryable<WorkspaceDocument> source, DataQuery query, Guid? active)
    {
        if ((query.Any?.Length ?? 0) > 0) throw new DataFault("Unsupported workspace filter.");
        foreach (var filter in query.Filters ?? [])
        {
            if (filter.Op != "eq") throw new DataFault("Unsupported workspace filter.");
            source = filter.Field switch
            {
                "id" => source.Where(x => x.Id == Guid.Parse(filter.Value!.GetValue<string>())),
                "user_id" => source.Where(x => x.UserId == Guid.Parse(filter.Value!.GetValue<string>())),
                "is_active" => filter.Value!.GetValue<bool>() ? source.Where(x => x.Id == active) : source.Where(x => x.Id != active),
                "revision" => source.Where(x => x.Revision == filter.Value!.GetValue<long>()),
                _ => throw new DataFault("Unsupported workspace filter.")
            };
        }
        return source;
    }

    // Every mutation touches the owner's concurrency token in the same SQL
    // transaction. This serializes workspace switching, report retries and
    // graph upserts across API replicas, without a process-local lock.
    private async Task<AppUser> BeginWrite(Guid owner, CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(x => x.Id == owner, ct);
        db.Entry(user).Property(x => x.Version).IsModified = true;
        return user;
    }
    private async Task<DataResult> Mutate(Guid owner, DataQuery query, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await BeginWrite(owner, ct);
        if (query.Table == "profiles" && query.Operation == "update")
        {
            if ((query.Filters ?? []).Any(x => x.Field != "id" || x.Op != "eq" || x.Value?.GetValue<string>() != owner.ToString()))
                throw new DataFault("Profile not found.", 404);
            var values = query.Values ?? throw new DataFault("Missing profile.");
            foreach (var (key, value) in values)
                switch (key)
                {
                    case "onboarding_done": user.OnboardingDone = value!.GetValue<bool>(); break;
                    case "language_prompt_done": user.LanguagePromptDone = value!.GetValue<bool>(); break;
                    case "preferred_language":
                        var language = value?.GetValue<string>();
                        if (language is not (null or "en" or "tr")) throw new DataFault("Unsupported language.");
                        user.PreferredLanguage = language; break;
                    default: throw new DataFault("Unsupported profile field.");
                }
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new(null);
        }
        if (query.Table != "workspaces") throw new DataFault("This collection can only be changed through a project command.", 403);
        var valuesObject = query.Values ?? new JsonObject();
        var rows = new List<WorkspaceDocument>();
        if (query.Operation == "insert")
        {
            if (valuesObject["user_id"] is not null && Text(valuesObject, "user_id") != owner.ToString()) throw new DataFault("Invalid owner.", 403);
            if (await db.Workspaces.CountAsync(x => x.UserId == owner, ct) >= MaxWorkspacesPerOwner)
                throw new DataFault($"You can create up to {MaxWorkspacesPerOwner} workspaces. Delete a workspace before creating another.", 409);
            var workspace = ValidateWorkspace(valuesObject["data"]);
            var active = !await db.Workspaces.AnyAsync(x => x.UserId == owner, ct);
            if (!active && valuesObject["is_active"]?.GetValue<bool>() == true) throw new DataFault("Use set_active_workspace to switch workspaces.");
            var row = new WorkspaceDocument
            {
                Id = valuesObject["id"] is null ? Guid.NewGuid() : Guid.Parse(Text(valuesObject, "id")),
                UserId = owner, Data = workspace.ToJsonString(), IsActive = active
            };
            db.Workspaces.Add(row);
            if (await WorkspaceAccess.ActiveId(db, owner, ct) is null) user.ActiveWorkspaceId = row.Id;
            rows.Add(row);
        }
        else if (query.Operation is "update" or "delete")
        {
            if (!(query.Filters ?? []).Any(x => x.Field == "id" && x.Op == "eq")) throw new DataFault("A workspace ID is required.");
            rows = await FilterWorkspaces(WorkspaceAccess.Visible(db, owner), query, await WorkspaceAccess.ActiveId(db, owner, ct)).ToListAsync(ct);
            if (query.Operation == "update")
            {
                if (!(query.Filters ?? []).Any(x => x.Field == "revision")) throw new DataFault("A workspace revision is required.", 428);
                foreach (var row in rows)
                {
                    await WorkspaceAccess.Require(db, owner, row.Id, ct, writing: true);
                    var previous = Json(row.Data);
                    var next = ValidateWorkspace(valuesObject["data"], previous);
                    if (row.UserId != owner) RepositoryScope.RequireUnchanged(previous, next);
                    await GuardLocks(owner, row.Id, previous, next, ct);
                    row.Data = next.ToJsonString(); row.Revision++; row.UpdatedAt = DateTime.UtcNow;
                }
            }
            else if (rows.Count > 0)
            {
                if (rows[0].UserId != owner) throw new DataFault("Only the owner can delete a workspace. You can leave it from the team window.", 403);
                var others = await db.Workspaces.Where(x => x.UserId == owner && x.Id != rows[0].Id).OrderBy(x => x.CreatedAt).ToListAsync(ct);
                db.Workspaces.Remove(rows[0]);
                if (user.ActiveWorkspaceId == rows[0].Id) user.ActiveWorkspaceId = null;
                await db.SaveChangesAsync(ct);
                if (rows[0].IsActive && others.Count > 0) { others[0].IsActive = true; others[0].Revision++; }
            }
        }
        else throw new DataFault("Unsupported operation.");
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        var activeId = await WorkspaceAccess.ActiveId(db, owner, ct);
        return DataQueries.Result(rows.Select(row => WorkspaceRow(row, owner, activeId)), query);
    }

    public async Task<object?> Command(Guid owner, string command, JsonObject args, CancellationToken ct)
    {
        // Presence is polled by every open CLI session; it skips the profile
        // write guard so it never collides with the person's real edits.
        switch (command)
        {
            case "touch_presence": return await TouchPresence(owner, args, ct);
            case "end_presence": return await EndPresence(owner, args, ct);
            case "list_presence": return await ListPresence(owner, args, ct);
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await BeginWrite(owner, ct);
        object? result;
        switch (command)
        {
            case "set_active_workspace":
                var id = Guid.Parse(Required(args, "target_workspace_id", 36));
                await WorkspaceAccess.Require(db, owner, id, ct);
                user.ActiveWorkspaceId = id;
                result = id; break;
            case "lock_task": result = await LockTask(owner, args, ct); break;
            case "unlock_task": result = await UnlockTask(owner, args, ct); break;
            case "claim_task": result = await ClaimTask(owner, args, ct); break;
            case "runner_heartbeat": result = await RunnerHeartbeat(owner, args, ct); break;
            case "set_runner_seats": result = await SetRunnerSeats(owner, args, ct); break;
            case "release_task": result = await ReleaseTask(owner, args, ct); break;
            case "request_merge": result = await RequestMerge(owner, args, ct); break;
            case "request_pull": result = await RequestPull(owner, args, ct); break;
            case "request_promote": result = await RequestPromote(owner, args, ct); break;
            case "complete_request": result = await CompleteRequest(owner, args, ct); break;
            case "cancel_flow": result = await CancelFlow(owner, args, ct); break;
            case "ping_runner": result = await PingRunner(owner, args, ct); break;
            case "runner_leave": result = await RunnerLeave(owner, args, ct); break;
            case "forget_runner": result = await ForgetRunner(owner, args, ct); break;
            default: throw new DataFault("Unknown command.", 404);
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return result;
    }

    private static JsonObject ValidateWorkspace(JsonNode? data, JsonObject? previous = null)
    {
        if (data is not JsonObject value || value["version"]?.GetValue<int>() != 9 || value["map"] is not JsonObject ||
            value["projects"] is not JsonArray projects || value["tasks"] is not JsonArray tasks ||
            value["links"] is not JsonArray links || value["labels"] is not JsonArray labels) throw new DataFault("Invalid workspace document.");
        if (value["map"]!["kind"] is not null && Text(value["map"]!.AsObject(), "kind") is not ("coding" or "everyday"))
            throw new DataFault("Workspace kind must be coding or everyday.");
        foreach (var array in new[] { projects, tasks, links, labels })
        {
            if (array.Count > 10000 || array.Any(x => x is not JsonObject || Text(x.AsObject(), "id").Length is < 1 or > 200) ||
                array.Select(x => Text(x!.AsObject(), "id")).Distinct().Count() != array.Count) throw new DataFault("Invalid or duplicate workspace IDs.");
        }
        if (projects.Count > MaxProjectsPerWorkspace)
        {
            // Keep existing over-limit workspaces usable for edits/deletions,
            // but reject new project IDs until the result is within the limit.
            var previousIds = previous?["projects"]?.AsArray()
                .Select(x => Text(x!.AsObject(), "id")).ToHashSet(StringComparer.Ordinal) ?? [];
            if (previous is null || projects.Any(x => !previousIds.Contains(Text(x!.AsObject(), "id"))))
                throw new DataFault($"Each workspace can have up to {MaxProjectsPerWorkspace} projects. Delete a project before creating another.", 409);
        }
        var projectIds = projects.Select(x => Text(x!.AsObject(), "id")).ToHashSet(StringComparer.Ordinal);
        var taskIds = tasks.Select(x => Text(x!.AsObject(), "id")).ToHashSet(StringComparer.Ordinal);
        // A task's labels are label names, not ids; an API client may still send
        // ids. Resolve both to the label they name and compare after resolving,
        // so a name and that label's own id in one task still count as duplicates.
        var labelIds = WorkspaceGraph.LabelIds(labels.Select(x => (Text(x!.AsObject(), "id"), Text(x!.AsObject(), "name"))));
        static bool ValidReferences(JsonArray values, HashSet<string> ids) =>
            values.All(x => x is JsonValue v && v.TryGetValue<string>(out var id) && ids.Contains(id)) &&
            values.Select(x => x!.GetValue<string>()).Distinct(StringComparer.Ordinal).Count() == values.Count;
        static bool ValidLabels(JsonArray values, Dictionary<string, string> ids) =>
            values.All(x => x is JsonValue v && v.TryGetValue<string>(out var label) && ids.ContainsKey(label)) &&
            values.Select(x => ids[x!.GetValue<string>()]).Distinct(StringComparer.Ordinal).Count() == values.Count;
        foreach (var task in tasks)
        {
            if (task!["projectIds"] is not JsonArray assigned || !ValidReferences(assigned, projectIds) ||
                task["activity"] is not JsonArray activity ||
                task["labels"] is JsonArray tags && !ValidLabels(tags, labelIds) ||
                task["parentId"] is JsonValue parent && (!parent.TryGetValue<string>(out var parentId) || !taskIds.Contains(parentId) || parentId == Text(task.AsObject(), "id")))
                throw new DataFault("Task relationships must reference projects, labels and tasks in this workspace.");
            if (activity.Any(x => x is not JsonObject || Text(x.AsObject(), "id").Length is < 1 or > 200) ||
                activity.Select(x => Text(x!.AsObject(), "id")).Distinct(StringComparer.Ordinal).Count() != activity.Count)
                throw new DataFault("Invalid or duplicate activity IDs.");
            foreach (var entry in activity) ValidateActivity(entry!.AsObject());
            if (task["status"] is not null && Text(task.AsObject(), "status") is not ("proposed" or "todo" or "doing" or "done"))
                throw new DataFault("Invalid task status.");
        }
        if (links.Any(x => !taskIds.Contains(Text(x!.AsObject(), "source")) || !taskIds.Contains(Text(x!.AsObject(), "target"))))
            throw new DataFault("Dependencies must reference tasks in this workspace.");
        return (JsonObject)value.DeepClone();
    }
    private static void ValidateActivity(JsonObject entry)
    {
        if (Text(entry, "text").Trim().Length is < 1 or > 4000) throw new DataFault("Activity text must be 1 to 4000 characters.");
        if (entry["kind"] is not null && Text(entry, "kind") is not ("change" or "discovery" or "decision" or "verification" or "blocker" or "review"))
            throw new DataFault("Activity kind must be change, discovery, decision, verification, blocker or review.");
        if (entry["to"] is not null && Text(entry, "to").Length > 200)
            throw new DataFault("Activity recipient must be 200 characters or fewer.");
        if (entry["commit"] is not null && !Regex.IsMatch(Text(entry, "commit"), "^[0-9a-f]{7,40}$"))
            throw new DataFault("Activity commit must be 7 to 40 hexadecimal characters.");
    }
}
