using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class WorkspaceGraphTests
{
    [Fact]
    public async Task SharedGraphPersistsRelationshipsAndDeletesWithoutCrossWorkspaceChanges()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (owner, _) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(owner);
            var otherId = await ProjectFlowTests.CreateWorkspace(owner, "Other");
            var data = ProjectFlowTests.Workspace();
            data["projects"]!.AsArray().Add(new JsonObject { ["id"] = "second", ["name"] = "Second" });
            data["labels"]!.AsArray().Add(new JsonObject { ["id"] = "label", ["name"] = "Important", ["color"] = "red" });
            var task = data["tasks"]![0]!;
            task["projectIds"]!.AsArray().Add("second");
            task["labels"] = new JsonArray("Important");
            task["objective"] = new string('x', 5000);
            task["position"] = new JsonObject { ["x"] = 12.5, ["y"] = -3 };
            task["activity"]!.AsArray().Add(new JsonObject { ["id"] = "activity", ["text"] = "Created", ["at"] = "2026-09-13T10:00:00Z", ["author"] = "Owner", ["authorType"] = "user" });
            data["tasks"]!.AsArray().Add(new JsonObject { ["id"] = "child", ["name"] = "Child", ["parentId"] = "task", ["projectIds"] = new JsonArray("second"), ["activity"] = new JsonArray() });
            data["links"]!.AsArray().Add(new JsonObject { ["id"] = "dependency", ["source"] = "task", ["target"] = "child", ["sourceHandle"] = "bottom" });
            object[] Filter(long revision) => [new { field = "id", op = "eq", value = workspaceId.ToString() }, new { field = "revision", op = "eq", value = revision }];
            await ProjectFlowTests.Query(owner, new { table = "workspaces", operation = "update", filters = Filter(1), values = new { data } });
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspaceId, UserId = guestId });
                await db.SaveChangesAsync();
                Assert.Null(db.Model.FindEntityType(typeof(WorkspaceDocument))!.FindProperty("Data"));
                Assert.Equal(2, await db.Set<WorkspaceProject>().CountAsync(x => x.WorkspaceId == workspaceId));
                Assert.Equal(3, await db.Set<WorkspaceProjectTask>().CountAsync(x => x.WorkspaceId == workspaceId));
                Assert.Single(await db.Set<WorkspaceTaskActivity>().Where(x => x.WorkspaceId == workspaceId).ToListAsync());
                // The task named the label; the row holds the label's id.
                Assert.Equal("label", (await db.Set<WorkspaceTaskLabel>().SingleAsync(x => x.WorkspaceId == workspaceId)).LabelId);
            }
            var visible = (await ProjectFlowTests.Query(guest, new { table = "workspaces", filters = ProjectFlowTests.IdFilter(workspaceId) }))["data"]![0]!["data"]!;
            Assert.Equal(new string('x', 5000), visible["tasks"]![0]!["objective"]!.GetValue<string>());
            Assert.Equal(12.5, visible["tasks"]![0]!["position"]!["x"]!.GetValue<double>());
            Assert.Equal("bottom", visible["links"]![0]!["sourceHandle"]!.GetValue<string>());
            Assert.Equal(2, visible["tasks"]![0]!["projectIds"]!.AsArray().Count);
            Assert.Equal("Important", visible["tasks"]![0]!["labels"]![0]!.GetValue<string>());
            // A label the workspace does not define, and one label named twice,
            // are rejected rather than written as a row the schema cannot hold.
            var invalid = ProjectFlowTests.Workspace();
            invalid["labels"]!.AsArray().Add(new JsonObject { ["id"] = "label", ["name"] = "Important" });
            foreach (var tags in new[] { new JsonArray("Deleted"), new JsonArray("Important", "label") })
            {
                invalid["tasks"]![0]!["labels"] = tags;
                Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/api/query",
                    new { table = "workspaces", operation = "update", filters = Filter(2), values = new { data = invalid } })).StatusCode);
            }
            // Delete the parent, its label and one project, keeping the child.
            data["tasks"]!.AsArray().RemoveAt(0);
            data["tasks"]![0]!["parentId"] = null;
            data["projects"]!.AsArray().RemoveAt(0);
            data["labels"] = new JsonArray(); data["links"] = new JsonArray();
            await ProjectFlowTests.Query(guest, new { table = "workspaces", operation = "update", filters = Filter(2), values = new { data } });
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.Empty(await db.Set<WorkspaceTaskActivity>().Where(x => x.WorkspaceId == workspaceId).ToListAsync());
                Assert.Empty(await db.Set<WorkspaceTaskLabel>().Where(x => x.WorkspaceId == workspaceId).ToListAsync());
                Assert.Empty(await db.Set<WorkspaceDependency>().Where(x => x.WorkspaceId == workspaceId).ToListAsync());
                Assert.Single(await db.Set<WorkspaceTask>().Where(x => x.WorkspaceId == workspaceId).ToListAsync());
                Assert.Single(await db.Set<WorkspaceTask>().Where(x => x.WorkspaceId == otherId).ToListAsync());
            }
            await ProjectFlowTests.Query(owner, new { table = "workspaces", operation = "delete", filters = ProjectFlowTests.IdFilter(workspaceId) });
        }
    }

    [Fact]
    public void TaskLabelsResolveNamesBeforeIdsAndDropWhatNoLabelDefines()
    {
        var data = ProjectFlowTests.Workspace();
        // "Bug" is the name of one label and the id of the other, so the two
        // spellings of the same reference collapse and the name wins.
        data["labels"] = new JsonArray(new JsonObject { ["id"] = "label-0", ["name"] = "Bug" },
            new JsonObject { ["id"] = "Bug", ["name"] = "Improvement" });
        data["tasks"]![0]!["labels"] = new JsonArray("Bug", "Improvement", "Bug", "label-0", "Deleted");
        var workspace = new WorkspaceDocument { Data = data.ToJsonString() };
        Assert.Equal(["label-0", "Bug"],
            workspace.Tasks[0].Labels.OrderBy(l => l.SortOrder).Select(l => l.LabelId).ToArray());
        Assert.Equal(["Bug", "Improvement"],
            JsonNode.Parse(workspace.Data)!["tasks"]![0]!["labels"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray());
    }

    [Fact]
    public async Task ActivityKeepsItsKindAndCommitAndDropsPaths()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            var data = ProjectFlowTests.Workspace();
            data["tasks"]![0]!["activity"] = new JsonArray(
                new JsonObject
                {
                    ["id"] = "report", ["text"] = "Rationed the verification emails", ["at"] = "2026-09-13T10:00:00Z",
                    ["author"] = "Claude", ["authorType"] = "ai", ["kind"] = "change",
                    ["paths"] = new JsonArray("backend/Wireal.Api/Email/EmailRationing.cs", "backend/Wireal.Api/Auth/AuthService.cs"),
                    ["commit"] = "8bc0d8d"
                },
                new JsonObject { ["id"] = "typed", ["text"] = "Status changed from todo to doing", ["at"] = "2026-09-13T09:00:00Z", ["author"] = "Owner", ["authorType"] = "user" });
            await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "update", values = new { data },
                filters = new object[] { new { field = "id", op = "eq", value = workspaceId.ToString() }, new { field = "revision", op = "eq", value = 1 } } });
            var saved = (await ProjectFlowTests.Query(client, new { table = "workspaces", filters = ProjectFlowTests.IdFilter(workspaceId) }))["data"]![0]!["data"]!;
            var activity = saved["tasks"]![0]!["activity"]!.AsArray();
            Assert.Equal("change", activity[0]!["kind"]!.GetValue<string>());
            Assert.Equal("8bc0d8d", activity[0]!["commit"]!.GetValue<string>());
            Assert.False(activity[0]!.AsObject().ContainsKey("paths"));
            foreach (var key in new[] { "kind", "paths", "commit" }) Assert.False(activity[1]!.AsObject().ContainsKey(key));
        }
    }

    [Fact]
    public async Task ActivityKindAndCommitAreRejectedWhenMalformed()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            foreach (var (kind, commit) in new[] { ("rumour", "8bc0d8d"), ("change", "work in progress") })
            {
                var data = ProjectFlowTests.Workspace();
                data["tasks"]![0]!["activity"] = new JsonArray(new JsonObject
                {
                    ["id"] = "report", ["text"] = "Reworked the task card", ["at"] = "2026-09-13T10:00:00Z",
                    ["author"] = "Claude", ["authorType"] = "ai", ["kind"] = kind, ["commit"] = commit
                });
                var response = await client.PostAsJsonAsync("/api/query", new { table = "workspaces", operation = "update", values = new { data },
                    filters = new object[] { new { field = "id", op = "eq", value = workspaceId.ToString() }, new { field = "revision", op = "eq", value = 1 } } });
                Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            }
        }
    }
}
