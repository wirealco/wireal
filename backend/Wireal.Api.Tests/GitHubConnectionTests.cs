using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Wireal.Api.GitHub;
using Xunit;

namespace Wireal.Api.Tests;

public static class GitHubTestKey
{
    public static string Pem { get; } = Create();
    private static string Create()
    {
        using var rsa = RSA.Create(2048);
        return rsa.ExportPkcs8PrivateKeyPem();
    }

    public static GitHubAppSettings Settings()
    {
        var settings = new GitHubAppSettings
        {
            AppId = 12345, Slug = "wireal-test", ClientId = "Iv1.test-client", ClientSecret = "test-secret", PrivateKey = Pem
        };
        settings.Load();
        return settings;
    }
}

public sealed class FakeGitHubAppClient : IGitHubAppClient
{
    public const long DefaultInstallation = 42;
    public GitHubInstallation? Account { get; set; } = new(DefaultInstallation, "octo-org", "Organization", "selected");
    public GitHubInstallation[] Installed { get; set; } = [new(DefaultInstallation, "octo-org", "Organization", "selected")];
    public GitHubRepository[] RepositoryList { get; set; } = [new("octo-org/api", true, "main")];
    public HashSet<string> Unreadable { get; } = new(StringComparer.OrdinalIgnoreCase);
    public HashSet<string> UnreadableOnce { get; } = new(StringComparer.OrdinalIgnoreCase);
    public GitHubFolder[]? FolderList { get; set; } = [new("src", "src")];
    public GitHubCommit CommitResult { get; set; } = new(
        [new GitHubFile("src/a.ts", null, "modified", 12, 3, "@@ -1 +1 @@\n-old\n+new")],
        new DateTime(2026, 9, 10, 12, 0, 0, DateTimeKind.Utc), null, null);
    public int CommitCalls { get; private set; }
    public int InstallationCalls { get; private set; }
    public int ReadableCalls { get; private set; }
    public int ForgetCalls { get; private set; }

    public Task<GitHubInstallation?> Installation(long installationId, CancellationToken ct)
    {
        InstallationCalls += 1;
        return Task.FromResult(Account);
    }
    public Task<GitHubInstallation[]> UserInstallations(string code, CancellationToken ct) => Task.FromResult(Installed);
    public Task<GitHubRepository[]> Repositories(long installationId, CancellationToken ct) => Task.FromResult(RepositoryList);
    public void Forget(long installationId) => ForgetCalls += 1;
    public Task<bool> Readable(long installationId, string owner, string repo, CancellationToken ct)
    {
        ReadableCalls += 1;
        var name = owner + "/" + repo;
        return Task.FromResult(!UnreadableOnce.Remove(name) && !Unreadable.Contains(name));
    }
    public Task<GitHubFolder[]?> Folders(long installationId, string owner, string repo, string path, string? reference, CancellationToken ct) =>
        Task.FromResult(FolderList);
    public Task<GitHubCommit> Commit(long installationId, string owner, string repo, string sha, CancellationToken ct)
    {
        CommitCalls += 1;
        return Task.FromResult(CommitResult);
    }
}

public sealed class GitHubConnectionTests
{
    private const string Sha = "0123456789abcdef0123456789abcdef01234567";
    private static string CommitUrl(string sha = Sha) => $"https://github.com/octo-org/api/commit/{sha}";

    private static FakeGitHubAppClient Fake(ApiFactory factory) => (FakeGitHubAppClient)factory.Services.GetRequiredService<IGitHubAppClient>();

