using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class ProjectFlowTests
{
    public static JsonObject Workspace(string name = "Workspace") => new()
    {
        ["version"] = 9, ["map"] = new JsonObject { ["name"] = name, ["repositoryUrl"] = "https://github.com/example/app" },
        ["projects"] = new JsonArray(new JsonObject { ["id"] = "project", ["name"] = "Project", ["repositoryUrl"] = "https://github.com/example/app" }),
        ["tasks"] = new JsonArray(new JsonObject { ["id"] = "task", ["name"] = "Task", ["projectIds"] = new JsonArray("project"), ["activity"] = new JsonArray() }),
        ["labels"] = new JsonArray(), ["links"] = new JsonArray()
    };
    public static async Task<(HttpClient Client, Guid UserId)> SignIn(ApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new AppUser { Email = Guid.NewGuid() + "@example.com", EmailVerified = true, DisplayName = "Test user" };
        var session = new AuthSession { User = user, ExpiresAt = DateTime.UtcNow.AddDays(1) };
        db.Users.Add(user); db.AuthSessions.Add(session); await db.SaveChangesAsync();
        var token = scope.ServiceProvider.GetRequiredService<TokenService>().Access(user, session);
        var client = factory.Client(); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        return (client, user.Id);
    }
    public static async Task<JsonNode> Query(HttpClient client, object query)
    {
        var response = await client.PostAsJsonAsync("/api/query", query);
        var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, text);
        return JsonNode.Parse(text)!;
    }
    public static async Task<JsonNode> Command(HttpClient client, string name, object args)
    {
        var response = await client.PostAsJsonAsync("/api/commands/" + name, args);
        var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, text);
        return JsonNode.Parse(text)!["data"]!;
    }
    public static async Task<Guid> CreateWorkspace(HttpClient client, string name = "Workspace")
    {
        var id = Guid.NewGuid(); await Query(client, new { table = "workspaces", operation = "insert", values = new { id, data = Workspace(name) } }); return id;
    }
    public static object[] IdFilter(Guid id) => [new { field = "id", op = "eq", value = id.ToString() }];

    [Fact]
    public async Task OwnershipRevisionAndSwitchingAreEnforcedWhileOwningNothingIsAllowed()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (alice, owner) = await SignIn(factory); var (bob, _) = await SignIn(factory);
        using (alice) using (bob)
        {
            using var anonymous = factory.Client();
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/query", new { table = "workspaces" })).StatusCode);
            var id = await CreateWorkspace(alice);
            Assert.Empty((await Query(bob, new { table = "workspaces", filters = IdFilter(id) }))["data"]!.AsArray());
            Assert.Equal(HttpStatusCode.Forbidden, (await bob.PostAsJsonAsync("/api/query", new { table = "workspaces", operation = "insert", values = new { id = Guid.NewGuid(), user_id = owner, data = Workspace() } })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync("/api/commands/set_active_workspace", new { target_workspace_id = id })).StatusCode);
            var updated = await Query(alice, new { table = "workspaces", operation = "update", columns = "revision", single = "optional",
                filters = new object[] { new { field = "id", op = "eq", value = id.ToString() }, new { field = "revision", op = "eq", value = 1 } }, values = new { data = Workspace("Edited") } });
            Assert.Equal(2, updated["data"]!["revision"]!.GetValue<int>());
            var stale = await Query(alice, new { table = "workspaces", operation = "update", single = "optional",
                filters = new object[] { new { field = "id", op = "eq", value = id.ToString() }, new { field = "revision", op = "eq", value = 1 } }, values = new { data = Workspace("Lost edit") } });
            Assert.Null(stale["data"]);
            Assert.Equal(HttpStatusCode.PreconditionRequired, (await alice.PostAsJsonAsync("/api/query", new { table = "workspaces", operation = "update", filters = IdFilter(id), values = new { data = Workspace() } })).StatusCode);
            var second = await CreateWorkspace(alice, "Second");
            await Command(alice, "set_active_workspace", new { target_workspace_id = second });
            var rows = (await Query(alice, new { table = "workspaces" }))["data"]!.AsArray();
            Assert.Single(rows, x => x!["is_active"]!.GetValue<bool>());
            Assert.Equal(second.ToString(), rows.Single(x => x!["is_active"]!.GetValue<bool>())!["id"]!.GetValue<string>());
            await Query(alice, new { table = "workspaces", operation = "delete", filters = IdFilter(second) });
            Assert.True((await Query(alice, new { table = "workspaces" }))["data"]![0]!["is_active"]!.GetValue<bool>());
            await Query(alice, new { table = "workspaces", operation = "delete", filters = IdFilter(id) });
            Assert.Empty((await Query(alice, new { table = "workspaces" }))["data"]!.AsArray());
            Assert.Empty(await alice.GetFromJsonAsync<JsonArray>("/api/workspace-changes") ?? []);
            Assert.Equal("Test user", (await Query(alice, new { table = "profiles", single = "required" }))["data"]!["display_name"]!.GetValue<string>());
            using (var scope = factory.Services.CreateScope())
                Assert.Null((await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.FindAsync(owner))!.ActiveWorkspaceId);
            var again = await CreateWorkspace(alice, "Again");
            Assert.Equal(again.ToString(), (await Query(alice, new { table = "workspaces" }))["data"]!.AsArray()
                .Single(x => x!["is_active"]!.GetValue<bool>())!["id"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task ProfilesAndAvatarsStayWithinTheirAccount()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (alice, owner) = await SignIn(factory); var (bob, _) = await SignIn(factory);
        using (alice) using (bob)
        {
            await CreateWorkspace(alice);
            await Query(alice, new { table = "profiles", operation = "update", filters = IdFilter(owner), values = new { onboarding_done = true, language_prompt_done = true, preferred_language = "tr" } });
            Assert.Equal("tr", (await Query(alice, new { table = "profiles", single = "required" }))["data"]!["preferred_language"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync("/api/query", new { table = "profiles", operation = "update", filters = IdFilter(owner), values = new { onboarding_done = true } })).StatusCode);
            var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=");
            using var image = new ByteArrayContent(png); image.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            Assert.Equal(HttpStatusCode.Forbidden, (await bob.PutAsync("/api/avatars/" + owner, image)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await alice.PutAsync("/api/avatars/" + owner, image)).StatusCode);
            using var publicClient = factory.Client();
            Assert.Equal(png, await publicClient.GetByteArrayAsync("/api/avatars/" + owner));
            using var invalid = new StringContent("<svg onload='alert(1)'></svg>"); invalid.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            Assert.Equal(HttpStatusCode.BadRequest, (await alice.PutAsync("/api/avatars/" + owner, invalid)).StatusCode);
            Assert.NotEmpty((await alice.GetStringAsync("/api/workspace-changes")));
            Assert.Equal("[]", await bob.GetStringAsync("/api/workspace-changes"));
        }
    }

    [Fact]
    public async Task WorkspaceTeamIncludesMemberIdentity()
    {
        await using var factory = new ApiFactory(); await factory.InitializeDatabaseAsync();
        var (client, owner) = await SignIn(factory); using (client)
        {
            var workspace = await CreateWorkspace(client);
            var response = await client.GetAsync($"/api/teams/{workspace}");
            var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, text);
            var team = JsonNode.Parse(text)!;
            var member = Assert.Single(team["members"]!.AsArray());
            Assert.Equal(owner.ToString(), member!["id"]!.GetValue<string>());
            Assert.Equal("Test user", member["name"]!.GetValue<string>());
            Assert.EndsWith("@example.com", member["email"]!.GetValue<string>());
            Assert.True(member.AsObject().ContainsKey("avatarUrl"));
        }
    }
}
