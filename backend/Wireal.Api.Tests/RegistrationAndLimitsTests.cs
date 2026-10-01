using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

public sealed class RegistrationAndLimitsTests
{
    [Theory]
    [InlineData(null, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task WhitelistControlsNewAccountsButKeepsEmailVerification(bool? enabled, bool allowed)
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var config = factory.Services.GetRequiredService<IConfiguration>();
        config["Authentication:WhitelistEnabled"] = enabled?.ToString();
        config["Authentication:GitHub:AllowedUserIds:0"] = "123";
        Assert.Equal(allowed, RegistrationPolicy.AllowsEmail(config, "new@example.com"));
        Assert.Equal(allowed, RegistrationPolicy.AllowsGitHub(config, "456"));
        Assert.True(RegistrationPolicy.AllowsEmail(config, "INVITED@example.com"));
        Assert.True(RegistrationPolicy.AllowsGitHub(config, "123"));
        Assert.False(RegistrationPolicy.AllowsEmail(config, null));

        using var client = factory.Client();
        var response = await AccountFlowTests.PostAsync(client, "/auth/register", new
        {
            email = "new@example.com", password = "a long test passphrase 2026!",
            displayName = "New user", turnstileToken = "valid"
        });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleOrDefaultAsync(x => x.Email == "new@example.com");
        Assert.Equal(allowed, user is not null);
        Assert.Equal(allowed ? 1 : 0, await db.EmailOutbox.CountAsync());
        if (user is not null) Assert.False(user.EmailVerified);
    }

    [Fact]
    public async Task AccountCannotAskForMoreVerificationEmailsThanItsDailyRation()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.Client();
        var settings = factory.Services.GetRequiredService<CloudflareEmailSettings>();
        Assert.Equal(HttpStatusCode.Accepted, (await AccountFlowTests.PostAsync(client, "/auth/register", new
        {
            email = "invited@example.com", password = "a long test passphrase 2026!",
            displayName = "Invited", turnstileToken = "valid"
        })).StatusCode);

        // Registering spends one of the ration; every later request is a resend, and the
        // two-minute spacing is stepped over here so only the daily ration can refuse them.
        for (var attempt = 0; attempt < settings.PerAccountDailyLimit + 1; attempt++)
        {
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                (await db.Users.SingleAsync()).LastVerificationSentAt = DateTime.UtcNow.AddMinutes(-3);
                await db.SaveChangesAsync();
            }
            Assert.Equal(HttpStatusCode.Accepted, (await AccountFlowTests.PostAsync(client, "/auth/verification/resend",
                new { email = "invited@example.com", turnstileToken = "valid" })).StatusCode);
        }

        using var counting = factory.Services.CreateScope();
        // Refusing looks exactly like succeeding from outside, so the outbox is the assertion.
        Assert.Equal(settings.PerAccountDailyLimit,
            await counting.ServiceProvider.GetRequiredService<AppDbContext>().EmailOutbox.CountAsync());
    }

    [Fact]
    public async Task SpentDailyBudgetHoldsMessagesInsteadOfSpendingAttempts()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.Client();
        Assert.Equal(HttpStatusCode.Accepted, (await AccountFlowTests.PostAsync(client, "/auth/register", new
        {
            email = "invited@example.com", password = "a long test passphrase 2026!",
            displayName = "Invited", turnstileToken = "valid"
        })).StatusCode);
        var settings = factory.Services.GetRequiredService<CloudflareEmailSettings>();
        var budget = settings.DailyBudget;
        settings.DailyBudget = 0;
        try
        {
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<EmailOutboxProcessor>().ProcessBatchAsync(default);
            Assert.Empty(((TestEmailSender)factory.Services.GetRequiredService<IVerificationEmailSender>()).Messages);
            var message = await scope.ServiceProvider.GetRequiredService<AppDbContext>().EmailOutbox.SingleAsync();
            Assert.Equal(0, message.Attempts);
            Assert.Null(message.SentAt);
            Assert.True(message.NextAttemptAt >= DateTime.UtcNow.Date.AddDays(1));
        }
        finally { settings.DailyBudget = budget; }
    }

    [Fact]
    public async Task WorkspaceLimitIsPerOwnerAndDeletionFreesCapacity()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (client, owner) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                for (var i = 0; i < 19; i++) db.Workspaces.Add(new WorkspaceDocument
                {
                    UserId = owner, IsActive = i == 0, Data = ProjectFlowTests.Workspace().ToJsonString()
                });
                await db.SaveChangesAsync();
            }
            var last = await ProjectFlowTests.CreateWorkspace(client);
            var denied = await client.PostAsJsonAsync("/api/query", new
            {
                table = "workspaces", operation = "insert", values = new { data = ProjectFlowTests.Workspace() }
            });
            Assert.Equal(HttpStatusCode.Conflict, denied.StatusCode);
            Assert.Contains("20 workspaces", await denied.Content.ReadAsStringAsync());
            Assert.Equal(20, (await ProjectFlowTests.Query(client, new { table = "workspaces" }))["data"]!.AsArray().Count);

            var (other, _) = await ProjectFlowTests.SignIn(factory);
            using (other) await ProjectFlowTests.CreateWorkspace(other);
            await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "delete", filters = ProjectFlowTests.IdFilter(last) });
            await ProjectFlowTests.CreateWorkspace(client);
        }
    }

    [Fact]
    public async Task ProjectLimitCoversInsertsAndUpdatesAndPreservesExistingOverLimitData()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeDatabaseAsync();
        var (client, owner) = await ProjectFlowTests.SignIn(factory);
        using (client)
        {
            var data = ProjectFlowTests.Workspace();
            for (var i = 2; i <= 20; i++) data["projects"]!.AsArray().Add(new JsonObject { ["id"] = "p" + i, ["name"] = "Project " + i });
            var id = Guid.NewGuid();
            await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "insert", values = new { id, data } });
            data["projects"]!.AsArray().Add(new JsonObject { ["id"] = "p21", ["name"] = "Project 21" });
            var insert = await client.PostAsJsonAsync("/api/query", new { table = "workspaces", operation = "insert", values = new { data } });
            Assert.Equal(HttpStatusCode.Conflict, insert.StatusCode);
            Assert.Contains("20 projects", await insert.Content.ReadAsStringAsync());
            var filters = new object[] { new { field = "id", op = "eq", value = id.ToString() }, new { field = "revision", op = "eq", value = 1 } };
            var update = await client.PostAsJsonAsync("/api/query", new { table = "workspaces", operation = "update", filters, values = new { data } });
            Assert.Equal(HttpStatusCode.Conflict, update.StatusCode);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var saved = await db.Workspaces.SingleAsync(x => x.UserId == owner && x.Id == id);
                Assert.Equal(20, JsonNode.Parse(saved.Data)!["projects"]!.AsArray().Count);
                // Simulate a workspace created before quotas existed.
                saved.Data = data.ToJsonString();
                await db.SaveChangesAsync();
            }
            data["map"]!["name"] = "Edited legacy workspace";
            await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "update", filters, values = new { data } });
            filters[1] = new { field = "revision", op = "eq", value = 2 };
            data["projects"]![20]!["id"] = "replacement";
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/query", new
            {
                table = "workspaces", operation = "update", filters, values = new { data }
            })).StatusCode);
            data["projects"]!.AsArray().RemoveAt(20);
            await ProjectFlowTests.Query(client, new { table = "workspaces", operation = "update", filters, values = new { data } });
        }
    }
}