    private static async Task Connect(ApiFactory factory, Guid workspaceId, Guid userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.GitHubInstallations.Add(new WorkspaceGitHubInstallation
        {
            WorkspaceId = workspaceId, InstallationId = FakeGitHubAppClient.DefaultInstallation,
            AccountLogin = "octo-org", AccountType = "Organization", RepositorySelection = "selected",
            ConnectedBy = userId, ConnectedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private static void ForgetAdoption(ApiFactory factory, Guid workspaceId) =>
        factory.Services.GetRequiredService<IMemoryCache>().Remove("github-adoption:" + workspaceId);

    private static async Task<WorkspaceGitHubInstallation?> Stored(ApiFactory factory, Guid workspaceId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubInstallations
            .AsNoTracking().SingleOrDefaultAsync(x => x.WorkspaceId == workspaceId);
    }

    private static async Task StoreSnapshot(ApiFactory factory, string filesJson)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.GitHubCommitSnapshots.Add(new GitHubCommitSnapshot
        {
            Key = "octo-org/api@" + Sha,
            Owner = "octo-org",
            Repo = "api",
            Sha = Sha,
            CommittedAt = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc),
            Additions = 1,
            Deletions = 1,
            FilesJson = filesJson,
            FetchedAt = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
    }

    private static async Task Linked(ApiFactory factory, Guid workspaceId, params string[] urls)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var carried = new JsonArray();
        foreach (var url in urls.Length == 0 ? [CommitUrl()] : urls) carried.Add(url);
        db.Tasks.Add(new WorkspaceTask
        {
            WorkspaceId = workspaceId,
            Id = Guid.NewGuid().ToString(),
            Name = "Linked",
            ReferenceId = "1",
            Status = "done",
            SettingsJson = new JsonObject { ["commitUrls"] = carried }.ToJsonString()
        });
        await db.SaveChangesAsync();
    }

    private static async Task Project(ApiFactory factory, Guid workspaceId, string repositoryUrl)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Projects.Add(new WorkspaceProject
        {
            WorkspaceId = workspaceId, Id = Guid.NewGuid().ToString(), Name = "App", RepositoryUrl = repositoryUrl
        });
        await db.SaveChangesAsync();
    }

    private static async Task Invite(ApiFactory factory, Guid workspaceId, Guid userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspaceId, UserId = userId });
        await db.SaveChangesAsync();
    }

    private static string ChooseTicket(ApiFactory factory, Guid workspaceId, Guid userId, TimeSpan life, params long[] ids) =>
        factory.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("Wireal.GitHubChoose.v1")
            .Protect(JsonSerializer.Serialize(new
            {
                Workspace = workspaceId,
                User = userId,
                Expires = DateTime.UtcNow.Add(life).Ticks,
                Installations = ids.Select(id => new
                {
                    Id = id, AccountLogin = "octo-org", AccountType = "Organization", RepositorySelection = "selected"
                }).ToArray()
            }));

    private static string TicketFrom(Uri location) => Uri.UnescapeDataString(location.Query.TrimStart('?')
        .Split('&').Single(part => part.StartsWith("ticket=", StringComparison.Ordinal))["ticket=".Length..]);

    private static string State(ApiFactory factory, Guid workspaceId, Guid userId, TimeSpan? life = null) =>
        factory.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("Wireal.GitHubInstall.v1")
            .Protect(string.Join('|', workspaceId, userId, DateTime.UtcNow.Add(life ?? TimeSpan.FromMinutes(10)).Ticks));

    private static async Task<HttpClient> McpClient(ApiFactory factory, Guid userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.FindAsync(userId);
        var session = new AuthSession { UserId = userId, ExpiresAt = DateTime.UtcNow.AddDays(1), OAuthClientId = Guid.NewGuid().ToString() };
        db.AuthSessions.Add(session);
        await db.SaveChangesAsync();
        var token = scope.ServiceProvider.GetRequiredService<TokenService>().Access(user!, session);
        var client = factory.Client();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        return client;
    }

    [Fact]
    public void SettingsBindFromConfigurationAndRefuseAnUnusableKey()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GitHub:App:AppId"] = "12345", ["GitHub:App:Slug"] = "wireal-test", ["GitHub:App:ClientId"] = "Iv1.test-client",
            ["GitHub:App:ClientSecret"] = "test-secret", ["GitHub:App:PrivateKey"] = GitHubTestKey.Pem
        }).Build();
        var settings = config.GetSection("GitHub:App").Get<GitHubAppSettings>()!;
        settings.Load();
        Assert.True(settings.Configured);
        Assert.NotNull(settings.SigningKey());
        var broken = config.GetSection("GitHub:App").Get<GitHubAppSettings>()!;
        broken.PrivateKey = "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----";
        Assert.Throws<InvalidOperationException>(broken.Load);
        var missing = new ConfigurationBuilder().Build().GetSection("GitHub:App").Get<GitHubAppSettings>() ?? new GitHubAppSettings();
        missing.Load();
        Assert.False(missing.Configured);
    }

    [Fact]
    public async Task StatusReportsNotConfiguredWhenTheAppSectionIsAbsent()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            var response = await client.GetAsync($"/api/github/workspaces/{workspaceId}");
            var text = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, text);
            var status = JsonNode.Parse(text)!;
            Assert.False(status["configured"]!.GetValue<bool>());
            Assert.False(status["connected"]!.GetValue<bool>());
            Assert.Equal("owner", status["role"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task StatusListsTheInstallationAndItsRepositories()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, owner) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, owner);
            var status = JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{workspaceId}"))!;
            Assert.True(status["configured"]!.GetValue<bool>());
            Assert.True(status["connected"]!.GetValue<bool>());
            Assert.Equal("octo-org", status["account"]!.GetValue<string>());
            Assert.Equal($"https://github.com/organizations/octo-org/settings/installations/{FakeGitHubAppClient.DefaultInstallation}",
                status["manageUrl"]!.GetValue<string>());
            Assert.Equal("octo-org/api", status["repositories"]![0]!["fullName"]!.GetValue<string>());
            Assert.True(status["repositories"]![0]!["private"]!.GetValue<bool>());
        }
    }

    [Fact]
    public async Task ConnectIsRefusedForCollaboratorsAndForMcpClients()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (owner, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(owner);
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspaceId, UserId = guestId });
                await db.SaveChangesAsync();
            }
            Assert.Equal(HttpStatusCode.Forbidden, (await guest.PostAsync($"/api/github/workspaces/{workspaceId}/connect", null)).StatusCode);
            using var mcp = await McpClient(factory, ownerId);
            Assert.Equal(HttpStatusCode.Forbidden, (await mcp.PostAsync($"/api/github/workspaces/{workspaceId}/connect", null)).StatusCode);
            var allowed = await owner.PostAsync($"/api/github/workspaces/{workspaceId}/connect", null);
            var text = await allowed.Content.ReadAsStringAsync();
            Assert.True(allowed.IsSuccessStatusCode, text);
            Assert.StartsWith("https://github.com/login/oauth/authorize?client_id=Iv1.test-client&state=",
                JsonNode.Parse(text)!["url"]!.GetValue<string>(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ConnectIsRefusedWhenTheAppIsNotConfigured()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            var response = await client.PostAsync($"/api/github/workspaces/{workspaceId}/connect", null);
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Contains("GitHub App is not configured on this server.", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task CallbackBindsTheInstallationAndReturnsToTheApp()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            var state = Uri.EscapeDataString(State(factory, workspaceId, ownerId));
            var response = await client.GetAsync($"/auth/github/app/callback?code=exchange&installation_id=42&setup_action=install&state={state}");
            Assert.Equal(HttpStatusCode.Found, response.StatusCode);
            Assert.Equal($"https://localhost:5173/?github=connected&workspace={workspaceId}", response.Headers.Location!.ToString());
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = Assert.Single(db.GitHubInstallations);
            Assert.Equal(workspaceId, row.WorkspaceId);
            Assert.Equal(42, row.InstallationId);
            Assert.Equal("octo-org", row.AccountLogin);
            Assert.Equal(ownerId, row.ConnectedBy);
            Assert.Equal(workspaceId, (await db.Users.FindAsync(ownerId))!.ActiveWorkspaceId);
        }
    }

    [Fact]
    public async Task CallbackRejectsAnInstallationTheUserCannotReach()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            Fake(factory).Installed = [new(99, "other-org", "Organization", "all")];
            var state = Uri.EscapeDataString(State(factory, workspaceId, ownerId));
            var response = await client.GetAsync($"/auth/github/app/callback?code=exchange&installation_id=42&setup_action=install&state={state}");
            Assert.Equal(HttpStatusCode.Found, response.StatusCode);
            Assert.Equal("https://localhost:5173/?github=error", response.Headers.Location!.ToString());
            await using var scope = factory.Services.CreateAsyncScope();
            Assert.Empty(scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubInstallations);
        }
    }

    [Fact]
    public async Task CallbackWithoutUsableStateReturnsAnError()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        using var client = factory.Client();
        var response = await client.GetAsync("/auth/github/app/callback?code=exchange&installation_id=42&setup_action=install&state=tampered");
        Assert.Equal("https://localhost:5173/?github=error", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task CallbackWithoutAnInstallationSendsTheUserToInstallWhenNothingIsInstalled()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            Fake(factory).Installed = [];
            var state = Uri.EscapeDataString(State(factory, workspaceId, ownerId));
            var response = await client.GetAsync($"/auth/github/app/callback?code=exchange&state={state}");
            Assert.Equal(HttpStatusCode.Found, response.StatusCode);
            Assert.StartsWith("https://github.com/apps/wireal-test/installations/new?state=",
                response.Headers.Location!.ToString(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task CallbackWithoutAnInstallationOffersTheChoiceWithATicket()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            var state = Uri.EscapeDataString(State(factory, workspaceId, ownerId));
            var response = await client.GetAsync($"/auth/github/app/callback?code=exchange&state={state}");
            Assert.Equal(HttpStatusCode.Found, response.StatusCode);
            var location = response.Headers.Location!;
            Assert.StartsWith($"https://localhost:5173/?github=choose&workspace={workspaceId}&ticket=",
                location.ToString(), StringComparison.Ordinal);
            var choices = JsonNode.Parse(await client.GetStringAsync(
                $"/api/github/workspaces/{workspaceId}/installation-choices?ticket={Uri.EscapeDataString(TicketFrom(location))}"))!;
            var row = Assert.Single(choices["installations"]!.AsArray())!;
            Assert.Equal(FakeGitHubAppClient.DefaultInstallation, row["id"]!.GetValue<long>());
            Assert.Equal("octo-org", row["account"]!.GetValue<string>());
            Assert.Equal("Organization", row["accountType"]!.GetValue<string>());
            Assert.False(row["connectedElsewhere"]!.GetValue<bool>());
            Assert.StartsWith("https://github.com/apps/wireal-test/installations/new?state=",
                choices["installUrl"]!.GetValue<string>(), StringComparison.Ordinal);
            await using var scope = factory.Services.CreateAsyncScope();
            Assert.Empty(scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubInstallations);
        }
    }

    [Fact]
    public async Task InstallationChoicesFlagTheOnesAnotherWorkspaceAlreadyUses()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var taken = await ProjectFlowTests.CreateWorkspace(client, "Taken");
            var fresh = await ProjectFlowTests.CreateWorkspace(client, "Fresh");
            await Connect(factory, taken, ownerId);
            var ticket = ChooseTicket(factory, fresh, ownerId, TimeSpan.FromMinutes(10), FakeGitHubAppClient.DefaultInstallation, 77);
            var rows = JsonNode.Parse(await client.GetStringAsync(
                $"/api/github/workspaces/{fresh}/installation-choices?ticket={Uri.EscapeDataString(ticket)}"))!["installations"]!.AsArray();
            Assert.Equal(2, rows.Count);
            Assert.Equal(FakeGitHubAppClient.DefaultInstallation, rows[0]!["id"]!.GetValue<long>());
            Assert.True(rows[0]!["connectedElsewhere"]!.GetValue<bool>());
            Assert.Equal(77, rows[1]!["id"]!.GetValue<long>());
            Assert.False(rows[1]!["connectedElsewhere"]!.GetValue<bool>());
        }
    }

    [Fact]
    public async Task UsingAnInstallationBindsItAndReturnsTheConnectedStatus()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            var ticket = ChooseTicket(factory, workspaceId, ownerId, TimeSpan.FromMinutes(10), FakeGitHubAppClient.DefaultInstallation);
            var foreign = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/installations",
                new { ticket, installationId = 99 });
            Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
            Assert.Contains("The GitHub sign-in expired. Connect again.", await foreign.Content.ReadAsStringAsync(), StringComparison.Ordinal);

            var response = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/installations",
                new { ticket, installationId = FakeGitHubAppClient.DefaultInstallation });
            var text = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, text);
            var status = JsonNode.Parse(text)!;
            Assert.True(status["connected"]!.GetValue<bool>());
            Assert.Equal("octo-org", status["account"]!.GetValue<string>());
            Assert.Equal("octo-org/api", status["repositories"]![0]!["fullName"]!.GetValue<string>());
            await using var scope = factory.Services.CreateAsyncScope();
            var row = Assert.Single(scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubInstallations);
            Assert.Equal(FakeGitHubAppClient.DefaultInstallation, row.InstallationId);
            Assert.Equal(ownerId, row.ConnectedBy);
        }
    }

    [Fact]
    public async Task AChoiceTicketIsRefusedWhenItIsStaleForeignOrTheActorIsNotTheOwner()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (owner, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(owner);
            var other = await ProjectFlowTests.CreateWorkspace(owner, "Other");
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspaceId, UserId = guestId });
                await db.SaveChangesAsync();
            }
            var ticket = ChooseTicket(factory, workspaceId, ownerId, TimeSpan.FromMinutes(10), FakeGitHubAppClient.DefaultInstallation);
            var expired = ChooseTicket(factory, workspaceId, ownerId, TimeSpan.FromMinutes(-1), FakeGitHubAppClient.DefaultInstallation);
            var query = $"?ticket={Uri.EscapeDataString(ticket)}";

            Assert.Equal(HttpStatusCode.BadRequest,
                (await owner.GetAsync($"/api/github/workspaces/{workspaceId}/installation-choices?ticket={Uri.EscapeDataString(expired)}")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,
                (await owner.GetAsync($"/api/github/workspaces/{other}/installation-choices{query}")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,
                (await owner.GetAsync($"/api/github/workspaces/{workspaceId}/installation-choices?ticket=tampered")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await guest.GetAsync($"/api/github/workspaces/{workspaceId}/installation-choices{query}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await guest.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/installations",
                new { ticket, installationId = FakeGitHubAppClient.DefaultInstallation })).StatusCode);
            using var mcp = await McpClient(factory, ownerId);
            Assert.Equal(HttpStatusCode.Forbidden, (await mcp.GetAsync($"/api/github/workspaces/{workspaceId}/installation-choices{query}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await mcp.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/installations",
                new { ticket, installationId = FakeGitHubAppClient.DefaultInstallation })).StatusCode);
            await using var scope2 = factory.Services.CreateAsyncScope();
            Assert.Empty(scope2.ServiceProvider.GetRequiredService<AppDbContext>().GitHubInstallations);
        }
    }

    [Fact]
    public async Task CommitsReportNotConnectedWithoutAnInstallation()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, _) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            var response = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { CommitUrl() } });
            var text = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, text);
            var row = Assert.Single(JsonNode.Parse(text)!.AsArray())!;
            Assert.Equal(CommitUrl(), row["url"]!.GetValue<string>());
            Assert.Equal("not-connected", row["error"]!["kind"]!.GetValue<string>());
            Assert.Equal(0, Fake(factory).CommitCalls);
        }
    }

    [Fact]
    public async Task CommitsAreStoredOnceAndReplayedFromTheSnapshot()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            await Linked(factory, workspaceId);
            var body = new { urls = new[] { CommitUrl(), "https://github.com/octo-org/api/tree/main" } };
            var first = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", body);
            var text = await first.Content.ReadAsStringAsync();
            Assert.True(first.IsSuccessStatusCode, text);
            var rows = JsonNode.Parse(text)!.AsArray();
            Assert.Equal(CommitUrl(), rows[0]!["url"]!.GetValue<string>());
            Assert.Equal("octo-org", rows[0]!["owner"]!.GetValue<string>());
            Assert.Equal(Sha, rows[0]!["sha"]!.GetValue<string>());
            Assert.Equal("2026-09-10T12:00:00Z", rows[0]!["committedAt"]!.GetValue<string>());
            Assert.Equal(12, rows[0]!["additions"]!.GetValue<int>());
            Assert.Equal(3, rows[0]!["deletions"]!.GetValue<int>());
            Assert.Equal("src/a.ts", rows[0]!["files"]![0]!["path"]!.GetValue<string>());
            Assert.Null(rows[0]!["files"]![0]!["previousPath"]);
            Assert.Equal("@@ -1 +1 @@\n-old\n+new", rows[0]!["files"]![0]!["patch"]!.GetValue<string>());
            Assert.Null(rows[0]!["files"]![0]!["patchTruncated"]);
            Assert.Equal("invalid", rows[1]!["error"]!["kind"]!.GetValue<string>());
            Assert.Equal(1, Fake(factory).CommitCalls);

            var second = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", body);
            var repeated = JsonNode.Parse(await second.Content.ReadAsStringAsync())!.AsArray();
            Assert.Equal(12, repeated[0]!["additions"]!.GetValue<int>());
            Assert.Equal(1, Fake(factory).CommitCalls);
            await using var scope = factory.Services.CreateAsyncScope();
            var snapshot = Assert.Single(scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubCommitSnapshots);
            Assert.Equal("octo-org/api@" + Sha, snapshot.Key);
            Assert.Equal("@@ -1 +1 @@\n-old\n+new", JsonNode.Parse(snapshot.FilesJson)![0]!["patch"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task CommitPatchesAreCutAtALineBoundaryAndMarkedTruncated()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            await Linked(factory, workspaceId);
            var patch = new string('x', 3850) + "\n" + new string('y', 200);
            Fake(factory).CommitResult = new GitHubCommit(
                [new GitHubFile("src/large.ts", null, "modified", 4, 2, patch)], DateTime.UtcNow, null, null);

            var response = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { CommitUrl() } });
            var text = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, text);
            var file = Assert.Single(Assert.Single(JsonNode.Parse(text)!.AsArray())!["files"]!.AsArray())!;
            Assert.Equal(new string('x', 3850) + "\n", file["patch"]!.GetValue<string>());
            Assert.True(file["patchTruncated"]!.GetValue<bool>());

            await using var scope = factory.Services.CreateAsyncScope();
            var snapshot = Assert.Single(scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubCommitSnapshots);
            var stored = Assert.Single(JsonNode.Parse(snapshot.FilesJson)!.AsArray())!;
            Assert.Equal(3851, stored["patch"]!.GetValue<string>().Length);
            Assert.True(stored["patchTruncated"]!.GetValue<bool>());
        }
    }

    [Fact]
    public async Task AStaleCommitSnapshotIsRefetchedAndUpdatedInPlace()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            await Linked(factory, workspaceId);
            await StoreSnapshot(factory, "[{\"path\":\"old.ts\",\"status\":\"modified\",\"additions\":1,\"deletions\":1}]");

            var first = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { CommitUrl() } });
            var text = await first.Content.ReadAsStringAsync();
            Assert.True(first.IsSuccessStatusCode, text);
            var row = Assert.Single(JsonNode.Parse(text)!.AsArray())!;
            Assert.Equal("src/a.ts", Assert.Single(row["files"]!.AsArray())!["path"]!.GetValue<string>());
            Assert.Equal(1, Fake(factory).CommitCalls);

            var second = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { CommitUrl() } });
            Assert.True(second.IsSuccessStatusCode);
            Assert.Equal(1, Fake(factory).CommitCalls);
            await using var scope = factory.Services.CreateAsyncScope();
            var snapshots = scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubCommitSnapshots;
            var snapshot = Assert.Single(snapshots);
            Assert.Equal(12, snapshot.Additions);
            Assert.Equal("@@ -1 +1 @@\n-old\n+new", JsonNode.Parse(snapshot.FilesJson)![0]!["patch"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task AFailedStaleSnapshotRefreshStillServesTheOldFiles()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            await Linked(factory, workspaceId);
            await StoreSnapshot(factory, "[{\"path\":\"old.ts\",\"status\":\"modified\",\"additions\":1,\"deletions\":1}]");
            Fake(factory).CommitResult = new GitHubCommit(null, null, "network", null);

            var response = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { CommitUrl() } });
            var text = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, text);
            var row = Assert.Single(JsonNode.Parse(text)!.AsArray())!;
            Assert.Null(row["error"]);
            Assert.Equal("old.ts", Assert.Single(row["files"]!.AsArray())!["path"]!.GetValue<string>());
            Assert.Equal(1, Fake(factory).CommitCalls);
        }
    }

    [Fact]
    public async Task CommitsInAnUnreadableRepositoryAreUnauthorized()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            await Linked(factory, workspaceId);
            Fake(factory).Unreadable.Add("octo-org/api");
            var response = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { CommitUrl() } });
            var row = Assert.Single(JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsArray())!;
            Assert.Equal("unauthorized", row["error"]!["kind"]!.GetValue<string>());
            Assert.Equal(0, Fake(factory).CommitCalls);
        }
    }

    [Fact]
    public async Task FoldersListDirectoriesAndRefuseAMissingPath()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            var folders = JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{workspaceId}/repositories/octo-org/api/folders"))!.AsArray();
            Assert.Equal("src", Assert.Single(folders)!["name"]!.GetValue<string>());
            Fake(factory).FolderList = null;
            var missing = await client.GetAsync($"/api/github/workspaces/{workspaceId}/repositories/octo-org/api/folders?path=nowhere");
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
            Assert.Contains("Folder not found.", await missing.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ASecondWorkspaceAdoptsTheInstallationThatAlreadyReadsItsRepository()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var connected = await ProjectFlowTests.CreateWorkspace(client, "Connected");
            var second = await ProjectFlowTests.CreateWorkspace(client, "Second");
            await Connect(factory, connected, ownerId);
            await Project(factory, second, "https://gitlab.com/octo-org/api");
            await Project(factory, second, "https://github.com/octo-org/api.git");
            await Linked(factory, second);

            var status = JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{second}"))!;
            Assert.True(status["connected"]!.GetValue<bool>());
            Assert.Equal(FakeGitHubAppClient.DefaultInstallation, status["installationId"]!.GetValue<long>());
            Assert.Equal(ownerId, status["connectedBy"]!["id"]!.GetValue<Guid>());

            var commits = await client.PostAsJsonAsync($"/api/github/workspaces/{second}/commits", new { urls = new[] { CommitUrl() } });
            var text = await commits.Content.ReadAsStringAsync();
            Assert.True(commits.IsSuccessStatusCode, text);
            var row = Assert.Single(JsonNode.Parse(text)!.AsArray())!;
            Assert.Null(row["error"]);
            Assert.Equal(12, row["additions"]!.GetValue<int>());

            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var bound = await db.GitHubInstallations.SingleAsync(x => x.WorkspaceId == second);
            Assert.Equal(FakeGitHubAppClient.DefaultInstallation, bound.InstallationId);
            Assert.Equal("octo-org", bound.AccountLogin);
            Assert.Equal(ownerId, bound.ConnectedBy);
        }
    }

    [Fact]
    public async Task AWorkspaceNoInstallationCanReadStaysDisconnectedAndIsNotCheckedAgain()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var connected = await ProjectFlowTests.CreateWorkspace(client, "Connected");
            var second = await ProjectFlowTests.CreateWorkspace(client, "Second");
            await Connect(factory, connected, ownerId);
            await Project(factory, second, "https://github.com/octo-org/web");
            Fake(factory).Unreadable.Add("octo-org/web");
            Fake(factory).Unreadable.Add("example/app");

            Assert.False(JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{second}"))!["connected"]!.GetValue<bool>());
            var checks = Fake(factory).ReadableCalls;
            Assert.Equal(4, checks);

            Assert.False(JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{second}"))!["connected"]!.GetValue<bool>());
            var commits = await client.PostAsJsonAsync($"/api/github/workspaces/{second}/commits", new { urls = new[] { CommitUrl() } });
            var row = Assert.Single(JsonNode.Parse(await commits.Content.ReadAsStringAsync())!.AsArray())!;
            Assert.Equal("not-connected", row["error"]!["kind"]!.GetValue<string>());
            Assert.Equal(checks, Fake(factory).ReadableCalls);

            await using var scope = factory.Services.CreateAsyncScope();
            Assert.Single(scope.ServiceProvider.GetRequiredService<AppDbContext>().GitHubInstallations);
        }
    }

    [Fact]
    public async Task ACollaboratorReadsTheBoardsCommitsAndNothingElseTheInstallationCanSee()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (owner, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(owner, "Shared");
            await Connect(factory, workspaceId, ownerId);
            await Project(factory, workspaceId, "https://github.com/octo-org/api");
            await Linked(factory, workspaceId);
            await Invite(factory, workspaceId, guestId);

            var elsewhere = CommitUrl("89abcdef0123456789abcdef0123456789abcdef");
            var response = await guest.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits",
                new { urls = new[] { CommitUrl(), elsewhere } });
            var text = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, text);
            var rows = JsonNode.Parse(text)!.AsArray();
            Assert.Null(rows[0]!["error"]);
            Assert.Equal("@@ -1 +1 @@\n-old\n+new", rows[0]!["files"]![0]!["patch"]!.GetValue<string>());
            Assert.Equal(elsewhere, rows[1]!["url"]!.GetValue<string>());
            Assert.Equal("unauthorized", rows[1]!["error"]!["kind"]!.GetValue<string>());
            Assert.Null(rows[1]!["files"]);
            Assert.Equal(1, Fake(factory).CommitCalls);
        }
    }

    [Fact]
    public async Task OnlyTheOwnersOwnRequestsAdoptAnInstallation()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (owner, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var connected = await ProjectFlowTests.CreateWorkspace(owner, "Connected");
            var second = await ProjectFlowTests.CreateWorkspace(owner, "Second");
            await Connect(factory, connected, ownerId);
            await Project(factory, second, "https://github.com/octo-org/api");
            await Linked(factory, second);
            await Invite(factory, second, guestId);

            var status = JsonNode.Parse(await guest.GetStringAsync($"/api/github/workspaces/{second}"))!;
            Assert.Equal("collaborator", status["role"]!.GetValue<string>());
            Assert.False(status["connected"]!.GetValue<bool>());
            var commits = await guest.PostAsJsonAsync($"/api/github/workspaces/{second}/commits", new { urls = new[] { CommitUrl() } });
            Assert.Equal("not-connected", Assert.Single(JsonNode.Parse(await commits.Content.ReadAsStringAsync())!.AsArray())!["error"]!["kind"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.Conflict,
                (await guest.GetAsync($"/api/github/workspaces/{second}/repositories/octo-org/api/folders")).StatusCode);
            Assert.Null(await Stored(factory, second));
            Assert.Equal(0, Fake(factory).ReadableCalls);

            Assert.True(JsonNode.Parse(await owner.GetStringAsync($"/api/github/workspaces/{second}"))!["connected"]!.GetValue<bool>());
            Assert.Equal(ownerId, (await Stored(factory, second))!.ConnectedBy);
            var shared = JsonNode.Parse(await guest.GetStringAsync($"/api/github/workspaces/{second}"))!;
            Assert.True(shared["connected"]!.GetValue<bool>());
            Assert.Equal(ownerId, shared["connectedBy"]!["id"]!.GetValue<Guid>());
        }
    }

    private static async Task<JsonObject> Document(HttpClient client, Guid workspaceId)
    {
        var row = Assert.Single((await ProjectFlowTests.Query(client, new { table = "workspaces", filters = ProjectFlowTests.IdFilter(workspaceId) }))["data"]!.AsArray())!;
        var data = row["data"]!.AsObject().DeepClone().AsObject();
        data["__revision"] = row["revision"]!.GetValue<long>();
        return data;
    }

    private static Task<HttpResponseMessage> Save(HttpClient client, Guid workspaceId, JsonObject document)
    {
        var data = document.DeepClone().AsObject();
        var revision = data["__revision"]!.GetValue<long>();
        data.Remove("__revision");
        return client.PostAsJsonAsync("/api/query", new
        {
            table = "workspaces", operation = "update", columns = "revision", single = "optional",
            filters = new object[] { new { field = "id", op = "eq", value = workspaceId.ToString() }, new { field = "revision", op = "eq", value = revision } },
            values = new { data }
        });
    }

    private static async Task<Guid> SharedWorkspace(ApiFactory factory, HttpClient owner, Guid ownerId, Guid guestId)
    {
        var workspaceId = await ProjectFlowTests.CreateWorkspace(owner, "Shared");
        var document = await Document(owner, workspaceId);
        document["map"]!["repositoryUrl"] = "";
        document["map"]!["repositoryLayout"] = "multirepo";
        document["projects"]![0]!["repositoryUrl"] = "https://github.com/octo-org/api";
        var saved = await Save(owner, workspaceId, document);
        Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());
        await Connect(factory, workspaceId, ownerId);
        await Invite(factory, workspaceId, guestId);
        Fake(factory).RepositoryList = [new("octo-org/api", true, "main"), new("octo-org/secret", true, "main")];
        return workspaceId;
    }

    [Fact]
    public async Task ACollaboratorAndTokensSeeOnlyTheWorkspaceRepositoriesAndNoInstallationDetails()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (owner, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var workspaceId = await SharedWorkspace(factory, owner, ownerId, guestId);

            var full = JsonNode.Parse(await owner.GetStringAsync($"/api/github/workspaces/{workspaceId}"))!;
            Assert.Equal(["octo-org/api", "octo-org/secret"], full["repositories"]!.AsArray().Select(x => x!["fullName"]!.GetValue<string>()));
            Assert.NotNull(full["installationId"]);
            Assert.NotNull(full["manageUrl"]);

            using var mcp = await McpClient(factory, ownerId);
            foreach (var client in new[] { guest, mcp })
            {
                var text = await client.GetStringAsync($"/api/github/workspaces/{workspaceId}");
                var status = JsonNode.Parse(text)!;
                Assert.True(status["connected"]!.GetValue<bool>());
                Assert.Equal("octo-org/api", Assert.Single(status["repositories"]!.AsArray())!["fullName"]!.GetValue<string>());
                Assert.Null(status["installationId"]);
                Assert.Null(status["manageUrl"]);
                Assert.Null(status["repositorySelection"]);
                Assert.DoesNotContain("secret", text, StringComparison.Ordinal);
            }
        }
    }

    [Fact]
    public async Task ACollaboratorCannotReadFoldersOrCommitsOfARepositoryTheOwnerDidNotChoose()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (owner, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var workspaceId = await SharedWorkspace(factory, owner, ownerId, guestId);

            var denied = await guest.GetAsync($"/api/github/workspaces/{workspaceId}/repositories/octo-org/secret/folders");
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
            Assert.Contains("This repository is not part of the workspace.", await denied.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            Assert.True((await guest.GetAsync($"/api/github/workspaces/{workspaceId}/repositories/OCTO-ORG/api/folders")).IsSuccessStatusCode);
            Assert.True((await owner.GetAsync($"/api/github/workspaces/{workspaceId}/repositories/octo-org/secret/folders")).IsSuccessStatusCode);

            // A collaborator can put any commit URL on a task; that alone must not open the repository.
            var secret = $"https://github.com/octo-org/secret/commit/{Sha}";
            await Linked(factory, workspaceId, secret, CommitUrl());
            var response = await guest.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { secret, CommitUrl() } });
            var rows = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsArray();
            Assert.Equal("unauthorized", rows[0]!["error"]!["kind"]!.GetValue<string>());
            Assert.Null(rows[0]!["files"]);
            Assert.Null(rows[1]!["error"]);
            Assert.Equal(1, Fake(factory).CommitCalls);

            var mine = await owner.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls = new[] { secret } });
            Assert.Null(Assert.Single(JsonNode.Parse(await mine.Content.ReadAsStringAsync())!.AsArray())!["error"]);
        }
    }

    [Fact]
    public async Task OnlyTheOwnerChangesWhichRepositoriesAndFoldersAWorkspaceUses()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (owner, ownerId) = await ProjectFlowTests.SignIn(factory);
        var (guest, guestId) = await ProjectFlowTests.SignIn(factory);
        using (owner) using (guest)
        {
            var workspaceId = await SharedWorkspace(factory, owner, ownerId, guestId);
            var edits = new Action<JsonObject>[]
            {
                doc => doc["map"]!["repositoryUrl"] = "https://github.com/octo-org/secret",
                doc => doc["map"]!["repositoryLayout"] = "monorepo",
                doc => doc["projects"]![0]!["repositoryUrl"] = "https://github.com/octo-org/secret",
                doc => doc["projects"]![0]!["paths"] = new JsonArray("src"),
                doc => doc["projects"]!.AsArray().Add(new JsonObject { ["id"] = "new", ["name"] = "New", ["repositoryUrl"] = "https://github.com/octo-org/secret" }),
                doc => doc["projects"]!.AsArray().Add(new JsonObject { ["id"] = "new", ["name"] = "New", ["repositoryUrl"] = "", ["paths"] = new JsonArray("src") }),
            };
            foreach (var edit in edits)
            {
                var document = await Document(guest, workspaceId);
                edit(document);
                var refused = await Save(guest, workspaceId, document);
                Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
                Assert.Contains("Only the workspace owner can change which GitHub repositories", await refused.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            }

            // Everything else stays open to collaborators, including a new project on a repository the owner chose.
            var allowed = await Document(guest, workspaceId);
            allowed["tasks"]![0]!["name"] = "Renamed by a collaborator";
            allowed["projects"]![0]!["repositoryUrl"] = "https://github.com/Octo-Org/api.git";
            allowed["projects"]!.AsArray().Add(new JsonObject { ["id"] = "web", ["name"] = "Web", ["repositoryUrl"] = "https://github.com/octo-org/api" });
            var saved = await Save(guest, workspaceId, allowed);
            Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());

            var ownerEdit = await Document(owner, workspaceId);
            ownerEdit["projects"]![0]!["repositoryUrl"] = "https://github.com/octo-org/secret";
            ownerEdit["projects"]![0]!["paths"] = new JsonArray("src");
            var byOwner = await Save(owner, workspaceId, ownerEdit);
            Assert.True(byOwner.IsSuccessStatusCode, await byOwner.Content.ReadAsStringAsync());
            Assert.True((await guest.GetAsync($"/api/github/workspaces/{workspaceId}/repositories/octo-org/secret/folders")).IsSuccessStatusCode);
        }
    }

    [Fact]
    public async Task AnUnreadableRepositoryIsAskedAgainWithAFreshToken()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            Fake(factory).UnreadableOnce.Add("octo-org/api");
            var folders = await client.GetAsync($"/api/github/workspaces/{workspaceId}/repositories/octo-org/api/folders");
            var text = await folders.Content.ReadAsStringAsync();
            Assert.True(folders.IsSuccessStatusCode, text);
            Assert.Equal("src", Assert.Single(JsonNode.Parse(text)!.AsArray())!["name"]!.GetValue<string>());
            Assert.Equal(1, Fake(factory).ForgetCalls);
            Assert.Equal(2, Fake(factory).ReadableCalls);
        }
    }

    [Fact]
    public async Task MoreThanAHundredCommitUrlsAreRejected()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            var urls = Enumerable.Range(0, 101).Select(index => CommitUrl(index.ToString("x40", System.Globalization.CultureInfo.InvariantCulture))).ToArray();
            var response = await client.PostAsJsonAsync($"/api/github/workspaces/{workspaceId}/commits", new { urls });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(0, Fake(factory).CommitCalls);
        }
    }

    [Fact]
    public async Task DisconnectingAnAdoptedWorkspaceSurvivesTheNextStatusPolls()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var connected = await ProjectFlowTests.CreateWorkspace(client, "Connected");
            var second = await ProjectFlowTests.CreateWorkspace(client, "Second");
            await Connect(factory, connected, ownerId);
            await Project(factory, second, "https://github.com/octo-org/api");
            Assert.True(JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{second}"))!["connected"]!.GetValue<bool>());

            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/github/workspaces/{second}")).StatusCode);
            var declined = (await Stored(factory, second))!;
            Assert.NotNull(declined.DeclinedAt);
            Assert.Equal(0, declined.InstallationId);
            Assert.Equal("", declined.AccountLogin);
            Assert.Equal("", declined.AccountType);
            Assert.Equal("", declined.RepositorySelection);

            var calls = Fake(factory).InstallationCalls;
            for (var poll = 0; poll < 2; poll++)
            {
                ForgetAdoption(factory, second);
                Assert.False(JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{second}"))!["connected"]!.GetValue<bool>());
            }
            Assert.Equal(calls, Fake(factory).InstallationCalls);
            Assert.NotNull((await Stored(factory, second))!.DeclinedAt);

            var ticket = ChooseTicket(factory, second, ownerId, TimeSpan.FromMinutes(10), FakeGitHubAppClient.DefaultInstallation);
            var reconnect = await client.PostAsJsonAsync($"/api/github/workspaces/{second}/installations",
                new { ticket, installationId = FakeGitHubAppClient.DefaultInstallation });
            var text = await reconnect.Content.ReadAsStringAsync();
            Assert.True(reconnect.IsSuccessStatusCode, text);
            Assert.True(JsonNode.Parse(text)!["connected"]!.GetValue<bool>());
            var bound = (await Stored(factory, second))!;
            Assert.Null(bound.DeclinedAt);
            Assert.Equal(FakeGitHubAppClient.DefaultInstallation, bound.InstallationId);
            Assert.Equal("octo-org", bound.AccountLogin);
        }
    }

    [Fact]
    public async Task DisconnectingAWorkspaceThatWasNeverBoundRecordsTheRefusal()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var connected = await ProjectFlowTests.CreateWorkspace(client, "Connected");
            var second = await ProjectFlowTests.CreateWorkspace(client, "Second");
            await Connect(factory, connected, ownerId);
            await Project(factory, second, "https://github.com/octo-org/api");

            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/github/workspaces/{second}")).StatusCode);
            var calls = Fake(factory).InstallationCalls;
            ForgetAdoption(factory, second);
            Assert.False(JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{second}"))!["connected"]!.GetValue<bool>());
            Assert.Equal(calls, Fake(factory).InstallationCalls);
            var declined = (await Stored(factory, second))!;
            Assert.NotNull(declined.DeclinedAt);
            Assert.Equal(0, declined.InstallationId);
            Assert.Equal(ownerId, declined.ConnectedBy);

            var commits = await client.PostAsJsonAsync($"/api/github/workspaces/{second}/commits", new { urls = new[] { CommitUrl() } });
            var row = Assert.Single(JsonNode.Parse(await commits.Content.ReadAsStringAsync())!.AsArray())!;
            Assert.Equal("not-connected", row["error"]!["kind"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task ADeclinedWorkspaceIsNotOfferedAsConnectedElsewhere()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var taken = await ProjectFlowTests.CreateWorkspace(client, "Taken");
            var fresh = await ProjectFlowTests.CreateWorkspace(client, "Fresh");
            await Connect(factory, taken, ownerId);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/github/workspaces/{taken}")).StatusCode);

            var ticket = ChooseTicket(factory, fresh, ownerId, TimeSpan.FromMinutes(10), FakeGitHubAppClient.DefaultInstallation);
            var rows = JsonNode.Parse(await client.GetStringAsync(
                $"/api/github/workspaces/{fresh}/installation-choices?ticket={Uri.EscapeDataString(ticket)}"))!["installations"]!.AsArray();
            Assert.False(Assert.Single(rows)!["connectedElsewhere"]!.GetValue<bool>());
        }
    }

    [Fact]
    public async Task AnInstallationRemovedOnGitHubLeavesTheWorkspaceDeclinedInsteadOfAdoptable()
    {
        await using var factory = new ApiFactory(githubApp: true);
        await factory.InitializeDatabaseAsync();
        var (client, ownerId) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var workspaceId = await ProjectFlowTests.CreateWorkspace(client);
            await Connect(factory, workspaceId, ownerId);
            await Project(factory, workspaceId, "https://github.com/octo-org/api");
            Fake(factory).Account = null;

            Assert.False(JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{workspaceId}"))!["connected"]!.GetValue<bool>());
            var declined = (await Stored(factory, workspaceId))!;
            Assert.NotNull(declined.DeclinedAt);
            Assert.Equal(0, declined.InstallationId);

            var calls = Fake(factory).InstallationCalls;
            ForgetAdoption(factory, workspaceId);
            Assert.False(JsonNode.Parse(await client.GetStringAsync($"/api/github/workspaces/{workspaceId}"))!["connected"]!.GetValue<bool>());
            Assert.Equal(calls, Fake(factory).InstallationCalls);
        }
    }
}
