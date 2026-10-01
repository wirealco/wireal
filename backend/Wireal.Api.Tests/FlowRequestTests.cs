using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class FlowRequestTests
{
    private static JsonObject Task(string id, string status, string? parent = null) => new()
    {
        ["id"] = id, ["name"] = id, ["status"] = status, ["objective"] = id, ["parentId"] = parent,
        ["projectIds"] = new JsonArray(), ["activity"] = new JsonArray()
    };

    private static JsonObject Finished(string id)
    {
        var task = Task(id, "done");
        task["commitUrls"] = new JsonArray("https://github.com/example/app/commit/abc1234");
        return task;
    }

    private static JsonObject Document(JsonArray tasks, JsonArray links, JsonArray? roster)
    {
        var map = new JsonObject { ["name"] = "Flows" };
        if (roster is not null) map["agents"] = new JsonObject { ["roster"] = roster };
        return new JsonObject
        {
            ["version"] = 9,
            ["map"] = map,
            ["projects"] = new JsonArray(),
            ["tasks"] = tasks,
            ["labels"] = new JsonArray(),
            ["links"] = links
        };
    }

    private static async Task<Guid> Create(HttpClient client, JsonArray tasks, JsonArray? links = null, JsonArray? roster = null)
    {
        var id = Guid.NewGuid();
        await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "insert", values = new { id, data = Document(tasks, links ?? new JsonArray(), roster) } });
        return id;
    }

    private static async Task Connect(HttpClient client, Guid workspace, params string[] hosts) =>
        await ProjectFlowTests.Command(client, "runner_heartbeat", new
        {
            workspace_id = workspace, runner = "runner-a", hosts, agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5
        });

    private static Task<HttpResponseMessage> Post(HttpClient client, string name, object args) =>
        client.PostAsJsonAsync("/api/commands/" + name, args);

    private static DateTime Moment(JsonNode? value) =>
        DateTime.Parse(value!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime();

    private static async Task<JsonArray> RequestRows(HttpClient client, Guid id) =>
        (await ProjectFlowTests.Query(client, new { table = "flow_requests", filters = new object[] { new { field = "workspace_id", op = "eq", value = id.ToString() } } }))["data"]!.AsArray();

    private static async Task Conflict(HttpClient client, string name, object args, string message)
    {
        var response = await Post(client, name, args);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains(message, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task CancellingRemovesThePendingRequestOnce()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, []);
            await Connect(client, workspace, "claude");
            var request = await ProjectFlowTests.Command(client, "request_pull", new { workspace_id = workspace, runner = "runner-a" });
            var requestId = request["request_id"]!.GetValue<string>();

            var stranger = await ProjectFlowTests.Command(client, "cancel_flow", new { workspace_id = workspace, request_id = Guid.NewGuid() });
            Assert.False(stranger["cancelled"]!.GetValue<bool>());
            var cancelled = await ProjectFlowTests.Command(client, "cancel_flow", new { workspace_id = workspace, request_id = requestId });
            Assert.True(cancelled["cancelled"]!.GetValue<bool>());
            var again = await ProjectFlowTests.Command(client, "cancel_flow", new { workspace_id = workspace, request_id = requestId });
            Assert.False(again["cancelled"]!.GetValue<bool>());
            Assert.Empty(await RequestRows(client, workspace));

            await ProjectFlowTests.Command(client, "request_pull", new { workspace_id = workspace, runner = "runner-a" });
        }
    }

    [Fact]
    public async Task TheHeartbeatListsMergeAndPullRequestsOldestFirstAndNothingElse()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, userId) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, [Finished("first")]);
            await Connect(client, workspace, "claude");
            var merge = (await ProjectFlowTests.Command(client, "request_merge", new { workspace_id = workspace, task_id = "first" }))["request_id"]!.GetValue<string>();
            var pull = (await ProjectFlowTests.Command(client, "request_pull", new { workspace_id = workspace, runner = "runner-a" }))["request_id"]!.GetValue<string>();
            await Age(factory, workspace, Guid.Parse(merge), DateTime.UtcNow.AddMinutes(5));
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.WorkspaceFlowRequests.Add(new WorkspaceFlowRequest
                {
                    WorkspaceId = workspace, TaskId = "first", Kind = "run", Agent = "default", RequestedByUserId = userId
                });
                await db.SaveChangesAsync();
            }

            var beat = await ProjectFlowTests.Command(client, "runner_heartbeat", new
            {
                workspace_id = workspace, runner = "runner-a", name = "Studio", host = "mini.local",
                agents = Array.Empty<object>(), cost_usd = 0, lease_minutes = 5
            });
            var requests = beat["requests"]!.AsArray();
            Assert.Equal(new[] { pull, merge }, requests.Select(x => x!["request_id"]!.GetValue<string>()));
            Assert.Equal(new[] { "pull", "merge" }, requests.Select(x => x!["kind"]!.GetValue<string>()));
            Assert.True(Moment(requests[1]!["requested_at"]) > Moment(requests[0]!["requested_at"]));
        }
    }

    private static async Task Age(ApiFactory factory, Guid workspace, Guid requestId, DateTime moment)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var request = await db.WorkspaceFlowRequests.SingleAsync(x => x.WorkspaceId == workspace && x.Id == requestId);
        request.RequestedAt = moment;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task TheFlowRequestsQueryNamesTheRequesterAndNeedsOnlyReadAccess()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, userId) = await ProjectFlowTests.SignIn(factory);
        var (bob, _) = await ProjectFlowTests.SignIn(factory);
        using (client) using (bob)
        {
            var workspace = await Create(client, [Finished("ready")]);
            var request = (await ProjectFlowTests.Command(client, "request_merge", new { workspace_id = workspace, task_id = "ready" }))["request_id"]!.GetValue<string>();

            var row = Assert.Single(await RequestRows(client, workspace))!;
            Assert.Equal(request, row["request_id"]!.GetValue<string>());
            Assert.Equal("ready", row["task_id"]!.GetValue<string>());
            Assert.Equal("merge", row["kind"]!.GetValue<string>());
            Assert.Equal(userId.ToString(), row["requested_by"]!.GetValue<string>());
            Assert.Equal("Test user", row["requested_by_name"]!.GetValue<string>());
            Assert.True(Moment(row["requested_at"]) <= DateTime.UtcNow.AddSeconds(5));

            var filters = new object[] { new { field = "workspace_id", op = "eq", value = workspace.ToString() } };
            Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync("/api/query", new { table = "flow_requests", filters })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/query", new { table = "flow_requests" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/query", new { table = "flow_requests", operation = "delete", filters })).StatusCode);
        }
    }

    [Fact]
    public async Task MergeRequestsRequireAFinishedTaskWithACommitAndAreUnique()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var unfinished = Task("unfinished", "todo");
            unfinished["commitUrls"] = new JsonArray("https://github.com/example/app/commit/abc1234");
            var empty = Task("empty", "done");
            empty["commitUrls"] = new JsonArray();
            var workspace = await Create(client, [unfinished, empty, Finished("ready")]);

            Assert.Equal(HttpStatusCode.NotFound, (await Post(client, "request_merge", new { workspace_id = workspace, task_id = "missing" })).StatusCode);
            await Conflict(client, "request_merge", new { workspace_id = workspace, task_id = "unfinished" }, "Task is not done.");
            await Conflict(client, "request_merge", new { workspace_id = workspace, task_id = "empty" }, "Task has no commit.");

            var response = await ProjectFlowTests.Command(client, "request_merge", new { workspace_id = workspace, task_id = "ready" });
            Assert.Equal("ready", response["task_id"]!.GetValue<string>());
            Assert.True(Guid.TryParse(response["request_id"]!.GetValue<string>(), out _));
            await Conflict(client, "request_merge", new { workspace_id = workspace, task_id = "ready" }, "A merge is already pending.");

            var row = Assert.Single(await RequestRows(client, workspace))!;
            Assert.Equal("merge", row["kind"]!.GetValue<string>());
            Assert.Equal("ready", row["task_id"]!.GetValue<string>());
            Assert.Equal("", row["agent"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task PullingAndPingingBelongToTheRunnersOwnerAlone()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory);
        var (bob, bobId) = await ProjectFlowTests.SignIn(factory);
        using (client) using (bob)
        {
            var workspace = await Create(client, []);
            await Conflict(client, "request_pull", new { workspace_id = workspace, runner = "runner-a" }, "Unknown runner.");
            await Connect(client, workspace, "claude");
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspace, UserId = bobId });
                await db.SaveChangesAsync();
            }

            foreach (var command in new[] { "request_pull", "ping_runner" })
            {
                var response = await Post(bob, command, new { workspace_id = workspace, runner = "runner-a" });
                Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
                Assert.Contains("Only the runner's owner can do that.", await response.Content.ReadAsStringAsync());
            }

            var pull = await ProjectFlowTests.Command(client, "request_pull", new { workspace_id = workspace, runner = "runner-a" });
            Assert.Equal("runner-a", pull["runner"]!.GetValue<string>());
            await Conflict(client, "request_pull", new { workspace_id = workspace, runner = "runner-a" }, "A pull is already pending.");

            var row = Assert.Single(await RequestRows(client, workspace))!;
            Assert.Equal("pull", row["kind"]!.GetValue<string>());
            Assert.Equal("", row["agent"]!.GetValue<string>());
            Assert.Equal("runner-a", row["task_id"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task CompletingAndCancellingDeleteRequestsOfEveryKind()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory); using (client)
        {
            var workspace = await Create(client, [Finished("ready")]);
            await Connect(client, workspace, "claude");
            var merge = await ProjectFlowTests.Command(client, "request_merge", new { workspace_id = workspace, task_id = "ready" });
            var pull = await ProjectFlowTests.Command(client, "request_pull", new { workspace_id = workspace, runner = "runner-a" });

            var completed = await ProjectFlowTests.Command(client, "complete_request", new { workspace_id = workspace, request_id = merge["request_id"]!.GetValue<string>() });
            Assert.True(completed["completed"]!.GetValue<bool>());
            var missing = await ProjectFlowTests.Command(client, "complete_request", new { workspace_id = workspace, request_id = merge["request_id"]!.GetValue<string>() });
            Assert.False(missing["completed"]!.GetValue<bool>());
            var cancelled = await ProjectFlowTests.Command(client, "cancel_flow", new { workspace_id = workspace, request_id = pull["request_id"]!.GetValue<string>() });
            Assert.True(cancelled["cancelled"]!.GetValue<bool>());
            Assert.Empty(await RequestRows(client, workspace));
        }
    }
}
