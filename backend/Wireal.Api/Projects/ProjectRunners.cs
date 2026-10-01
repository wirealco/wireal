using System.Text.Json.Nodes;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;

namespace Wireal.Api.Projects;

public sealed partial class ProjectService
{
    private const int MaxLeaseMinutes = 1440;
    private const int MaxRunnerAgents = 100;
    private const int MaxRunnerHostsLength = 500;
    private const int MaxRateLimitsBytes = 8192;
    private const int MaxWantedAgentsLength = 4000;
    private const int ConnectedSeconds = 120;
    private const int MaxAgentStepLength = 120;
    private const int MaxAgentLastLength = 300;
    private const int MaxAgentFiles = 20;
    private const int MaxAgentFileLength = 200;
    private sealed record RosterAgent(string Id, string Name, string Kind);

    // PostgreSQL keeps microseconds, so a moment answered straight from memory is cut to what a later read of the
    // same row will say: the two stamps must compare equal.
    private static string Stamp(DateTime value) =>
        new DateTime(value.Ticks - value.Ticks % 10, DateTimeKind.Utc).ToString("O");
    private static JsonNode? Stamp(DateTime? value) => value is null ? null : JsonValue.Create(Stamp(value.Value));
    private static string Optional(JsonObject args, string key, int maximum)
    {
        var text = Text(args, key).Trim();
        if (text.Length > maximum) throw new DataFault($"Invalid {key}.");
        return text;
    }
    private static int Minutes(JsonObject args)
    {
        if (args["lease_minutes"] is not JsonValue value || !value.TryGetValue<double>(out var minutes) ||
            minutes < 1 || minutes > MaxLeaseMinutes) throw new DataFault("Invalid lease_minutes.");
        return (int)minutes;
    }
    private static decimal Money(JsonObject args, string key)
    {
        if (args[key] is null) return 0m;
        if (args[key] is not JsonValue value || !value.TryGetValue<decimal>(out var amount) ||
            amount < 0m || amount > 1_000_000m) throw new DataFault($"Invalid {key}.");
        return Math.Round(amount, 6);
    }
    private static JsonArray RunnerAgents(JsonObject args)
    {
        if (args["agents"] is null) return [];
        if (args["agents"] is not JsonArray input || input.Count > MaxRunnerAgents) throw new DataFault("Invalid agents.");
        var result = new JsonArray();
        foreach (var node in input)
        {
            if (node is not JsonObject entry) throw new DataFault("Invalid agents.");
            var id = Text(entry, "id").Trim();
            var name = Text(entry, "name").Trim();
            var kind = Text(entry, "kind").Trim();
            var task = entry["task_id"] is JsonValue value && value.TryGetValue<string>(out var taskId) ? taskId.Trim() : "";
            var since = Text(entry, "since").Trim();
            // Why an agent that is seated is not working: the runner is told by
            // this API and has nowhere else to put the answer.
            var waiting = Text(entry, "waiting").Trim();
            if (id.Length is < 1 or > 200 || name.Length is < 1 or > 200 || kind is not ("claude" or "codex") ||
                task.Length > 200 || since.Length > 40 || waiting.Length > 300) throw new DataFault("Invalid agents.");
            // What the agent is doing right now. Older runners send none of
            // these; newer ones may send more than fits, which is cut, not refused.
            var step = Clipped(Text(entry, "step"), MaxAgentStepLength);
            var last = Clipped(Text(entry, "last"), MaxAgentLastLength);
            var files = AgentFiles(entry);
            var agent = new JsonObject
            {
                ["id"] = id,
                ["name"] = name,
                ["kind"] = kind,
                ["task_id"] = task.Length > 0 ? JsonValue.Create(task) : null,
                ["since"] = since.Length > 0 ? since : Stamp(DateTime.UtcNow),
                ["waiting"] = waiting.Length > 0 ? JsonValue.Create(waiting) : null
            };
            if (step.Length > 0) agent["step"] = step;
            if (last.Length > 0) agent["last"] = last;
            if (files.Count > 0) agent["files"] = files;
            result.Add(agent);
        }
        return result;
    }
    private static string Clipped(string text, int maximum)
    {
        text = text.Trim();
        return text.Length > maximum ? text[..maximum].TrimEnd() : text;
    }

