using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Xunit;

namespace Wireal.Api.Tests;

/// <summary>A Docker Compose install may leave Turnstile, the email provider and GitHub sign-in unconfigured.</summary>
public sealed class SelfHostTests
{
    [Fact]
    public async Task OptionalIntegrationsTurnOffInsteadOfRefusingToStart()
    {
        await using var factory = new ApiFactory(selfHosted: true);
        await factory.InitializeDatabaseAsync();
        Assert.IsType<DisabledTurnstileVerifier>(factory.Services.GetRequiredService<ITurnstileVerifier>());
        Assert.IsType<LogVerificationEmailSender>(factory.Services.GetRequiredService<IVerificationEmailSender>());
        using var client = factory.Client();

        var config = await client.GetFromJsonAsync<JsonObject>("/auth/config");
        Assert.Equal("", config!["turnstileSiteKey"]!.GetValue<string>());

        // No challenge token at all, and registration still queues the verification email.
        Assert.Equal(HttpStatusCode.Accepted, (await AccountFlowTests.PostAsync(client, "/auth/register",
            new { email = "invited@example.com", password = "a long test passphrase 2026!", displayName = "Invited" })).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<EmailOutboxProcessor>().ProcessBatchAsync(default);
            var message = await scope.ServiceProvider.GetRequiredService<AppDbContext>().EmailOutbox.SingleAsync();
            Assert.NotNull(message.SentAt);
        }

        var github = await AccountFlowTests.PostAsync(client, "/auth/github/prepare", new { });
        Assert.Equal(HttpStatusCode.BadRequest, github.StatusCode);
        Assert.Contains("not configured", await github.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/auth/github")).StatusCode);
    }

    [Fact]
    public async Task McpResourceDefaultsToTheAppHostWithMcpInFront()
    {
        await using var factory = new ApiFactory(selfHosted: true);
        await factory.InitializeDatabaseAsync();
        using var client = factory.Client();
        var clientId = await OAuthFlowTests.Register(client);

        var derived = await client.GetAsync(OAuthFlowTests.Authorize(clientId, resource: "https://mcp.localhost:5173"));
        Assert.Equal(HttpStatusCode.Redirect, derived.StatusCode);
        Assert.Contains("authorization_id=", derived.Headers.Location!.Query);

        var other = await client.GetAsync(OAuthFlowTests.Authorize(clientId, resource: "https://mcp.example.test"));
        Assert.Contains("error=invalid_target", other.Headers.Location!.Query);
    }

    [Theory]
    [InlineData("Host=localhost;Database=wireal;Username=wireal", false, true)]
    [InlineData("Host=127.0.0.1;Port=5432;Database=wireal;Username=wireal", false, true)]
    [InlineData("Host=::1;Database=wireal;Username=wireal", false, true)]
    [InlineData("Host=/var/run/postgresql;Database=wireal;Username=wireal", false, true)]
    [InlineData("Host=db.example.com;Database=wireal;Username=wireal", false, false)]
    [InlineData("Host=db.example.com;Database=wireal;Username=wireal;SSL Mode=Require", false, false)]
    [InlineData("Host=db.example.com;Database=wireal;Username=wireal;SSL Mode=VerifyFull", false, true)]
    [InlineData("Host=postgres;Database=wireal;Username=wireal", true, true)]
    public void ProductionDatabaseConnectionsStayLocalOrValidateTls(string connection, bool privateNetwork, bool allowed) =>
        Assert.Equal(allowed, DatabaseConnection.Protected(connection, privateNetwork));
}
