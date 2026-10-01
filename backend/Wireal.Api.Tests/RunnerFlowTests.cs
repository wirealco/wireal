using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class RunnerFlowTests
{
    private static readonly (string Id, string Kind)[] Roster =
        [("claude", "claude"), ("codex", "codex"), ("ada", "claude"), ("rex", "codex")];

    private static JsonObject Document(string name, params (string Id, string Status)[] tasks) => new()
    {
        ["version"] = 9,
        ["map"] = new JsonObject
        {
            ["name"] = name,
            ["agents"] = new JsonObject
            {
                ["roster"] = new JsonArray(Roster.Select(agent => (JsonNode?)new JsonObject
                {
                    ["id"] = agent.Id, ["name"] = agent.Id, ["kind"] = agent.Kind, ["enabled"] = true
                }).ToArray())
            }
        },
        ["projects"] = new JsonArray(),
        ["tasks"] = new JsonArray(tasks.Select(task => (JsonNode?)new JsonObject
        {
            ["id"] = task.Id, ["name"] = task.Id, ["status"] = task.Status,
            ["projectIds"] = new JsonArray(), ["activity"] = new JsonArray()
        }).ToArray()),
        ["labels"] = new JsonArray(), ["links"] = new JsonArray()
    };

    private static async Task<Guid> Create(HttpClient client, params (string Id, string Status)[] tasks)
        => await CreateNamed(client, "Runners", tasks);

    private static async Task<Guid> CreateShared(HttpClient client, string project, params (string Id, string Status)[] tasks)
    {
        var id = Guid.NewGuid();
        var document = Document("Runners", tasks);
        document["projects"] = new JsonArray(new JsonObject { ["id"] = project, ["name"] = project });
        foreach (var task in document["tasks"]!.AsArray()) task!["projectIds"] = new JsonArray(project);
        await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "insert", values = new { id, data = document } });
        return id;
    }

    private static async Task<Guid> CreateNamed(HttpClient client, string name, params (string Id, string Status)[] tasks)
    {
        var id = Guid.NewGuid();
        await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "insert", values = new { id, data = Document(name, tasks) } });
        return id;
    }

    private static Task<HttpResponseMessage> Post(HttpClient client, string name, object args) =>
        client.PostAsJsonAsync("/api/commands/" + name, args);

    private static async Task Conflict(HttpClient client, string name, object args, string message)
    {
        var response = await Post(client, name, args);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains(message, await response.Content.ReadAsStringAsync());
    }

    private static async Task<JsonNode> Beat(HttpClient client, Guid workspace, string runner, params string[] agents) =>
        await ProjectFlowTests.Command(client, "runner_heartbeat", new
        {
            workspace_id = workspace, runner, hosts = new[] { "claude", "codex" }, cost_usd = 0, lease_minutes = 5,
            agents = agents.Select(id => new
            {
                id, name = id, kind = Roster.Single(agent => agent.Id == id).Kind,
                task_id = (string?)null, since = DateTime.UtcNow.ToString("O")
            }).ToArray()
        });

    private static async Task<JsonNode> Pick(HttpClient client, Guid workspace, string runner, params string[] agents) =>
        await ProjectFlowTests.Command(client, "set_runner_seats", new { workspace_id = workspace, runner, agents });

    private static async Task<JsonNode> Host(HttpClient client, Guid workspace, string runner, params string[] agents)
    {
        await Beat(client, workspace, runner, agents);
        return await Pick(client, workspace, runner, agents);
    }

    private static async Task Lock(HttpClient client, Guid workspace, string taskId, string? agent = null) =>
        await ProjectFlowTests.Command(client, "lock_task", new { workspace_id = workspace, task_id = taskId, agent });

    private static DateTime Moment(JsonNode? value) =>
        DateTime.Parse(value!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime();

    private static async Task<JsonNode> Workspace(HttpClient client, Guid id) =>
        (await ProjectFlowTests.Query(client, new { table = "workspaces", filters = ProjectFlowTests.IdFilter(id), single = "required" }))["data"]!;

    private static Task<HttpResponseMessage> Save(HttpClient client, Guid id, JsonNode data, int revision) =>
        client.PostAsJsonAsync("/api/query", new
        {
            table = "workspaces", operation = "update",
            filters = new object[]
            {
                new { field = "id", op = "eq", value = id.ToString() },
                new { field = "revision", op = "eq", value = revision }
            },
            values = new { data }
        });

    private static async Task<JsonArray> RunnerRows(HttpClient client, Guid id) =>
        (await ProjectFlowTests.Query(client, new { table = "runners", filters = new object[] { new { field = "workspace_id", op = "eq", value = id.ToString() } } }))["data"]!.AsArray();

    private static async Task<JsonArray> RunnerRows(HttpClient client) =>
        (await ProjectFlowTests.Query(client, new { table = "runners" }))["data"]!.AsArray();

    private static async Task<JsonArray> LockRows(HttpClient client, Guid id) =>
        (await ProjectFlowTests.Query(client, new { table = "task_locks", filters = new object[] { new { field = "workspace_id", op = "eq", value = id.ToString() } } }))["data"]!.AsArray();

    [Fact]
    public async Task AClaimNeedsAConnectedRunnerALockAndASeat()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, userId) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await Conflict(client, "lock_task", new { workspace_id = workspace, task_id = "ready" }, "Connect a runner first.");
            await Host(client, workspace, "runner-a", "claude");
            await Conflict(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 }, "Task is not locked to you.");

            await Lock(client, workspace, "ready");
            var row = Assert.Single(await LockRows(client, workspace))!;
            Assert.Equal("ready", row["task_id"]!.GetValue<string>());
            Assert.Null(row["agent"]);
            Assert.Equal(userId.ToString(), row["owner_id"]!.GetValue<string>());
            Assert.Equal("Test user", row["owner_name"]!.GetValue<string>());

            var claim = await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });
            Assert.Equal("ready", claim["task_id"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task ARunnerSeatsOnlyThePickedAgentsItsOwnerChose()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            var unpicked = await Beat(client, workspace, "runner-a", "claude", "codex");
            Assert.Empty(unpicked["seats"]!.AsArray());
            Assert.Empty(unpicked["wanted"]!.AsArray());

            var picked = await Pick(client, workspace, "runner-a", "claude");
            Assert.Equal(["claude"], picked["seats"]!.AsArray().Select(x => x!.GetValue<string>()));
            Assert.Empty(picked["taken"]!.AsArray());
            var again = await Beat(client, workspace, "runner-a", "claude", "codex");
            Assert.Equal(["claude"], again["seats"]!.AsArray().Select(x => x!.GetValue<string>()));
            Assert.Equal(["claude"], again["wanted"]!.AsArray().Select(x => x!.GetValue<string>()));

            await Beat(client, workspace, "runner-b", "claude", "codex");
            var contested = await Pick(client, workspace, "runner-b", "claude", "codex");
            Assert.Equal(["codex"], contested["seats"]!.AsArray().Select(x => x!.GetValue<string>()));
            var taken = Assert.Single(contested["taken"]!.AsArray())!;
            Assert.Equal("claude", taken["agent_id"]!.GetValue<string>());
            Assert.Equal("runner-a", taken["runner_id"]!.GetValue<string>());
            Assert.Equal("runner-a", taken["runner_name"]!.GetValue<string>());
            Assert.Equal("Test user", taken["owner_name"]!.GetValue<string>());

            var row = (await RunnerRows(client, workspace)).Single(x => x!["runner_id"]!.GetValue<string>() == "runner-b")!;
            Assert.Equal(["claude", "codex"], row["wanted"]!.AsArray().Select(x => x!.GetValue<string>()));
            Assert.Equal(["codex"], row["seats"]!.AsArray().Select(x => x!["agent_id"]!.GetValue<string>()));

            await Lock(client, workspace, "ready");
            await Conflict(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-b", lease_minutes = 5 }, "Agent is not seated on this runner.");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });
        }
    }

    [Fact]
    public async Task OnlyTheRunnersOwnerCanPickItsAgents()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory);
        var (mate, mateId) = await ProjectFlowTests.SignIn(factory);
        using (client) using (mate)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspace, UserId = mateId });
                await db.SaveChangesAsync();
            }
            await Beat(client, workspace, "runner-a", "claude");

            var refused = await Post(mate, "set_runner_seats", new { workspace_id = workspace, runner = "runner-a", agents = new[] { "claude" } });
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Contains("Only the runner's owner can pick its agents.", await refused.Content.ReadAsStringAsync());
            Assert.Equal(HttpStatusCode.NotFound, (await Post(client, "set_runner_seats", new { workspace_id = workspace, runner = "runner-z", agents = Array.Empty<string>() })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "set_runner_seats", new { workspace_id = workspace, runner = "runner-a", agents = new[] { "ghost" } })).StatusCode);
        }
    }

    [Fact]
    public async Task ALockedTaskRefusesEditsButStillTakesActivity()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");

            var row = await Workspace(client, workspace);
            var revision = row["revision"]!.GetValue<int>();
            var edited = row["data"]!.DeepClone();
            edited["tasks"]![0]!["objective"] = "Ship it twice";
            var refused = await Save(client, workspace, edited, revision);
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            Assert.Contains("#ready is locked by Test user.", await refused.Content.ReadAsStringAsync());

            var noted = row["data"]!.DeepClone();
            noted["tasks"]![0]!["activity"]!.AsArray().Add(new JsonObject
            {
                ["id"] = "note", ["text"] = "Watching from here", ["at"] = DateTime.UtcNow.ToString("O"),
                ["author"] = "Test user", ["authorType"] = "user"
            });
            var accepted = await Save(client, workspace, noted, revision);
            Assert.True(accepted.IsSuccessStatusCode, await accepted.Content.ReadAsStringAsync());
        }
    }

    [Fact]
    public async Task ALockedTaskTakesOutgoingLinksButRefusesIncomingOnes()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"), ("follow", "todo"));
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");

            var row = await Workspace(client, workspace);
            var revision = row["revision"]!.GetValue<int>();
            var incoming = row["data"]!.DeepClone();
            incoming["links"]!.AsArray().Add(new JsonObject { ["id"] = "into", ["source"] = "follow", ["target"] = "ready" });
            var refused = await Save(client, workspace, incoming, revision);
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            Assert.Contains("#ready is locked by Test user.", await refused.Content.ReadAsStringAsync());

            var outgoing = row["data"]!.DeepClone();
            outgoing["links"]!.AsArray().Add(new JsonObject { ["id"] = "onward", ["source"] = "ready", ["target"] = "follow" });
            var accepted = await Save(client, workspace, outgoing, revision);
            Assert.True(accepted.IsSuccessStatusCode, await accepted.Content.ReadAsStringAsync());

            var saved = await Workspace(client, workspace);
            var dropped = saved["data"]!.DeepClone();
            dropped["links"] = new JsonArray();
            var cleared = await Save(client, workspace, dropped, saved["revision"]!.GetValue<int>());
            Assert.True(cleared.IsSuccessStatusCode, await cleared.Content.ReadAsStringAsync());
        }
    }

    [Fact]
    public async Task UnlockingDropsTheLeaseAndReturnsTheTaskToTodo()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, userId) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });

            var unlocked = await ProjectFlowTests.Command(client, "unlock_task", new { workspace_id = workspace, task_id = "ready", line = false });
            Assert.Equal("ready", Assert.Single(unlocked["unlocked"]!.AsArray())!.GetValue<string>());
            Assert.Empty(await LockRows(client, workspace));

            var task = (await Workspace(client, workspace))["data"]!["tasks"]![0]!;
            Assert.Equal("todo", task["status"]!.GetValue<string>());
            var note = Assert.Single(task["activity"]!.AsArray())!;
            Assert.Equal("Lock removed by Test user. The runner stops here.", note["text"]!.GetValue<string>());
            Assert.Equal("user", note["authorType"]!.GetValue<string>());
            Assert.Equal(userId.ToString(), note["authorId"]!.GetValue<string>());

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Empty(await db.WorkspaceLeases.AsNoTracking().ToListAsync());
        }
    }

    [Fact]
    public async Task ClaimingLeasesATaskOnceAndMovesItToDoing()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"), ("finished", "done"), ("idea", "proposed"));
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");
            var before = DateTime.UtcNow;
            var claim = await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });
            Assert.Equal("ready", claim["task_id"]!.GetValue<string>());
            Assert.InRange(Moment(claim["until"]), before.AddMinutes(4), before.AddMinutes(6));

            var row = await Workspace(client, workspace);
            Assert.Equal(2, row["revision"]!.GetValue<int>());
            var tasks = row["data"]!["tasks"]!.AsArray();
            Assert.Equal("doing", tasks.Single(x => x!["id"]!.GetValue<string>() == "ready")!["status"]!.GetValue<string>());
            Assert.Equal("proposed", tasks.Single(x => x!["id"]!.GetValue<string>() == "idea")!["status"]!.GetValue<string>());

            foreach (var task in new[] { "ready", "finished", "idea" })
            {
                var response = await Post(client, "claim_task", new { workspace_id = workspace, task_id = task, agent = "claude", runner = "runner-b", lease_minutes = 5 });
                Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
                Assert.Contains("Task is not claimable.", await response.Content.ReadAsStringAsync());
            }
            Assert.Equal(HttpStatusCode.NotFound, (await Post(client, "claim_task", new { workspace_id = workspace, task_id = "missing", agent = "claude", runner = "runner-b", lease_minutes = 5 })).StatusCode);
            Assert.Equal(2, (await Workspace(client, workspace))["revision"]!.GetValue<int>());
        }
    }

    [Fact]
    public async Task AnExpiredLeaseIsReclaimedAndReplaced()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await Host(client, workspace, "runner-a", "claude");
            await Host(client, workspace, "runner-b", "codex");
            await Lock(client, workspace, "ready");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });
            Assert.Equal(HttpStatusCode.Conflict, (await Post(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "codex", runner = "runner-b", lease_minutes = 5 })).StatusCode);
            await Expire(factory, workspace, "ready");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "codex", runner = "runner-b", lease_minutes = 5 });

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var lease = Assert.Single(await db.WorkspaceLeases.AsNoTracking().ToListAsync());
            Assert.Equal("runner-b", lease.RunnerId);
            Assert.Equal("codex", lease.Agent);
            Assert.True(lease.Until > DateTime.UtcNow);
        }
    }

    [Fact]
    public async Task AnAgentCannotHoldTwoLiveLeasesButCanReclaimItsExpiredTask()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("first", "todo"), ("second", "todo"));
            await Host(client, workspace, "runner-a", "ada", "rex");
            await Lock(client, workspace, "first");
            await Lock(client, workspace, "second");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "first", agent = "ada", runner = "runner-a", lease_minutes = 5 });

            await Conflict(client, "claim_task", new { workspace_id = workspace, task_id = "second", agent = "ada", runner = "runner-a", lease_minutes = 5 }, "Agent is busy.");

            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "second", agent = "rex", runner = "runner-a", lease_minutes = 5 });
            await Expire(factory, workspace, "first");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "first", agent = "ada", runner = "runner-a", lease_minutes = 5 });
        }
    }

    [Fact]
    public async Task OneProjectHoldsOneAgentAtATime()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await CreateShared(client, "core", ("first", "todo"), ("second", "todo"));
            await Host(client, workspace, "runner-a", "ada", "rex");
            await Lock(client, workspace, "first");
            await Lock(client, workspace, "second");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "first", agent = "ada", runner = "runner-a", lease_minutes = 5 });

            await Conflict(client, "claim_task", new { workspace_id = workspace, task_id = "second", agent = "rex", runner = "runner-a", lease_minutes = 5 }, "Another agent is working in this project.");

            await Expire(factory, workspace, "first");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "second", agent = "rex", runner = "runner-a", lease_minutes = 5 });
        }
    }

    private static async Task Expire(ApiFactory factory, Guid workspace, string taskId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var lease = await db.WorkspaceLeases.SingleAsync(x => x.WorkspaceId == workspace && x.TaskId == taskId);
        lease.Until = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task HeartbeatExtendsLeasesAndAnswersAPing()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            Assert.Equal(HttpStatusCode.NotFound, (await Post(client, "ping_runner", new { workspace_id = workspace, runner = "runner-a" })).StatusCode);
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");
            var claim = await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });

            var agents = new[] { new { id = "claude", name = "Claude", kind = "claude", task_id = "ready", since = DateTime.UtcNow.ToString("O") } };
            var first = await ProjectFlowTests.Command(client, "runner_heartbeat", new { workspace_id = workspace, runner = "runner-a", name = "Studio", host = "mini.local", hosts = new[] { "claude" }, agents, cost_usd = 0.25, lease_minutes = 30 });
            Assert.Null(first["ping_requested_at"]);
            Assert.Null(first["ping_answered_at"]);
            Assert.True(Moment(first["server_time"]) <= DateTime.UtcNow.AddSeconds(5));
            Assert.Equal("ready", Assert.Single(first["locks"]!.AsArray())!["task_id"]!.GetValue<string>());
            var extended = Assert.Single(first["leases"]!.AsArray())!;
            Assert.Equal("ready", extended["task_id"]!.GetValue<string>());
            Assert.True(Moment(extended["until"]) > Moment(claim["until"]));

            var ping = await ProjectFlowTests.Command(client, "ping_runner", new { workspace_id = workspace, runner = "runner-a" });
            var requested = Moment(ping["ping_requested_at"]);
            var answered = await ProjectFlowTests.Command(client, "runner_heartbeat", new { workspace_id = workspace, runner = "runner-a", name = "Studio", host = "mini.local", hosts = new[] { "claude" }, agents, cost_usd = 0.5, lease_minutes = 30 });
            Assert.Equal(requested, Moment(answered["ping_requested_at"]));
            Assert.True(Moment(answered["ping_answered_at"]) >= requested);

            var quiet = await ProjectFlowTests.Command(client, "runner_heartbeat", new { workspace_id = workspace, runner = "runner-a", name = "Studio", host = "mini.local", hosts = new[] { "claude" }, agents, cost_usd = 0.5, lease_minutes = 30 });
            Assert.Equal(Moment(answered["ping_answered_at"]), Moment(quiet["ping_answered_at"]));
        }
    }

    [Fact]
    public async Task HeartbeatPrunesRunnersLeasesAndSeatsOlderThanSevenDays()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("stale-task", "todo"), ("fresh-task", "todo"));
            foreach (var (task, agent, runner) in new[]
            {
                ("stale-task", "claude", "runner-stale"),
                ("fresh-task", "codex", "runner-fresh")
            })
            {
                await Host(client, workspace, runner, agent);
                await Lock(client, workspace, task);
                await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = task, agent, runner, lease_minutes = 5 });
            }

            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                (await db.WorkspaceRunners.SingleAsync(x => x.WorkspaceId == workspace && x.RunnerId == "runner-stale")).LastSeen = DateTime.UtcNow.AddDays(-8);
                (await db.WorkspaceRunners.SingleAsync(x => x.WorkspaceId == workspace && x.RunnerId == "runner-fresh")).LastSeen = DateTime.UtcNow.AddDays(-6);
                await db.SaveChangesAsync();
            }

            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-current", agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5
            });

            Assert.Equal(new[] { "runner-current", "runner-fresh" },
                (await RunnerRows(client, workspace)).Select(x => x!["runner_id"]!.GetValue<string>()).Order());
            await using var verify = factory.Services.CreateAsyncScope();
            var db2 = verify.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal("runner-fresh", Assert.Single(await db2.WorkspaceLeases.AsNoTracking().ToListAsync()).RunnerId);
            Assert.Equal("runner-fresh", Assert.Single(await db2.WorkspaceAgentSeats.AsNoTracking().ToListAsync()).RunnerId);
        }
    }

    [Fact]
    public async Task HeartbeatStoresReturnsAndPreservesRateLimits()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client);
            var rateLimits = new
            {
                five_hour = new { used_percentage = 42.5, resets_at = 1_800_000_000 },
                seven_day = new { used_percentage = 17, resets_at = "2026-09-20T12:00:00Z" },
                captured_at = "2026-09-16T12:00:00Z",
                source = "claude"
            };
            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", name = "Studio", host = "mini.local",
                agents = Array.Empty<object>(), rate_limits = rateLimits, cost_usd = 0, lease_minutes = 5
            });

            var stored = Assert.Single(await RunnerRows(client, workspace))!["rate_limits"]!.AsObject();
            Assert.Equal(42.5, stored["five_hour"]!["used_percentage"]!.GetValue<double>());
            Assert.Equal("claude", stored["source"]!.GetValue<string>());

            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", name = "Studio", host = "mini.local",
                agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5
            });
            var preserved = Assert.Single(await RunnerRows(client, workspace))!["rate_limits"]!.AsObject();
            Assert.Equal(stored.ToJsonString(), preserved.ToJsonString());
        }
    }

    [Fact]
    public async Task HeartbeatRejectsInvalidOrOversizedRateLimits()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client);
            var invalid = await Post(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", agents = Array.Empty<object>(),
                rate_limits = "not an object", cost_usd = 0, lease_minutes = 5
            });
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

            var oversized = await Post(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", agents = Array.Empty<object>(),
                rate_limits = new { captured_at = new string('x', 8192) }, cost_usd = 0, lease_minutes = 5
            });
            Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
            Assert.Empty(await RunnerRows(client, workspace));
        }
    }

    [Fact]
    public async Task HeartbeatStoresFolderStateAndTheRunnersQueryReturnsIt()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client);
            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5,
                folder = new { branch = "main", dirty = true, ahead = 2, behind = 3, upstream = "origin/main", path = "~/code/wireal" }
            });

            var folder = Assert.Single(await RunnerRows(client, workspace))!["folder"]!.AsObject();
            Assert.Equal("main", folder["branch"]!.GetValue<string>());
            Assert.True(folder["dirty"]!.GetValue<bool>());
            Assert.Equal(2, folder["ahead"]!.GetValue<int>());
            Assert.Equal(3, folder["behind"]!.GetValue<int>());
            Assert.Equal("origin/main", folder["upstream"]!.GetValue<string>());
            Assert.Equal("~/code/wireal", folder["path"]!.GetValue<string>());

            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5,
                folder = new { branch = "main", dirty = false, behind = 0, path = new string('p', 260) }
            });
            var trimmed = Assert.Single(await RunnerRows(client, workspace))!["folder"]!.AsObject();
            Assert.Equal(200, trimmed["path"]!.GetValue<string>().Length);
            Assert.Equal(0, trimmed["ahead"]!.GetValue<int>());
            Assert.Equal("", trimmed["upstream"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task HeartbeatRejectsInvalidOrOversizedFolderState()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client);
            foreach (var folder in new object[]
            {
                new { branch = "main", dirty = false, behind = -1 },
                new { branch = "main", dirty = false, ahead = -1, behind = 0 },
                new { branch = new string('x', 501), dirty = false, behind = 0 }
            })
            {
                var response = await Post(client, "runner_heartbeat", new
                {
                    workspace_id = workspace, runner = "runner-a", agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5, folder
                });
                Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            }
            Assert.Empty(await RunnerRows(client, workspace));
        }
    }

    [Fact]
    public async Task ReleaseRemovesTheLeaseWithoutTouchingTheDocument()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });
            var revision = (await Workspace(client, workspace))["revision"]!.GetValue<int>();

            var stranger = await ProjectFlowTests.Command(client, "release_task", new { workspace_id = workspace, task_id = "ready", runner = "runner-b" });
            Assert.False(stranger["released"]!.GetValue<bool>());
            var released = await ProjectFlowTests.Command(client, "release_task", new { workspace_id = workspace, task_id = "ready", runner = "runner-a" });
            Assert.True(released["released"]!.GetValue<bool>());
            var again = await ProjectFlowTests.Command(client, "release_task", new { workspace_id = workspace, task_id = "ready", runner = "runner-a" });
            Assert.False(again["released"]!.GetValue<bool>());

            var row = await Workspace(client, workspace);
            Assert.Equal(revision, row["revision"]!.GetValue<int>());
            Assert.Equal("doing", row["data"]!["tasks"]![0]!["status"]!.GetValue<string>());
            Assert.False(released["unlocked"]!.GetValue<bool>());
            Assert.Equal("ready", Assert.Single(await LockRows(client, workspace))!["task_id"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task ReleasingAFinishedTaskRemovesItsLock()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });

            var row = await Workspace(client, workspace);
            var finished = row["data"]!.DeepClone();
            finished["tasks"]![0]!["status"] = "done";
            var saved = await Save(client, workspace, finished, row["revision"]!.GetValue<int>());
            Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());

            var released = await ProjectFlowTests.Command(client, "release_task", new { workspace_id = workspace, task_id = "ready", runner = "runner-a" });
            Assert.True(released["released"]!.GetValue<bool>());
            Assert.True(released["unlocked"]!.GetValue<bool>());
            Assert.Empty(await LockRows(client, workspace));

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Empty(await db.WorkspaceLeases.AsNoTracking().ToListAsync());
        }
    }

    [Fact]
    public async Task UnlockingAFinishedTaskWritesNothingOnIt()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            await Host(client, workspace, "runner-a", "claude");
            await Lock(client, workspace, "ready");

            var row = await Workspace(client, workspace);
            var finished = row["data"]!.DeepClone();
            finished["tasks"]![0]!["status"] = "done";
            var saved = await Save(client, workspace, finished, row["revision"]!.GetValue<int>());
            Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());
            var revision = (await Workspace(client, workspace))["revision"]!.GetValue<int>();

            var unlocked = await ProjectFlowTests.Command(client, "unlock_task", new { workspace_id = workspace, task_id = "ready", line = false });
            Assert.Equal("ready", Assert.Single(unlocked["unlocked"]!.AsArray())!.GetValue<string>());
            Assert.Empty(await LockRows(client, workspace));

            var after = await Workspace(client, workspace);
            Assert.Equal(revision, after["revision"]!.GetValue<int>());
            Assert.Equal("done", after["data"]!["tasks"]![0]!["status"]!.GetValue<string>());
            Assert.Empty(after["data"]!["tasks"]![0]!["activity"]!.AsArray());
        }
    }

    [Fact]
    public async Task TheRunnersQueryReportsPresenceLeasesAndOwner()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, userId) = await ProjectFlowTests.SignIn(factory);
        var (bob, _) = await ProjectFlowTests.SignIn(factory);
        using (client) using (bob)
        {
            var workspace = await Create(client, ("ready", "todo"), ("next", "todo"));
            await Host(client, workspace, "runner-a", "claude", "codex");
            await Lock(client, workspace, "ready");
            await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = "ready", agent = "claude", runner = "runner-a", lease_minutes = 5 });
            var since = DateTime.UtcNow.ToString("O");
            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", name = "Studio", host = "mini.local",
                hosts = new[] { "claude", "codex" },
                agents = new object[]
                {
                    new { id = "claude", name = "Claude", kind = "claude", task_id = "ready", since },
                    new { id = "codex", name = "Codex", kind = "codex", task_id = (string?)null, since }
                },
                cost_usd = 1.5, lease_minutes = 5
            });

            var row = Assert.Single(await RunnerRows(client, workspace))!;
            Assert.Equal("runner-a", row["runner_id"]!.GetValue<string>());
            Assert.Equal("Studio", row["name"]!.GetValue<string>());
            Assert.Equal("mini.local", row["host"]!.GetValue<string>());
            Assert.Equal(workspace.ToString(), row["workspace_id"]!.GetValue<string>());
            Assert.Equal("Runners", row["workspace_name"]!.GetValue<string>());
            Assert.Equal(userId.ToString(), row["owner_id"]!.GetValue<string>());
            Assert.Equal("Test user", row["owner_name"]!.GetValue<string>());
            Assert.Equal(1.5m, row["cost_usd"]!.GetValue<decimal>());
            Assert.Null(row["ping_requested_at"]);
            Assert.Null(row["ping_answered_at"]);
            Assert.True(Moment(row["last_seen"]) >= Moment(row["since"]));
            var agents = row["agents"]!.AsArray();
            Assert.Equal(2, agents.Count);
            Assert.Equal("claude", agents[0]!["id"]!.GetValue<string>());
            Assert.Equal("Claude", agents[0]!["name"]!.GetValue<string>());
            Assert.Equal("claude", agents[0]!["kind"]!.GetValue<string>());
            Assert.Equal("ready", agents[0]!["task_id"]!.GetValue<string>());
            Assert.Null(agents[1]!["task_id"]);
            Assert.Equal(new[] { "claude", "codex" }, row["hosts"]!.AsArray().Select(x => x!.GetValue<string>()));
            Assert.Equal(new[] { "claude", "codex" }, row["seats"]!.AsArray().Select(x => x!["agent_id"]!.GetValue<string>()));
            Assert.Equal(new[] { "claude", "codex" }, row["wanted"]!.AsArray().Select(x => x!.GetValue<string>()));
            var lease = Assert.Single(row["leases"]!.AsArray())!;
            Assert.Equal("ready", lease["task_id"]!.GetValue<string>());
            Assert.Equal("claude", lease["agent"]!.GetValue<string>());
            Assert.True(Moment(lease["until"]) > Moment(lease["since"]));

            Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync("/api/query", new { table = "runners", filters = new object[] { new { field = "workspace_id", op = "eq", value = workspace.ToString() } } })).StatusCode);
            Assert.Single(await RunnerRows(client));
            Assert.Empty(await RunnerRows(bob));
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/query", new { table = "runners", operation = "delete", filters = new object[] { new { field = "workspace_id", op = "eq", value = workspace.ToString() } } })).StatusCode);
        }
    }

    [Fact]
    public async Task TheGlobalRunnersQueryIncludesEveryVisibleWorkspaceInStableOrder()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, userId) = await ProjectFlowTests.SignIn(factory);
        var (collaborator, collaboratorId) = await ProjectFlowTests.SignIn(factory);
        var (stranger, _) = await ProjectFlowTests.SignIn(factory);
        using (client) using (collaborator) using (stranger)
        {
            var zulu = await CreateNamed(client, "Zulu");
            var alpha = await CreateNamed(client, "Alpha");
            var beta = await CreateNamed(collaborator, "Beta");
            var hidden = await CreateNamed(stranger, "Hidden");
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = beta, UserId = userId });
                await db.SaveChangesAsync();
            }

            foreach (var (http, workspace, runner, kind) in new[]
            {
                (client, zulu, "runner-z", "claude"),
                (client, alpha, "runner-a", "codex"),
                (collaborator, beta, "runner-b", "claude"),
                (stranger, hidden, "runner-h", "codex")
            })
                await ProjectFlowTests.Command(http, "runner_heartbeat", new
                {
                    workspace_id = workspace, runner, hosts = new[] { kind }, agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5
                });

            var rows = await RunnerRows(client);
            Assert.Equal(new[] { "Alpha", "Beta", "Zulu" }, rows.Select(x => x!["workspace_name"]!.GetValue<string>()));
            Assert.Equal(new[] { alpha, beta, zulu }, rows.Select(x => Guid.Parse(x!["workspace_id"]!.GetValue<string>())));
            Assert.Equal("Test user", rows[1]!["owner_name"]!.GetValue<string>());
            Assert.Equal(collaboratorId.ToString(), rows[1]!["owner_id"]!.GetValue<string>());
            Assert.Equal("claude", Assert.Single(rows[1]!["hosts"]!.AsArray())!.GetValue<string>());
            Assert.Single(await RunnerRows(client, beta));
        }
    }

    [Theory]
    [InlineData("runner_leave", "left")]
    [InlineData("forget_runner", "forgotten")]
    public async Task LeavingAndForgettingRemovePresenceEveryLeaseAndEverySeat(string command, string resultKey)
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"), ("next", "todo"));
            await Host(client, workspace, "runner-a", "claude", "codex");
            foreach (var (task, agent) in new[] { ("ready", "claude"), ("next", "codex") })
            {
                await Lock(client, workspace, task);
                await ProjectFlowTests.Command(client, "claim_task", new { workspace_id = workspace, task_id = task, agent, runner = "runner-a", lease_minutes = 5 });
            }
            Assert.Equal(2, Assert.Single(await RunnerRows(client, workspace))!["leases"]!.AsArray().Count);

            var result = await ProjectFlowTests.Command(client, command, new { workspace_id = workspace, runner = "runner-a" });
            Assert.True(result[resultKey]!.GetValue<bool>());
            Assert.Empty(await RunnerRows(client, workspace));

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Empty(await db.WorkspaceLeases.AsNoTracking().ToListAsync());
            Assert.Empty(await db.WorkspaceRunners.AsNoTracking().ToListAsync());
            Assert.Empty(await db.WorkspaceAgentSeats.AsNoTracking().ToListAsync());
        }
    }

    [Fact]
    public async Task HeartbeatCarriesWhatEachAgentIsDoingAndCutsWhatDoesNotFit()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, ("ready", "todo"));
            var since = DateTime.UtcNow.ToString("O");
            var longPath = new string('d', 250) + "/tail.ts";
            var files = Enumerable.Range(0, 25).Select(i => $"src/file{i}.ts").Prepend(longPath).ToArray();
            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", hosts = new[] { "claude", "codex" }, cost_usd = 0, lease_minutes = 5,
                agents = new object[]
                {
                    new { id = "claude", name = "Claude", kind = "claude", task_id = "ready", since,
                          step = "editing src/api.ts", last = "Wrote 3 files", files = new[] { "src/api.ts", "src/api.ts", "src/b.ts" } },
                    new { id = "codex", name = "Codex", kind = "codex", task_id = (string?)null, since,
                          step = "  " + new string('s', 200), last = new string('l', 500), files },
                    new { id = "ada", name = "Ada", kind = "claude", task_id = (string?)null, since }
                }
            });

            var agents = Assert.Single(await RunnerRows(client, workspace))!["agents"]!.AsArray();
            Assert.Equal("editing src/api.ts", agents[0]!["step"]!.GetValue<string>());
            Assert.Equal("Wrote 3 files", agents[0]!["last"]!.GetValue<string>());
            Assert.Equal(new[] { "src/api.ts", "src/b.ts" }, agents[0]!["files"]!.AsArray().Select(x => x!.GetValue<string>()));

            Assert.Equal(new string('s', 120), agents[1]!["step"]!.GetValue<string>());
            Assert.Equal(new string('l', 300), agents[1]!["last"]!.GetValue<string>());
            var kept = agents[1]!["files"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray();
            Assert.Equal(20, kept.Length);
            Assert.Equal(200, kept[0].Length);
            Assert.EndsWith("/tail.ts", kept[0]);
            Assert.Equal("src/file18.ts", kept[^1]);

            var old = agents[2]!.AsObject();
            Assert.False(old.ContainsKey("step"));
            Assert.False(old.ContainsKey("last"));
            Assert.False(old.ContainsKey("files"));

            var invalid = await Post(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", cost_usd = 0, lease_minutes = 5,
                agents = new object[] { new { id = "claude", name = "Claude", kind = "claude", since, files = "src/api.ts" } }
            });
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        }
    }

    [Fact]
    public async Task HeartbeatKeepsWhenRateLimitsWereCaptured()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client);
            await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5,
                rate_limits = new
                {
                    claude = new { five_hour = new { used_percentage = 12 }, captured_at = "2026-09-29T08:00:00.000Z" },
                    captured_at = "2026-09-29T09:15:00.000Z"
                }
            });
            var limits = Assert.Single(await RunnerRows(client, workspace))!["rate_limits"]!;
            Assert.Equal("2026-09-29T09:15:00.000Z", limits["captured_at"]!.GetValue<string>());
            Assert.Equal("2026-09-29T08:00:00.000Z", limits["claude"]!["captured_at"]!.GetValue<string>());
        }
    }

    private static async Task<JsonArray> PresenceRows(HttpClient client, Guid workspace) =>
        (await ProjectFlowTests.Command(client, "list_presence", new { workspace_id = workspace }))["presence"]!.AsArray();

    private static async Task AddMember(ApiFactory factory, Guid workspace, Guid user)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspace, UserId = user });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task PresenceIsTouchedListedToMembersAndEnded()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (alice, aliceId) = await ProjectFlowTests.SignIn(factory);
        var (bob, bobId) = await ProjectFlowTests.SignIn(factory);
        var (eve, _) = await ProjectFlowTests.SignIn(factory);
        using (alice) using (bob) using (eve)
        {
            var workspace = await Create(alice, ("ready", "todo"));
            await AddMember(factory, workspace, bobId);

            var touched = await ProjectFlowTests.Command(bob, "touch_presence", new
            {
                workspace_id = workspace, session = "term-1", client = "claude-code", handle = "bob@laptop", task_id = "ready", note = "fixing the api"
            });
            Assert.True(touched["ok"]!.GetValue<bool>());
            await ProjectFlowTests.Command(alice, "touch_presence", new { workspace_id = workspace, session = "term-9", client = "codex", task_id = "no-such-task" });

            var rows = await PresenceRows(alice, workspace);
            Assert.Equal(2, rows.Count);
            var bobRow = rows.Single(x => x!["session"]!.GetValue<string>() == "term-1")!;
            Assert.Equal(workspace.ToString(), bobRow["workspace_id"]!.GetValue<string>());
            Assert.Equal(bobId.ToString(), bobRow["user_id"]!.GetValue<string>());
            Assert.Equal("Test user", bobRow["user_name"]!.GetValue<string>());
            Assert.Equal("claude-code", bobRow["client"]!.GetValue<string>());
            Assert.Equal("bob@laptop", bobRow["handle"]!.GetValue<string>());
            Assert.Equal("ready", bobRow["task_id"]!.GetValue<string>());
            Assert.Equal("fixing the api", bobRow["note"]!.GetValue<string>());
            Assert.True(Moment(bobRow["last_seen"]) <= DateTime.UtcNow.AddSeconds(5));
            var aliceRow = rows.Single(x => x!["session"]!.GetValue<string>() == "term-9")!;
            Assert.Equal(aliceId.ToString(), aliceRow["user_id"]!.GetValue<string>());
            Assert.Null(aliceRow["task_id"]);
            Assert.Null(aliceRow["handle"]);
            Assert.Null(aliceRow["note"]);

            // A second touch from the same session updates the row in place.
            await ProjectFlowTests.Command(bob, "touch_presence", new { workspace_id = workspace, session = "term-1", client = "claude-code" });
            bobRow = (await PresenceRows(bob, workspace)).Single(x => x!["session"]!.GetValue<string>() == "term-1")!;
            Assert.Null(bobRow["task_id"]);
            Assert.Null(bobRow["note"]);

            // Outsiders can neither announce themselves nor look.
            Assert.Equal(HttpStatusCode.NotFound, (await Post(eve, "touch_presence", new { workspace_id = workspace, session = "x", client = "codex" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Post(eve, "list_presence", new { workspace_id = workspace })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Post(eve, "end_presence", new { workspace_id = workspace, session = "term-1" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(bob, "touch_presence", new { workspace_id = workspace, session = "", client = "codex" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(bob, "touch_presence", new { workspace_id = workspace, session = "term-2" })).StatusCode);

            // Ending only removes the caller's own session of that name.
            Assert.True((await ProjectFlowTests.Command(alice, "end_presence", new { workspace_id = workspace, session = "term-1" }))["ok"]!.GetValue<bool>());
            Assert.Equal(2, (await PresenceRows(alice, workspace)).Count);
            await ProjectFlowTests.Command(bob, "end_presence", new { workspace_id = workspace, session = "term-1" });
            Assert.Equal("term-9", Assert.Single(await PresenceRows(alice, workspace))!["session"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task PresenceIsLiveForTenMinutesAndPrunedAfterADay()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, userId) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client);
            foreach (var session in new[] { "fresh", "quiet", "stale", "ancient" })
                await ProjectFlowTests.Command(client, "touch_presence", new { workspace_id = workspace, session, client = "claude-code" });
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                (await db.WorkspacePresence.SingleAsync(x => x.Session == "quiet")).LastSeen = DateTime.UtcNow.AddMinutes(-9);
                (await db.WorkspacePresence.SingleAsync(x => x.Session == "stale")).LastSeen = DateTime.UtcNow.AddMinutes(-11);
                (await db.WorkspacePresence.SingleAsync(x => x.Session == "ancient")).LastSeen = DateTime.UtcNow.AddHours(-25);
                await db.SaveChangesAsync();
            }

            Assert.Equal(new[] { "fresh", "quiet" }, (await PresenceRows(client, workspace)).Select(x => x!["session"]!.GetValue<string>()).Order());

            await ProjectFlowTests.Command(client, "touch_presence", new { workspace_id = workspace, session = "fresh", client = "claude-code" });
            await using var verify = factory.Services.CreateAsyncScope();
            var db2 = verify.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(new[] { "fresh", "quiet", "stale" },
                (await db2.WorkspacePresence.AsNoTracking().Where(x => x.UserId == userId).Select(x => x.Session).ToListAsync()).Order());
        }
    }

    [Fact]
    public async Task HeartbeatReplyCarriesLivePresence()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (alice, _) = await ProjectFlowTests.SignIn(factory);
        var (bob, bobId) = await ProjectFlowTests.SignIn(factory);
        using (alice) using (bob)
        {
            var workspace = await Create(alice, ("ready", "todo"));
            Assert.Empty((await Beat(alice, workspace, "runner-a", "claude"))["presence"]!.AsArray());

            await AddMember(factory, workspace, bobId);
            await ProjectFlowTests.Command(bob, "touch_presence", new { workspace_id = workspace, session = "term-1", client = "codex", task_id = "ready" });
            var row = Assert.Single((await Beat(alice, workspace, "runner-a", "claude"))["presence"]!.AsArray())!;
            Assert.Equal(bobId.ToString(), row["user_id"]!.GetValue<string>());
            Assert.Equal("codex", row["client"]!.GetValue<string>());
            Assert.Equal("ready", row["task_id"]!.GetValue<string>());

            // Leaving the workspace ends a member's sessions there.
            Assert.True((await bob.DeleteAsync($"/api/teams/{workspace}/members/{bobId}")).IsSuccessStatusCode);
            Assert.Empty((await Beat(alice, workspace, "runner-a", "claude"))["presence"]!.AsArray());
        }
    }
}