    private static JsonArray AgentFiles(JsonObject entry)
    {
        if (entry["files"] is null) return [];
        if (entry["files"] is not JsonArray input) throw new DataFault("Invalid agents.");
        var result = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in input)
        {
            if (result.Count >= MaxAgentFiles) break;
            if (node is not JsonValue value || !value.TryGetValue<string>(out var path)) throw new DataFault("Invalid agents.");
            path = path.Trim();
            // A path keeps its end: the file name is the part worth showing.
            if (path.Length > MaxAgentFileLength) path = path[^MaxAgentFileLength..];
            if (path.Length > 0 && seen.Add(path)) result.Add(path);
        }
        return result;
    }

    private static List<string> WantedAgents(JsonObject args)
    {
        if (args["agents"] is null) return [];
        if (args["agents"] is not JsonArray input || input.Count > MaxRunnerAgents) throw new DataFault("Invalid agents.");
        var result = new List<string>();
        foreach (var node in input)
        {
            if (node is not JsonValue value || !value.TryGetValue<string>(out var agentId)) throw new DataFault("Invalid agents.");
            agentId = agentId.Trim();
            if (agentId.Length is < 1 or > 200) throw new DataFault("Invalid agents.");
            if (!result.Contains(agentId, StringComparer.Ordinal)) result.Add(agentId);
        }
        return result;
    }

    private static string Picked(IEnumerable<string> agents)
    {
        var json = new JsonArray(agents.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()).ToJsonString();
        if (json.Length > MaxWantedAgentsLength) throw new DataFault("Invalid agents.");
        return json;
    }

    private static JsonArray Wanted(WorkspaceRunner presence) =>
        presence.WantedAgentsJson is null ? [] : JsonNode.Parse(presence.WantedAgentsJson)!.AsArray();

    private static JsonArray RunnerHosts(JsonObject args)
    {
        if (args["hosts"] is null) return [];
        if (args["hosts"] is not JsonArray input) throw new DataFault("Invalid hosts.");
        var result = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in input)
        {
            if (node is not JsonValue value || !value.TryGetValue<string>(out var kind) || kind is not ("claude" or "codex") || !seen.Add(kind))
                throw new DataFault("Invalid hosts.");
            result.Add(kind);
        }
        if (result.ToJsonString().Length > MaxRunnerHostsLength) throw new DataFault("Invalid hosts.");
        return result;
    }
    private static string? RunnerRateLimits(JsonObject args)
    {
        if (!args.ContainsKey("rate_limits")) return null;
        if (args["rate_limits"] is not JsonObject limits) throw new DataFault("Invalid rate_limits.");
        var json = limits.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) > MaxRateLimitsBytes) throw new DataFault("Invalid rate_limits.");
        return json;
    }

    private static string? RunnerFolder(JsonObject args)
    {
        if (!args.ContainsKey("folder") || args["folder"] is null) return null;
        if (args["folder"] is not JsonObject folder ||
            folder["branch"] is not JsonValue branchValue || !branchValue.TryGetValue<string>(out var branch) ||
            folder["dirty"] is not JsonValue dirtyValue || !dirtyValue.TryGetValue<bool>(out var dirty) ||
            folder["behind"] is not JsonValue behindValue || !behindValue.TryGetValue<int>(out var behind) || behind < 0)
            throw new DataFault("Invalid folder.");
        var ahead = Distance(folder, "ahead");
        var path = folder["path"] is JsonValue pathValue && pathValue.TryGetValue<string>(out var reported)
            ? reported.Trim()
            : "";
        if (path.Length > 200) path = path[^200..];
        var upstream = folder["upstream"] is JsonValue upstreamValue && upstreamValue.TryGetValue<string>(out var tracked)
            ? tracked.Trim()
            : "";
        if (upstream.Length > 120) upstream = upstream[..120];
        var json = new JsonObject
        {
            ["branch"] = branch.Trim(),
            ["dirty"] = dirty,
            ["ahead"] = ahead,
            ["behind"] = behind,
            ["upstream"] = upstream,
            ["path"] = path
        }.ToJsonString();
        if (json.Length > 500) throw new DataFault("Invalid folder.");
        return json;
    }

    private static int Distance(JsonObject folder, string key)
    {
        if (folder[key] is null) return 0;
        if (folder[key] is not JsonValue value || !value.TryGetValue<int>(out var distance) || distance < 0)
            throw new DataFault("Invalid folder.");
        return distance;
    }

    private static bool Flag(JsonObject args, string key)
    {
        if (args[key] is null) return false;
        if (args[key] is not JsonValue value || !value.TryGetValue<bool>(out var flag)) throw new DataFault($"Invalid {key}.");
        return flag;
    }

    private static JsonObject? Find(JsonObject document, string taskId) =>
        document["tasks"]!.AsArray().FirstOrDefault(x => Text(x!.AsObject(), "id") == taskId)?.AsObject();

    private static string Reference(JsonObject document, string taskId)
    {
        var reference = Find(document, taskId) is { } task ? Text(task, "referenceId") : "";
        return reference.Length > 0 ? reference : taskId;
    }

    private static IEnumerable<string> Downstream(JsonObject document, string taskId)
    {
        foreach (var node in document["tasks"]!.AsArray())
            if (node is JsonObject task && Text(task, "parentId") == taskId) yield return Text(task, "id");
        foreach (var node in document["links"]!.AsArray())
            if (node is JsonObject link && Text(link, "source") == taskId) yield return Text(link, "target");
    }

    private static List<string> LockLine(JsonObject document, string taskId, bool line, bool skipDone)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal) { taskId };
        var walk = new Queue<string>();
        var order = new List<string> { taskId };
        walk.Enqueue(taskId);
        while (line && walk.Count > 0)
            foreach (var next in Downstream(document, walk.Dequeue()))
                if (next.Length > 0 && seen.Add(next)) { order.Add(next); walk.Enqueue(next); }
        return order.Where(id => Find(document, id) is { } task && (!skipDone || Text(task, "status") != "done")).ToList();
    }

    private static HashSet<string> IncomingPairs(JsonObject document, string taskId) =>
        document["links"]!.AsArray().OfType<JsonObject>()
            .Where(link => Text(link, "target") == taskId)
            .Select(link => Text(link, "source") + "\u2192" + Text(link, "target"))
            .ToHashSet(StringComparer.Ordinal);

    private static JsonObject LockRow(WorkspaceTaskLock row, string ownerName) => new()
    {
        ["workspace_id"] = row.WorkspaceId.ToString(),
        ["task_id"] = row.TaskId,
        ["agent"] = row.Agent,
        ["owner_id"] = row.OwnerUserId.ToString(),
        ["owner_name"] = ownerName,
        ["since"] = Stamp(row.Since)
    };

    private async Task<Dictionary<Guid, string>> DisplayNames(IEnumerable<Guid> users, CancellationToken ct)
    {
        var ids = users.Distinct().ToList();
        return await db.Users.AsNoTracking().Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.DisplayName, ct);
    }

    private static IReadOnlyList<RosterAgent> AgentRoster(JsonObject document)
    {
        if (document["map"]?["agents"]?["roster"] is not JsonArray { Count: > 0 } roster)
            return [new RosterAgent("default", "Claude", "claude")];
        return roster.OfType<JsonObject>()
            .Where(entry => entry["enabled"] is JsonValue value && value.TryGetValue<bool>(out var enabled) && enabled)
            .Select(entry => new RosterAgent(Text(entry, "id").Trim(), Text(entry, "name").Trim(), Text(entry, "kind").Trim()))
            .Where(agent => agent.Id.Length > 0 && agent.Name.Length > 0 && agent.Kind is "claude" or "codex")
            .ToArray();
    }

    private static string[] ProjectIds(JsonObject task) => task["projectIds"] is JsonArray ids
        ? ids.OfType<JsonValue>().Select(x => x.TryGetValue<string>(out var value) ? value : "").Where(x => x.Length > 0).ToArray()
        : [];

    private async Task<JsonObject> ClaimTask(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var taskId = Required(args, "task_id", 200);
        var agent = Required(args, "agent", 200);
        var runner = Required(args, "runner", 100);
        var minutes = Minutes(args);
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var now = DateTime.UtcNow;
        var document = Json(workspace.Data);
        var task = document["tasks"]!.AsArray().FirstOrDefault(x => Text(x!.AsObject(), "id") == taskId)?.AsObject()
            ?? throw new DataFault("Task not found.", 404);
        var lease = await db.WorkspaceLeases.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.TaskId == taskId, ct);
        var live = lease is not null && DateTime.SpecifyKind(lease.Until, DateTimeKind.Utc) > now;
        var claimable = Text(task, "status") switch
        {
            "todo" => !live,
            "doing" => lease is not null && !live,
            _ => false
        };
        if (!claimable) throw new DataFault("Task is not claimable.", 409);
        var held = await db.WorkspaceTaskLocks.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.TaskId == taskId, ct);
        if (held is null || held.OwnerUserId != owner) throw new DataFault("Task is not locked to you.", 409);
        if (held.Agent is { Length: > 0 } wanted && wanted != agent) throw new DataFault("Task is locked to another agent.", 409);
        if (!await db.WorkspaceAgentSeats.AnyAsync(x => x.WorkspaceId == id && x.AgentId == agent && x.RunnerId == runner, ct))
            throw new DataFault("Agent is not seated on this runner.", 409);
        if (await db.WorkspaceLeases.AnyAsync(x => x.WorkspaceId == id && x.TaskId != taskId && x.Agent == agent && x.Until > now, ct))
            throw new DataFault("Agent is busy.", 409);
        var mine = ProjectIds(task);
        if (mine.Length > 0)
        {
            var working = (await db.WorkspaceLeases
                .Where(x => x.WorkspaceId == id && x.TaskId != taskId && x.Until > now)
                .Select(x => x.TaskId).ToListAsync(ct)).ToHashSet(StringComparer.Ordinal);
            var busy = working.Count == 0 ? [] : document["tasks"]!.AsArray()
                .Where(x => working.Contains(Text(x!.AsObject(), "id")))
                .SelectMany(x => ProjectIds(x!.AsObject()))
                .ToHashSet(StringComparer.Ordinal);
            if (mine.Any(busy.Contains)) throw new DataFault("Another agent is working in this project.", 409);
        }
        var until = now.AddMinutes(minutes);
        if (lease is null)
            db.WorkspaceLeases.Add(new WorkspaceLease { WorkspaceId = id, TaskId = taskId, Agent = agent, RunnerId = runner, Since = now, Until = until });
        else { lease.Agent = agent; lease.RunnerId = runner; lease.Since = now; lease.Until = until; }
        task["status"] = "doing";
        workspace.Data = document.ToJsonString();
        workspace.Revision++;
        workspace.UpdatedAt = now;
        return new JsonObject { ["task_id"] = taskId, ["until"] = Stamp(until) };
    }

    private async Task<JsonObject> RunnerHeartbeat(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var runnerId = Required(args, "runner", 100);
        var minutes = Minutes(args);
        var agents = RunnerAgents(args);
        var hosts = RunnerHosts(args);
        var rateLimits = RunnerRateLimits(args);
        var folder = RunnerFolder(args);
        var cost = Money(args, "cost_usd");
        var name = Optional(args, "name", 200);
        var host = Optional(args, "host", 200);
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var now = DateTime.UtcNow;
        var stale = await db.WorkspaceRunners
            .Where(x => x.WorkspaceId == id && x.RunnerId != runnerId && x.LastSeen < now.AddDays(-7))
            .ToListAsync(ct);
        var gone = stale.Select(x => x.RunnerId).ToList();
        if (stale.Count > 0)
        {
            db.WorkspaceRunners.RemoveRange(stale);
            db.WorkspaceLeases.RemoveRange(await db.WorkspaceLeases
                .Where(x => x.WorkspaceId == id && gone.Contains(x.RunnerId))
                .ToListAsync(ct));
            db.WorkspaceAgentSeats.RemoveRange(await db.WorkspaceAgentSeats
                .Where(x => x.WorkspaceId == id && gone.Contains(x.RunnerId))
                .ToListAsync(ct));
        }
        var presence = await db.WorkspaceRunners.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.RunnerId == runnerId, ct);
        if (presence is null)
        {
            presence = new WorkspaceRunner { WorkspaceId = id, RunnerId = runnerId, Since = now };
            db.WorkspaceRunners.Add(presence);
        }
        presence.OwnerUserId = owner;
        presence.Name = name.Length > 0 ? name : runnerId;
        presence.Host = host;
        presence.AgentsJson = agents.ToJsonString();
        presence.HostsJson = hosts.ToJsonString();
        if (rateLimits is not null) presence.RateLimitsJson = rateLimits;
        presence.FolderJson = folder;
        presence.CostUsd = cost;
        presence.LastSeen = now;
        if (presence.PingRequestedAt is { } requested && (presence.PingAnsweredAt is null || presence.PingAnsweredAt < requested))
            presence.PingAnsweredAt = now;
        var until = now.AddMinutes(minutes);
        var leases = await db.WorkspaceLeases.Where(x => x.WorkspaceId == id && x.RunnerId == runnerId).ToListAsync(ct);
        foreach (var lease in leases) lease.Until = until;
        var seats = await Seat(id, owner, presence, Json(workspace.Data), now, gone, ct);
        var locks = await db.WorkspaceTaskLocks.AsNoTracking()
            .Where(x => x.WorkspaceId == id && x.OwnerUserId == owner).OrderBy(x => x.TaskId).ToListAsync(ct);
        var requests = await db.WorkspaceFlowRequests.AsNoTracking()
            .Where(x => x.WorkspaceId == id && (x.Kind == "merge" || x.Kind == "pull" || x.Kind == "promote"))
            .OrderBy(x => x.RequestedAt).ThenBy(x => x.Id).ToListAsync(ct);
        return new JsonObject
        {
            ["leases"] = new JsonArray(leases.OrderBy(x => x.TaskId, StringComparer.Ordinal)
                .Select(x => (JsonNode?)new JsonObject { ["task_id"] = x.TaskId, ["until"] = Stamp(x.Until) }).ToArray()),
            ["seats"] = new JsonArray(Held(seats, runnerId).Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()),
            ["wanted"] = Wanted(presence),
            ["locks"] = new JsonArray(locks.Select(x => (JsonNode?)new JsonObject
            {
                ["task_id"] = x.TaskId, ["agent"] = x.Agent, ["since"] = Stamp(x.Since)
            }).ToArray()),
            ["requests"] = new JsonArray(requests.Select(x => (JsonNode?)new JsonObject
            {
                ["request_id"] = x.Id.ToString(), ["task_id"] = x.TaskId, ["agent"] = x.Agent,
                ["kind"] = x.Kind, ["requested_at"] = Stamp(x.RequestedAt)
            }).ToArray()),
            ["ping_requested_at"] = Stamp(presence.PingRequestedAt),
            ["ping_answered_at"] = Stamp(presence.PingAnsweredAt),
            ["presence"] = await LivePresence(id, now, ct),
            ["server_time"] = Stamp(now)
        };
    }

    private async Task<List<WorkspaceAgentSeat>> Seat(Guid id, Guid owner, WorkspaceRunner presence, JsonObject document,
        DateTime now, List<string> gone, CancellationToken ct)
    {
        var runnerId = presence.RunnerId;
        var roster = AgentRoster(document).Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        var reported = JsonNode.Parse(presence.AgentsJson)!.AsArray().OfType<JsonObject>()
            .Select(x => Text(x, "id")).ToHashSet(StringComparer.Ordinal);
        var picked = Wanted(presence).Select(x => x!.GetValue<string>())
            .Where(agentId => roster.Contains(agentId) && reported.Contains(agentId)).ToHashSet(StringComparer.Ordinal);
        var seats = await db.WorkspaceAgentSeats.Where(x => x.WorkspaceId == id && !gone.Contains(x.RunnerId)).ToListAsync(ct);
        var connected = now.AddSeconds(-ConnectedSeconds);
        var live = await db.WorkspaceRunners.AsNoTracking()
            .Where(x => x.WorkspaceId == id && x.RunnerId != runnerId && x.LastSeen >= connected)
            .Select(x => x.RunnerId).ToListAsync(ct);
        foreach (var seat in seats.ToList())
        {
            if (seat.RunnerId == runnerId)
            {
                if (picked.Contains(seat.AgentId)) seat.OwnerUserId = owner;
                else { db.WorkspaceAgentSeats.Remove(seat); seats.Remove(seat); }
                continue;
            }
            if (!picked.Contains(seat.AgentId) || live.Contains(seat.RunnerId)) continue;
            seat.RunnerId = runnerId;
            seat.OwnerUserId = owner;
            seat.Since = now;
        }
        foreach (var agentId in picked.Where(agentId => seats.All(x => x.AgentId != agentId)))
        {
            var seat = new WorkspaceAgentSeat { WorkspaceId = id, AgentId = agentId, RunnerId = runnerId, OwnerUserId = owner, Since = now };
            db.WorkspaceAgentSeats.Add(seat);
            seats.Add(seat);
        }
        return seats;
    }

    private static List<string> Held(List<WorkspaceAgentSeat> seats, string runnerId) =>
        seats.Where(x => x.RunnerId == runnerId).Select(x => x.AgentId).Order(StringComparer.Ordinal).ToList();

    private async Task<JsonObject> SetRunnerSeats(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var runnerId = Required(args, "runner", 100);
        var wanted = WantedAgents(args);
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var presence = await db.WorkspaceRunners.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.RunnerId == runnerId, ct)
            ?? throw new DataFault("Runner not found.", 404);
        if (presence.OwnerUserId != owner) throw new DataFault("Only the runner's owner can pick its agents.", 403);
        var document = Json(workspace.Data);
        var roster = AgentRoster(document).Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        if (wanted.Any(agentId => !roster.Contains(agentId))) throw new DataFault("Unknown agent.");
        presence.WantedAgentsJson = Picked(wanted);
        var now = DateTime.UtcNow;
        var seats = await Seat(id, owner, presence, document, now, [], ct);
        var connected = now.AddSeconds(-ConnectedSeconds);
        var holders = await db.WorkspaceRunners.AsNoTracking()
            .Where(x => x.WorkspaceId == id && x.RunnerId != runnerId && x.LastSeen >= connected).ToListAsync(ct);
        var names = await DisplayNames(holders.Select(x => x.OwnerUserId), ct);
        var taken = seats
            .Where(seat => seat.RunnerId != runnerId && wanted.Contains(seat.AgentId, StringComparer.Ordinal))
            .Select(seat => (Seat: seat, Holder: holders.FirstOrDefault(x => x.RunnerId == seat.RunnerId)))
            .Where(pair => pair.Holder is not null)
            .OrderBy(pair => pair.Seat.AgentId, StringComparer.Ordinal);
        return new JsonObject
        {
            ["seats"] = new JsonArray(Held(seats, runnerId).Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()),
            ["taken"] = new JsonArray(taken.Select(pair => (JsonNode?)new JsonObject
            {
                ["agent_id"] = pair.Seat.AgentId,
                ["runner_id"] = pair.Holder!.RunnerId,
                ["runner_name"] = pair.Holder.Name,
                ["owner_name"] = names.GetValueOrDefault(pair.Holder.OwnerUserId, "")
            }).ToArray())
        };
    }

    private async Task<JsonObject> LockTask(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var taskId = Required(args, "task_id", 200);
        var agent = Optional(args, "agent", 200);
        var line = Flag(args, "line");
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var now = DateTime.UtcNow;
        var document = Json(workspace.Data);
        var task = Find(document, taskId) ?? throw new DataFault("Task not found.", 404);
        if (!await db.WorkspaceRunners.AnyAsync(x => x.WorkspaceId == id && x.OwnerUserId == owner && x.LastSeen >= now.AddSeconds(-ConnectedSeconds), ct))
            throw new DataFault("Connect a runner first.", 409);
        if (Text(task, "status") == "done") throw new DataFault("Task is done.", 409);
        if (agent.Length > 0 && AgentRoster(document).All(entry => entry.Id != agent)) throw new DataFault("Unknown agent.", 409);
        var targets = LockLine(document, taskId, line, skipDone: true);
        var existing = await db.WorkspaceTaskLocks.Where(x => x.WorkspaceId == id && targets.Contains(x.TaskId)).ToListAsync(ct);
        var names = await DisplayNames(existing.Select(x => x.OwnerUserId).Append(owner), ct);
        foreach (var target in targets)
            if (existing.FirstOrDefault(x => x.TaskId == target) is { } taken && taken.OwnerUserId != owner)
                throw new DataFault($"#{Reference(document, target)} is locked by {names.GetValueOrDefault(taken.OwnerUserId, "")}.", 409);
        var held = new List<WorkspaceTaskLock>();
        foreach (var target in targets)
        {
            var current = existing.FirstOrDefault(x => x.TaskId == target);
            if (current is null)
            {
                current = new WorkspaceTaskLock
                {
                    WorkspaceId = id, TaskId = target, OwnerUserId = owner,
                    Agent = agent.Length > 0 ? agent : null, Since = now
                };
                db.WorkspaceTaskLocks.Add(current);
            }
            else if (agent.Length > 0) current.Agent = agent;
            held.Add(current);
        }
        return new JsonObject
        {
            ["locks"] = new JsonArray(held.Select(x => (JsonNode?)LockRow(x, names.GetValueOrDefault(owner, ""))).ToArray())
        };
    }

    private async Task<JsonObject> UnlockTask(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var taskId = Required(args, "task_id", 200);
        var line = Flag(args, "line");
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var now = DateTime.UtcNow;
        var document = Json(workspace.Data);
        var targets = LockLine(document, taskId, line, skipDone: false);
        var locks = await db.WorkspaceTaskLocks.Where(x => x.WorkspaceId == id && targets.Contains(x.TaskId)).ToListAsync(ct);
        if (locks.Any(x => x.OwnerUserId != owner) && workspace.UserId != owner)
            throw new DataFault("Only the lock owner or the workspace owner can unlock.", 403);
        if (locks.Count == 0) return new JsonObject { ["unlocked"] = new JsonArray() };
        var name = (await DisplayNames([owner], ct)).GetValueOrDefault(owner, "");
        var unlocked = new JsonArray();
        var told = false;
        foreach (var target in targets)
        {
            if (locks.FirstOrDefault(x => x.TaskId == target) is not { } held) continue;
            db.WorkspaceTaskLocks.Remove(held);
            if (await db.WorkspaceLeases.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.TaskId == target, ct) is { } lease)
                db.WorkspaceLeases.Remove(lease);
            unlocked.Add(target);
            var task = Find(document, target)!;
            if (Text(task, "status") == "done") continue;
            if (Text(task, "status") == "doing") task["status"] = "todo";
            task["activity"]!.AsArray().Add(new JsonObject
            {
                ["id"] = Guid.NewGuid().ToString(),
                ["text"] = $"Lock removed by {name}. The runner stops here.",
                ["at"] = Stamp(now),
                ["author"] = name,
                ["authorType"] = "user",
                ["authorId"] = owner.ToString()
            });
            told = true;
        }
        if (told)
        {
            workspace.Data = document.ToJsonString();
            workspace.Revision++;
            workspace.UpdatedAt = now;
        }
        return new JsonObject { ["unlocked"] = unlocked };
    }

    private async Task<JsonObject> ReleaseTask(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var taskId = Required(args, "task_id", 200);
        var runnerId = Required(args, "runner", 100);
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var lease = await db.WorkspaceLeases.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.TaskId == taskId && x.RunnerId == runnerId, ct);
        if (lease is not null) db.WorkspaceLeases.Remove(lease);
        var finished = Find(Json(workspace.Data), taskId) is { } task && Text(task, "status") == "done";
        var held = finished
            ? await db.WorkspaceTaskLocks.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.TaskId == taskId && x.OwnerUserId == owner, ct)
            : null;
        if (held is not null) db.WorkspaceTaskLocks.Remove(held);
        return new JsonObject { ["released"] = lease is not null, ["unlocked"] = held is not null };
    }

    private async Task<JsonObject> RequestMerge(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var taskId = Required(args, "task_id", 200);
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var task = Json(workspace.Data)["tasks"]!.AsArray()
            .FirstOrDefault(x => Text(x!.AsObject(), "id") == taskId)?.AsObject()
            ?? throw new DataFault("Task not found.", 404);
        if (Text(task, "status") != "done") throw new DataFault("Task is not done.", 409);
        if (task["commitUrls"] is not JsonArray { Count: > 0 }) throw new DataFault("Task has no commit.", 409);
        if (await db.WorkspaceFlowRequests.AnyAsync(x => x.WorkspaceId == id && x.TaskId == taskId && x.Kind == "merge", ct))
            throw new DataFault("A merge is already pending.", 409);
        var request = new WorkspaceFlowRequest
        {
            WorkspaceId = id, TaskId = taskId, Kind = "merge", RequestedByUserId = owner, RequestedAt = DateTime.UtcNow
        };
        db.WorkspaceFlowRequests.Add(request);
        return new JsonObject { ["request_id"] = request.Id.ToString(), ["task_id"] = taskId };
    }

    private async Task<JsonObject> RequestPull(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var runnerId = Required(args, "runner", 100);
        await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var presence = await db.WorkspaceRunners.AsNoTracking().SingleOrDefaultAsync(x => x.WorkspaceId == id && x.RunnerId == runnerId, ct)
            ?? throw new DataFault("Unknown runner.", 409);
        if (presence.OwnerUserId != owner) throw new DataFault("Only the runner's owner can do that.", 403);
        if (await db.WorkspaceFlowRequests.AnyAsync(x => x.WorkspaceId == id && x.TaskId == runnerId && x.Kind == "pull", ct))
            throw new DataFault("A pull is already pending.", 409);
        var request = new WorkspaceFlowRequest
        {
            WorkspaceId = id, TaskId = runnerId, Kind = "pull", RequestedByUserId = owner, RequestedAt = DateTime.UtcNow
        };
        db.WorkspaceFlowRequests.Add(request);
        return new JsonObject { ["request_id"] = request.Id.ToString(), ["runner"] = runnerId };
    }

    private async Task<JsonObject> RequestPromote(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var runnerId = Required(args, "runner", 100);
        await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var presence = await db.WorkspaceRunners.AsNoTracking().SingleOrDefaultAsync(x => x.WorkspaceId == id && x.RunnerId == runnerId, ct)
            ?? throw new DataFault("Unknown runner.", 409);
        if (presence.OwnerUserId != owner) throw new DataFault("Only the runner's owner can do that.", 403);
        if (await db.WorkspaceFlowRequests.AnyAsync(x => x.WorkspaceId == id && x.TaskId == runnerId && x.Kind == "promote", ct))
            throw new DataFault("A promotion is already pending.", 409);
        var request = new WorkspaceFlowRequest
        {
            WorkspaceId = id, TaskId = runnerId, Kind = "promote", RequestedByUserId = owner, RequestedAt = DateTime.UtcNow
        };
        db.WorkspaceFlowRequests.Add(request);
        return new JsonObject { ["request_id"] = request.Id.ToString(), ["runner"] = runnerId };
    }

    private async Task<JsonObject> CompleteRequest(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var requestId = Guid.Parse(Required(args, "request_id", 36));
        await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var request = await db.WorkspaceFlowRequests.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.Id == requestId, ct);
        if (request is not null) db.WorkspaceFlowRequests.Remove(request);
        return new JsonObject { ["completed"] = request is not null };
    }

    private async Task<JsonObject> CancelFlow(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var requestId = Guid.Parse(Required(args, "request_id", 36));
        await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var request = await db.WorkspaceFlowRequests.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.Id == requestId, ct);
        if (request is not null) db.WorkspaceFlowRequests.Remove(request);
        return new JsonObject { ["cancelled"] = request is not null };
    }

    private async Task<JsonObject> PingRunner(Guid owner, JsonObject args, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var runnerId = Required(args, "runner", 100);
        await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var presence = await db.WorkspaceRunners.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.RunnerId == runnerId, ct)
            ?? throw new DataFault("Runner not found.", 404);
        if (presence.OwnerUserId != owner) throw new DataFault("Only the runner's owner can do that.", 403);
        var now = DateTime.UtcNow;
        presence.PingRequestedAt = now;
        return new JsonObject { ["ping_requested_at"] = Stamp(now) };
    }

    private async Task<JsonObject> RunnerLeave(Guid owner, JsonObject args, CancellationToken ct)
        => await RemoveRunner(owner, args, "left", false, ct);

    private async Task<JsonObject> ForgetRunner(Guid owner, JsonObject args, CancellationToken ct)
        => await RemoveRunner(owner, args, "forgotten", true, ct);

    private async Task<JsonObject> RemoveRunner(Guid owner, JsonObject args, string resultKey, bool guarded, CancellationToken ct)
    {
        var id = Guid.Parse(Required(args, "workspace_id", 36));
        var runnerId = Required(args, "runner", 100);
        var workspace = await WorkspaceAccess.Require(db, owner, id, ct, writing: true);
        var presence = await db.WorkspaceRunners.SingleOrDefaultAsync(x => x.WorkspaceId == id && x.RunnerId == runnerId, ct);
        if (guarded && presence is not null && presence.OwnerUserId != owner && workspace.UserId != owner)
            throw new DataFault("Only the runner's owner or the workspace owner can forget it.", 403);
        if (presence is not null) db.WorkspaceRunners.Remove(presence);
        db.WorkspaceLeases.RemoveRange(await db.WorkspaceLeases.Where(x => x.WorkspaceId == id && x.RunnerId == runnerId).ToListAsync(ct));
        db.WorkspaceAgentSeats.RemoveRange(await db.WorkspaceAgentSeats.Where(x => x.WorkspaceId == id && x.RunnerId == runnerId).ToListAsync(ct));
        return new JsonObject { [resultKey] = true };
    }

    private async Task<DataResult> FlowRequests(Guid owner, DataQuery query, CancellationToken ct)
    {
        if ((query.Any?.Length ?? 0) > 0) throw new DataFault("Unsupported flow request filter.");
        var filters = query.Filters ?? [];
        if (filters.Any(x => x.Field != "workspace_id" || x.Op != "eq")) throw new DataFault("Unsupported flow request filter.");
        var chosen = filters.FirstOrDefault() ?? throw new DataFault("A workspace ID is required.");
        var id = Guid.Parse(chosen.Value!.GetValue<string>());
        await WorkspaceAccess.Require(db, owner, id, ct);
        var source = db.WorkspaceFlowRequests.AsNoTracking().Where(x => x.WorkspaceId == id);
        var count = query.Count ? await source.CountAsync(ct) : (int?)null;
        var requests = await source.OrderBy(x => x.RequestedAt).ThenBy(x => x.Id).Skip(query.Offset).Take(query.Limit).ToListAsync(ct);
        var requesters = requests.Select(x => x.RequestedByUserId).Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(x => requesters.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => x.DisplayName, ct);
        return DataQueries.Result(requests.Select(request => new JsonObject
        {
            ["request_id"] = request.Id.ToString(),
            ["task_id"] = request.TaskId,
            ["agent"] = request.Agent,
            ["kind"] = request.Kind,
            ["requested_by"] = request.RequestedByUserId.ToString(),
            ["requested_by_name"] = names.GetValueOrDefault(request.RequestedByUserId, ""),
            ["requested_at"] = Stamp(request.RequestedAt)
        }), query, count);
    }

    private async Task<DataResult> TaskLocks(Guid owner, DataQuery query, CancellationToken ct)
    {
        if ((query.Any?.Length ?? 0) > 0) throw new DataFault("Unsupported lock filter.");
        var filters = query.Filters ?? [];
        if (filters.Any(x => x.Field != "workspace_id" || x.Op != "eq")) throw new DataFault("Unsupported lock filter.");
        var chosen = filters.FirstOrDefault() ?? throw new DataFault("A workspace ID is required.");
        var id = Guid.Parse(chosen.Value!.GetValue<string>());
        await WorkspaceAccess.Require(db, owner, id, ct);
        var source = db.WorkspaceTaskLocks.AsNoTracking().Where(x => x.WorkspaceId == id);
        var count = query.Count ? await source.CountAsync(ct) : (int?)null;
        var locks = await source.OrderBy(x => x.TaskId).Skip(query.Offset).Take(query.Limit).ToListAsync(ct);
        var names = await DisplayNames(locks.Select(x => x.OwnerUserId), ct);
        return DataQueries.Result(locks.Select(row => LockRow(row, names.GetValueOrDefault(row.OwnerUserId, ""))), query, count);
    }

    private async Task GuardLocks(Guid owner, Guid id, JsonObject previous, JsonObject next, CancellationToken ct)
    {
        var locks = await db.WorkspaceTaskLocks.AsNoTracking().Where(x => x.WorkspaceId == id).ToListAsync(ct);
        if (locks.Count == 0) return;
        var names = await DisplayNames(locks.Select(x => x.OwnerUserId), ct);
        foreach (var held in locks)
        {
            if (Find(previous, held.TaskId) is not { } before) continue;
            var refused = $"#{Reference(previous, held.TaskId)} is locked by {names.GetValueOrDefault(held.OwnerUserId, "")}";
            if (Find(next, held.TaskId) is not { } after) throw new DataFault($"{refused} and cannot be deleted.", 409);
            if (new[] { "name", "objective", "parentId" }.Any(field => Text(before, field).Trim() != Text(after, field).Trim()) ||
                !IncomingPairs(previous, held.TaskId).SetEquals(IncomingPairs(next, held.TaskId)) ||
                Text(before, "status") != Text(after, "status") && held.OwnerUserId != owner)
                throw new DataFault($"{refused}.", 409);
        }
    }

    private async Task<DataResult> Runners(Guid owner, DataQuery query, CancellationToken ct)
    {
        if ((query.Any?.Length ?? 0) > 0) throw new DataFault("Unsupported runner filter.");
        var filters = query.Filters ?? [];
        if (filters.Any(x => x.Field != "workspace_id" || x.Op != "eq")) throw new DataFault("Unsupported runner filter.");
        IQueryable<WorkspaceDocument> visible;
        var chosen = filters.FirstOrDefault();
        if (chosen is null)
            visible = WorkspaceAccess.Visible(db, owner).IgnoreAutoIncludes().AsNoTracking();
        else
        {
            var id = Guid.Parse(chosen.Value!.GetValue<string>());
            await WorkspaceAccess.Require(db, owner, id, ct);
            visible = db.Workspaces.IgnoreAutoIncludes().AsNoTracking().Where(x => x.Id == id);
        }
        var source = from runner in db.WorkspaceRunners.AsNoTracking()
                     join workspace in visible on runner.WorkspaceId equals workspace.Id
                     select new { Runner = runner, WorkspaceName = workspace.Name };
        var count = query.Count ? await source.CountAsync(ct) : (int?)null;
        var runners = await source.OrderBy(x => x.WorkspaceName).ThenBy(x => x.Runner.Since)
            .ThenBy(x => x.Runner.WorkspaceId).ThenBy(x => x.Runner.RunnerId)
            .Skip(query.Offset).Take(query.Limit).ToListAsync(ct);
        var workspaceIds = runners.Select(x => x.Runner.WorkspaceId).Distinct().ToList();
        var leases = await db.WorkspaceLeases.AsNoTracking().Where(x => workspaceIds.Contains(x.WorkspaceId)).OrderBy(x => x.TaskId).ToListAsync(ct);
        var seats = await db.WorkspaceAgentSeats.AsNoTracking().Where(x => workspaceIds.Contains(x.WorkspaceId)).OrderBy(x => x.AgentId).ToListAsync(ct);
        var names = await DisplayNames(runners.Select(x => x.Runner.OwnerUserId), ct);
        return DataQueries.Result(runners.Select(row =>
        {
            var runner = row.Runner;
            return new JsonObject
            {
                ["workspace_id"] = runner.WorkspaceId.ToString(),
                ["workspace_name"] = row.WorkspaceName,
                ["runner_id"] = runner.RunnerId,
                ["name"] = runner.Name,
                ["host"] = runner.Host,
                ["hosts"] = runner.HostsJson is null ? new JsonArray() : JsonNode.Parse(runner.HostsJson),
                ["owner_id"] = runner.OwnerUserId.ToString(),
                ["owner_name"] = names.GetValueOrDefault(runner.OwnerUserId, ""),
                ["since"] = Stamp(runner.Since),
                ["last_seen"] = Stamp(runner.LastSeen),
                ["agents"] = JsonNode.Parse(runner.AgentsJson),
                ["wanted"] = runner.WantedAgentsJson is null ? new JsonArray() : JsonNode.Parse(runner.WantedAgentsJson),
                ["rate_limits"] = runner.RateLimitsJson is null ? null : JsonNode.Parse(runner.RateLimitsJson),
                ["folder"] = runner.FolderJson is null ? null : JsonNode.Parse(runner.FolderJson),
                ["cost_usd"] = runner.CostUsd,
                ["ping_requested_at"] = Stamp(runner.PingRequestedAt),
                ["ping_answered_at"] = Stamp(runner.PingAnsweredAt),
                ["leases"] = new JsonArray(leases.Where(x => x.WorkspaceId == runner.WorkspaceId && x.RunnerId == runner.RunnerId)
                    .Select(x => (JsonNode?)new JsonObject
                    {
                        ["task_id"] = x.TaskId, ["agent"] = x.Agent, ["since"] = Stamp(x.Since), ["until"] = Stamp(x.Until)
                    }).ToArray()),
                ["seats"] = new JsonArray(seats.Where(x => x.WorkspaceId == runner.WorkspaceId && x.RunnerId == runner.RunnerId)
                    .Select(x => (JsonNode?)new JsonObject { ["agent_id"] = x.AgentId, ["since"] = Stamp(x.Since) }).ToArray())
            };
        }), query, count);
    }
}
