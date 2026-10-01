using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;
using Microsoft.AspNetCore.TestHost;
using Npgsql;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Wireal.Api.GitHub;

namespace Wireal.Api.Tests;

/// <param name="connectionAddress">When set, every request arrives on a connection from this address and the
/// loopback proxy is trusted, as where a reverse proxy on the same machine fronts Kestrel.</param>
/// <param name="selfHosted">Configures no Turnstile, email provider or GitHub sign-in, as a Docker Compose install may,
/// and keeps the services the API picks for that instead of the test doubles.</param>
public sealed class ApiFactory(bool authenticated = false, string? additionalClientOrigin = null, string? connectionAddress = null, bool githubApp = false,
    bool selfHosted = false) : WebApplicationFactory<Program>
{
    /// <summary>A throwaway database per factory on the PostgreSQL server named by <c>WIREAL_TEST_POSTGRES</c>,
    /// created by the real migrations in <see cref="InitializeDatabaseAsync"/> and dropped on dispose.</summary>
    private readonly string connection = TestDatabase.Connection("wireal_test_" + Guid.NewGuid().ToString("N"));
    private bool created;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureTestServices(services =>
        {
            if (connectionAddress is not null) services.AddTransient<IStartupFilter>(_ => new ConnectionAddressFilter(IPAddress.Parse(connectionAddress)));
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<AppDbContext>>();
            services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connection));
            if (!selfHosted)
            {
                services.RemoveAll<ITurnstileVerifier>();
                services.AddSingleton<ITurnstileVerifier, TestTurnstileVerifier>();
                services.RemoveAll<IVerificationEmailSender>();
                services.AddSingleton<IVerificationEmailSender, TestEmailSender>();
            }
            services.RemoveAll<IGitHubAppClient>();
            services.AddSingleton<IGitHubAppClient, FakeGitHubAppClient>();
            if (githubApp)
            {
                services.RemoveAll<GitHubAppSettings>();
                services.AddSingleton(GitHubTestKey.Settings());
            }
            var worker = services.Single(x => x.ServiceType == typeof(IHostedService) && x.ImplementationType == typeof(EmailOutboxWorker));
            services.Remove(worker);
        });
        if (authenticated) builder.ConfigureServices(services => services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = "Test";
        }).AddScheme<AuthenticationSchemeOptions, TestAuthenticationHandler>("Test", _ => { }));
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        if (connectionAddress is not null)
            builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Security:KnownProxies:0"] = "127.0.0.1"
            }));
        if (additionalClientOrigin is not null)
            builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["App:AdditionalClientOrigins:0"] = additionalClientOrigin
            }));
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Postgres"] = connection,
            ["App:ClientOrigin"] = "https://localhost:5173",
            ["App:PublicApiOrigin"] = "https://localhost:7080",
            // A self-hosted factory leaves it unset, so the API derives it from App:ClientOrigin.
            ["App:McpResource"] = selfHosted ? null : "https://mcp.example.test",
            ["Authentication:Jwt:SigningKey"] = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)),
            ["Authentication:AllowedEmails:0"] = "invited@example.com"
        };
        if (!selfHosted)
            foreach (var (key, value) in new Dictionary<string, string?>
            {
                ["GitHub:App:ClientId"] = "test-client",
                ["GitHub:App:ClientSecret"] = "test-secret",
                ["Cloudflare:Turnstile:SiteKey"] = "test-site",
                ["Cloudflare:Turnstile:SecretKey"] = "test-secret",
                ["Cloudflare:Turnstile:Hostnames:0"] = "localhost",
                ["Cloudflare:Email:AccountId"] = new string('a', 32),
                ["Cloudflare:Email:ApiToken"] = "test-token",
                ["Cloudflare:Email:FromAddress"] = "accounts@example.com"
            }) settings[key] = value;
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(settings));
        return base.CreateHost(builder);
    }

    public HttpClient Client() => CreateClient(new WebApplicationFactoryClientOptions
    {
        BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false
    });

    public async Task InitializeDatabaseAsync()
    {
        using var scope = Services.CreateScope();
        created = true;
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (created) await TestDatabase.DropAsync(connection);
        GC.SuppressFinalize(this);
    }

    public void PrepareGitHub(HttpClient client)
    {
        var token = Services.GetRequiredService<OAuthGate>().Issue();
        client.DefaultRequestHeaders.Remove("Cookie");
        client.DefaultRequestHeaders.Add("Cookie", "__Host-wireal-github-gate=" + token);
    }
}

public static class TestDatabase
{
    /// <summary>The server the tests run against. CI and a local run set <c>WIREAL_TEST_POSTGRES</c>; the default
    /// is a PostgreSQL on this machine with the stock superuser.</summary>
    public static string Server => Environment.GetEnvironmentVariable("WIREAL_TEST_POSTGRES") is { Length: > 0 } value
        ? value : "Host=localhost;Username=postgres;Password=postgres";

    public static string Connection(string database) =>
        new NpgsqlConnectionStringBuilder(Server) { Database = database, IncludeErrorDetail = true }.ConnectionString;

    public static async Task DropAsync(string connection)
    {
        var database = new NpgsqlConnectionStringBuilder(connection).Database!;
        NpgsqlConnection.ClearAllPools();
        await using var admin = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(Server) { Database = "postgres", Pooling = false }.ConnectionString);
        await admin.OpenAsync();
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)", admin);
        await drop.ExecuteNonQueryAsync();
    }
}

/// <summary>Runs first in the pipeline, before forwarded headers, so the API sees a real connection address.</summary>
public sealed class ConnectionAddressFilter(IPAddress address) : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use((context, pipeline) => { context.Connection.RemoteIpAddress = address; return pipeline(context); });
        next(app);
    };
}

public sealed class TestTurnstileVerifier : ITurnstileVerifier
{
    public Task<bool> VerifyAsync(string? token, string action, string? remoteIp, CancellationToken cancellationToken) => Task.FromResult(token == "valid");
}

public sealed class TestEmailSender : IVerificationEmailSender
{
    public List<(string Recipient, string Url)> Messages { get; } = [];
    public Task SendAsync(string recipient, string verificationUrl, CancellationToken cancellationToken)
    {
        Messages.Add((recipient, verificationUrl));
        return Task.CompletedTask;
    }
}

// Only registered by the test host; no test authentication exists in the API.
public sealed class TestAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync() => Task.FromResult(
        AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "00000000-0000-0000-0000-000000000001")], "Test")), "Test")));
}

public sealed class SecurityTests
{
    [Fact]
    public async Task AuthenticatedMutationWithoutCsrfIsRejected()
    {
        await using var factory = new ApiFactory(authenticated: true);
        using var client = factory.Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/auth/logout", null)).StatusCode);
    }

    [Fact]
    public async Task AuthenticatedMutationWithMatchingCsrfSucceeds()
    {
        await using var factory = new ApiFactory(authenticated: true);
        using var client = factory.Client();
        var csrf = await client.GetAsync("/auth/csrf");
        Assert.Equal(HttpStatusCode.OK, csrf.StatusCode);
        using var body = JsonDocument.Parse(await csrf.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", body.RootElement.GetProperty("token").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/auth/logout", null)).StatusCode);
    }

    [Theory]
    [InlineData("/auth/me")]
    [InlineData("/health/ready")]
    public async Task PrivateEndpointsRejectAnonymousRequests(string path)
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(path)).StatusCode);
    }

    [Fact]
    public async Task AnonymousLogoutStillRequiresCsrf()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/auth/logout", null)).StatusCode);
    }

    [Fact]
    public async Task LivenessHasSecurityHeadersAndDoesNotRequireDatabase()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        var response = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Contains("frame-ancestors 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
        Assert.True(response.Headers.CacheControl!.NoStore);
    }

    [Fact]
    public async Task OAuthChallengeUsesPkceStateAndSecureCorrelationCookie()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        factory.PrepareGitHub(client);
        var response = await client.GetAsync("/auth/github?returnUrl=https://evil.example");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var location = response.Headers.Location!;
        Assert.Equal("github.com", location.Host);
        Assert.Contains("code_challenge_method=S256", location.Query);
        Assert.Contains("state=", location.Query);
        Assert.DoesNotContain("evil.example", location.Query);
        var cookie = response.Headers.GetValues("Set-Cookie").Single(x => x.Contains(".AspNetCore.Correlation"));
        Assert.Contains("secure", cookie);
        Assert.Contains("httponly", cookie);
    }

    [Fact]
    public async Task ForgedForwardedHeadersCannotChangeOAuthCallback()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        factory.PrepareGitHub(client);
        client.DefaultRequestHeaders.Add("X-Forwarded-Host", "evil.example");
        client.DefaultRequestHeaders.Add("X-Forwarded-Proto", "http");
        var response = await client.GetAsync("/auth/github");
        Assert.Contains(Uri.EscapeDataString("https://localhost/auth/github/callback"), response.Headers.Location!.Query);
    }

    [Fact]
    public async Task UntrustedOriginDoesNotReceiveCorsPermission()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        client.DefaultRequestHeaders.Add("Origin", "https://evil.example");
        var response = await client.GetAsync("/health/live");
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task LoginLimitRejectsEleventhAttemptWithRetryAfter()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        for (var i = 0; i < 10; i++)
        {
            factory.PrepareGitHub(client);
            Assert.Equal(HttpStatusCode.Redirect, (await client.GetAsync("/auth/github")).StatusCode);
        }
        var response = await client.GetAsync("/auth/github");
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.NotNull(response.Headers.RetryAfter);
    }

    [Fact]
    public async Task CallbackWithoutCorrelationFailsClosed()
    {
        await using var factory = new ApiFactory();
        using var client = factory.Client();
        var response = await client.GetAsync("/auth/github/callback?code=forged&state=forged");
        Assert.Equal("https://localhost:5173/login?error=authentication_failed", response.Headers.Location!.AbsoluteUri);
        Assert.DoesNotContain(response.Headers.TryGetValues("Set-Cookie", out var cookies) ? cookies : [],
            cookie => cookie.StartsWith("__Host-wireal-session="));
    }

    [Fact]
    public async Task ProviderLoginReturnsToPendingMcpConsentOnTheConfiguredOrigin()
    {
        await using var factory = new ApiFactory(); using var client = factory.Client();
        factory.PrepareGitHub(client);
        var id = new string('a', 43);
        var response = await client.GetAsync("/auth/github?authorization_id=" + id + "&returnUrl=https://evil.example");
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(response.Headers.Location!.Query);
        var options = factory.Services.GetRequiredService<IOptionsMonitor<Microsoft.AspNetCore.Authentication.OAuth.OAuthOptions>>().Get("GitHub");
        var properties = options.StateDataFormat.Unprotect(query["state"].ToString());
        Assert.Equal("https://localhost:5173/oauth/consent?authorization_id=" + id + "#oauth", properties!.RedirectUri);
    }
}
