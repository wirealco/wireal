using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Data;
using Wireal.Api.Auth;
using Wireal.Api.GitHub;
using Wireal.Api.Logging;
using Wireal.Api.Projects;
using Serilog;
using Serilog.Events;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSerilog((services, logger) =>
{
    logger.MinimumLevel.Information()
        .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
        .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
        .MinimumLevel.Override("System.Net.Http.HttpClient", LogEventLevel.Warning)
        .Enrich.FromLogContext().Enrich.WithProperty("Application", "Wireal.Api")
        .WriteTo.Console(outputTemplate: LogOutput.Template, formatProvider: System.Globalization.CultureInfo.InvariantCulture);
    var directory = builder.Configuration["Logging:Directory"];
    if (!builder.Environment.IsDevelopment() && (string.IsNullOrWhiteSpace(directory) || !Path.IsPathFullyQualified(directory)))
        throw new InvalidOperationException("Production Logging:Directory must be an absolute, service-writable path.");
    if (!string.IsNullOrWhiteSpace(directory)) logger.WriteTo.File(Path.Combine(directory, "api-.log"),
        outputTemplate: LogOutput.Template, formatProvider: System.Globalization.CultureInfo.InvariantCulture,
        rollingInterval: RollingInterval.Day, fileSizeLimitBytes: 20_000_000, rollOnFileSizeLimit: true,
        retainedFileCountLimit: 14, shared: false);
});
builder.Services.AddWindowsService(options => options.ServiceName = "Wireal.Api");
builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = 2_097_152;
    options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
});

string Required(string key) => !string.IsNullOrWhiteSpace(builder.Configuration[key])
    ? builder.Configuration[key]!
    : throw new InvalidOperationException($"Missing configuration: {key}");

var connection = Required("ConnectionStrings:Postgres");
var clientOrigin = new Uri(Required("App:ClientOrigin"));
var publicOrigin = new Uri(Required("App:PublicApiOrigin"));
if (!publicOrigin.IsAbsoluteUri || publicOrigin.Scheme != "https" || publicOrigin.AbsolutePath != "/" ||
    publicOrigin.Query != "" || publicOrigin.Fragment != "" || publicOrigin.UserInfo != "")
    throw new InvalidOperationException("App:PublicApiOrigin must be the public HTTPS API origin.");
var jwt = builder.Configuration.GetSection("Authentication:Jwt").Get<JwtSettings>() ?? new();
jwt.Validate();
var turnstile = builder.Configuration.GetSection("Cloudflare:Turnstile").Get<TurnstileSettings>() ?? new();
// Optional for a self-hosted server: with neither key set, sign-in and registration run without the challenge.
if (turnstile.Enabled && (string.IsNullOrWhiteSpace(turnstile.SiteKey) || string.IsNullOrWhiteSpace(turnstile.SecretKey) || turnstile.Hostnames.Length == 0))
    throw new InvalidOperationException("Configure Cloudflare Turnstile site key, secret key and allowed hostnames, or leave both keys empty to turn it off.");
if (!builder.Environment.IsDevelopment() && new[] { "1x000000", "2x000000", "3x000000" }.Any(prefix => turnstile.SecretKey.StartsWith(prefix, StringComparison.Ordinal)))
    throw new InvalidOperationException("Cloudflare test keys are forbidden in production.");
var email = builder.Configuration.GetSection("Cloudflare:Email").Get<CloudflareEmailSettings>() ?? new();
if (string.IsNullOrWhiteSpace(email.LogoUrl)) email.LogoUrl = new Uri(clientOrigin, "/logo.png").AbsoluteUri;
// Optional for a self-hosted server: with no provider fields set, verification links go to the API log instead.
if (email.Enabled && (email.AccountId.Length != 32 || !email.AccountId.All(Uri.IsHexDigit) ||
    string.IsNullOrWhiteSpace(email.ApiToken) || EmailAddress.Normalize(email.FromAddress) is null))
    throw new InvalidOperationException("Configure Cloudflare Email account ID, API token and sender address, or leave all three empty to log verification links instead.");
if (email.DailyBudget < 1 || email.PerAccountDailyLimit < 1 || email.PerAccountDailyLimit > email.DailyBudget)
    throw new InvalidOperationException("Email rations must be positive, and one account may not be entitled to the whole day.");
var githubApp = builder.Configuration.GetSection("GitHub:App").Get<GitHubAppSettings>() ?? new();
githubApp.Load();
builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton(turnstile);
builder.Services.AddSingleton(githubApp);
builder.Services.AddSingleton(email);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<TokenService>();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<OAuthGate>();
builder.Services.Configure<PasswordHasherOptions>(options => options.IterationCount = 210_000);
builder.Services.AddSingleton<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
builder.Services.AddSingleton<PasswordWork>();
builder.Services.AddScoped<AccountService>();
builder.Services.AddScoped<ProjectService>();
builder.Services.AddScoped<WorkspaceTeams>();
builder.Services.AddHttpClient<IGitHubInviteIdentity, GitHubInviteIdentity>(http => http.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddScoped<GitHubConnections>();
builder.Services.AddHttpClient<IGitHubAppClient, GitHubAppClient>(http => http.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddScoped<EmailOutboxProcessor>();
builder.Services.AddHostedService<EmailOutboxWorker>();
if (turnstile.Enabled) builder.Services.AddHttpClient<ITurnstileVerifier, TurnstileVerifier>(http => http.Timeout = TimeSpan.FromSeconds(10));
else builder.Services.AddSingleton<ITurnstileVerifier, DisabledTurnstileVerifier>();
if (email.Enabled) builder.Services.AddHttpClient<IVerificationEmailSender, CloudflareEmailSender>(http => http.Timeout = TimeSpan.FromSeconds(20));
else builder.Services.AddSingleton<IVerificationEmailSender, LogVerificationEmailSender>();
if (!clientOrigin.IsAbsoluteUri || clientOrigin.AbsolutePath != "/" || clientOrigin.Query != "" ||
    clientOrigin.Fragment != "" || clientOrigin.UserInfo != "" ||
    (clientOrigin.Scheme != "https" && !(builder.Environment.IsDevelopment() && clientOrigin.IsLoopback)))
    throw new InvalidOperationException("App:ClientOrigin must be an HTTPS origin (loopback HTTP is development only).");
var clientOrigins = new ClientOrigins(clientOrigin,
    builder.Configuration.GetSection("App:AdditionalClientOrigins").Get<string[]>() ?? []);
builder.Services.AddSingleton(clientOrigins);
var allowedHosts = Required("AllowedHosts");
if (!builder.Environment.IsDevelopment() && allowedHosts.Split(';').Any(x => x.Trim() == "*"))
    throw new InvalidOperationException("Production AllowedHosts must specify the API hostname.");
if (!builder.Environment.IsDevelopment() && !DatabaseConnection.Protected(connection, builder.Configuration.GetValue("Database:PrivateNetwork", false)))
    throw new InvalidOperationException("Production PostgreSQL connections must stay on this machine or validate TLS certificates (SSL Mode=VerifyFull).");

builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connection));
var protection = builder.Services.AddDataProtection().SetApplicationName("Wireal.Api");
if (!builder.Environment.IsDevelopment())
{
    var keyDirectory = Required("Security:KeyDirectory");
    if (!Path.IsPathFullyQualified(keyDirectory))
        throw new InvalidOperationException("Security:KeyDirectory must be an absolute path.");
    protection.PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
    if (OperatingSystem.IsWindows()) protection.ProtectKeysWithDpapi();
    // Linux (the Docker image) has no DPAPI. The key ring then sits unencrypted in its directory, which must be a
    // volume only the API container mounts; a certificate, when given, encrypts it at rest as DPAPI does on Windows.
    else if (builder.Configuration["Security:KeyCertificatePath"] is { Length: > 0 } certificate)
        protection.ProtectKeysWithCertificate(System.Security.Cryptography.X509Certificates.X509CertificateLoader.LoadPkcs12FromFile(
            certificate, builder.Configuration["Security:KeyCertificatePassword"]));
}
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
    foreach (var proxy in builder.Configuration.GetSection("Security:KnownProxies").Get<string[]>() ?? [])
        options.KnownProxies.Add(IPAddress.Parse(proxy));
    // With no proxy configured, forwarded headers are disabled, not trusted globally.
    if (options.KnownProxies.Count == 0) options.ForwardedHeaders = ForwardedHeaders.None;
});
builder.Services.AddProblemDetails();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins(clientOrigins.All)
    .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
    .WithHeaders("Content-Type", "X-CSRF-TOKEN", "If-Match", "Authorization")
    .WithExposedHeaders("ETag", "Retry-After")
    .AllowCredentials()));
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "__Host-wireal-csrf";
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Strict;
});
builder.Services.AddAuthentication(options =>
    {
        options.DefaultScheme = "SessionOrJwt";
        options.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultSignOutScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddPolicyScheme("SessionOrJwt", null, options => options.ForwardDefaultSelector = context =>
        context.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? JwtBearerDefaults.AuthenticationScheme : CookieAuthenticationDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = jwt.ValidationParameters();
        options.IncludeErrorDetails = false;
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                var now = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow().UtcDateTime;
                if (!Guid.TryParse(context.Principal?.FindFirstValue("sub"), out var uid) ||
                    !Guid.TryParse(context.Principal?.FindFirstValue("sid"), out var sid) ||
                    !await db.AuthSessions.AnyAsync(x => x.Id == sid && x.UserId == uid && x.RevokedAt == null &&
                        x.ExpiresAt > now && !x.User.Disabled, context.HttpContext.RequestAborted))
                    context.Fail("Session is invalid.");
            }
        };
    })
    .AddCookie(options =>
    {
        options.Cookie.Name = "__Host-wireal-session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = false;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
        options.Events.OnValidatePrincipal = async context =>
        {
            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var now = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow().UtcDateTime;
            if (!Guid.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ||
                !Guid.TryParse(context.Principal?.FindFirstValue("sid"), out var sid) ||
                !await db.AuthSessions.AnyAsync(x => x.Id == sid && x.UserId == id && x.RevokedAt == null &&
                    x.ExpiresAt > now && x.BridgeExchangedAt == null && !x.User.Disabled, context.HttpContext.RequestAborted))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync();
            }
        };
    });
// GitHub sign-in is optional for a self-hosted server: with neither ClientId nor ClientSecret set, the GitHub
// button answers "not configured" and email sign-in is the way in. One without the other refuses to start.
if (GitHubLogin.Enabled(builder.Configuration))
{
    var githubClientId = Required("GitHub:App:ClientId");
    var githubClientSecret = Required("GitHub:App:ClientSecret");
    builder.Services.AddAuthentication().AddOAuth("GitHub", options =>
    {
        options.ClientId = githubClientId;
        options.ClientSecret = githubClientSecret;
        options.CallbackPath = "/auth/github/callback";
        options.AuthorizationEndpoint = "https://github.com/login/oauth/authorize";
        options.TokenEndpoint = "https://github.com/login/oauth/access_token";
        options.UserInformationEndpoint = "https://api.github.com/user";
        options.UsePkce = true;
        options.SaveTokens = false;
        options.RemoteAuthenticationTimeout = TimeSpan.FromMinutes(5);
        options.BackchannelTimeout = TimeSpan.FromSeconds(20);
        options.Events.OnCreatingTicket = context => ExternalAccounts.CreateTicket(context, "github");
        options.Events.OnRemoteFailure = context =>
        {
            context.HandleResponse();
            context.Response.Redirect(clientOrigins.LoginFailure(context.Properties));
            return Task.CompletedTask;
        };
    });
}
if (!string.IsNullOrWhiteSpace(builder.Configuration["Authentication:Google:ClientId"]))
    builder.Services.AddAuthentication().AddOAuth("Google", options =>
    {
        options.ClientId = Required("Authentication:Google:ClientId"); options.ClientSecret = Required("Authentication:Google:ClientSecret");
        options.CallbackPath = "/auth/google/callback"; options.AuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
        options.TokenEndpoint = "https://oauth2.googleapis.com/token"; options.UserInformationEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";
        options.UsePkce = true; options.SaveTokens = false; options.Scope.Add("openid"); options.Scope.Add("profile"); options.Scope.Add("email");
        options.RemoteAuthenticationTimeout = TimeSpan.FromMinutes(5); options.BackchannelTimeout = TimeSpan.FromSeconds(20);
        options.Events.OnCreatingTicket = context => ExternalAccounts.CreateTicket(context, "google");
        options.Events.OnRemoteFailure = context => { context.HandleResponse(); context.Response.Redirect(clientOrigins.LoginFailure(context.Properties)); return Task.CompletedTask; };
    });
builder.Services.AddAuthorizationBuilder().SetFallbackPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
    .RequireAuthenticatedUser().Build());
builder.Services.AddSingleton<ClientIdentity>();
builder.Services.AddRateLimiter(options =>
{
    // Tiers (nothing queues; rejections are 429 with Retry-After):
    //   signed-in user   600/min per user id as a token bucket: 600 burst, refilled 10 per second. Every MCP call
    //                    egresses from one Cloudflare Worker address, so users must not share an IP bucket. A bucket
    //                    rather than a window because agent traffic is bursty and recovers a second later instead of
    //                    at a window edge, and because the sliding-window limiter reports no Retry-After.
    //   anonymous        120/min per client IP, fixed window; nothing anonymous legitimately polls faster.
    //   "auth" policy     60/min per client IP, fixed window (/auth, /oauth, /api/teams), on top of the tier above.
    //   "login" policy    10 per 10 min per client IP, fixed window (credential, verification and invitation endpoints).
    // Identity comes from the bearer signature or the session cookie, so limits apply before authentication and
    // its database work. Client IP is CF-Connecting-IP behind the known proxy, else the connection address.
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        ClientIdentity.UserId(context) is { } user
            ? RateLimitPartition.GetTokenBucketLimiter("user:" + user, _ => new()
            {
                TokenLimit = 600, ReplenishmentPeriod = TimeSpan.FromSeconds(1), TokensPerPeriod = 10, QueueLimit = 0
            })
            : RateLimitPartition.GetFixedWindowLimiter("ip:" + ClientAddress.Key(context), _ => new()
            {
                PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
            }));
    options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(ClientAddress.Key(context), _ => new()
    {
        PermitLimit = 10, Window = TimeSpan.FromMinutes(10), QueueLimit = 0
    }));
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(ClientAddress.Key(context), _ => new()
    {
        PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
    }));
    options.OnRejected = async (context, token) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
            context.HttpContext.Response.Headers.RetryAfter = Math.Ceiling(retry.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
        await Results.Problem(statusCode: 429, title: "Too many requests").ExecuteAsync(context.HttpContext);
    };
});

var app = builder.Build();
// Before UseForwardedHeaders, while the connection address still identifies the proxy.
var forwarded = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<ForwardedHeadersOptions>>().Value;
app.Use((context, next) => { ClientAddress.Capture(context, forwarded); return next(context); });
app.UseForwardedHeaders();
app.UseSerilogRequestLogging(options =>
{
    options.MessageTemplate = "HTTP {RequestMethod} {Route} responded {StatusCode} in {Elapsed:0.0000} ms";
    options.EnrichDiagnosticContext = (diagnostic, context) =>
    {
        diagnostic.Set("Route", (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "unmatched");
        diagnostic.Set("TraceId", context.TraceIdentifier);
    };
});
app.UseExceptionHandler();
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
    context.Response.Headers.CacheControl = "no-store";
    await next(context);
});
if (!app.Environment.IsDevelopment()) app.UseHsts();
app.UseHttpsRedirection();
app.UseRouting();
app.UseCors();
// Before authentication so anonymous traffic cannot force unlimited DB/GitHub calls; the user is known
// from the credential itself, so signed-in limits apply here as well.
var identity = app.Services.GetRequiredService<ClientIdentity>();
app.Use(async (context, next) => { await identity.Prepare(context); await next(context); });
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.Use(async (context, next) =>
{
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) &&
        !HttpMethods.IsOptions(context.Request.Method) &&
        context.GetEndpoint()?.Metadata.GetMetadata<OAuthProtocolEndpoint>() is null &&
        !(context.Request.Path.StartsWithSegments("/api") && context.User.Identity?.IsAuthenticated == true &&
          context.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)))
    {
        try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context); }
        catch (AntiforgeryValidationException)
        {
            await Results.Problem(statusCode: 400, title: "Invalid CSRF token").ExecuteAsync(context);
            return;
        }
    }
    await next(context);
});
app.MapGet("/health/live", () => Results.Ok(new { status = "live" })).AllowAnonymous();
app.MapGet("/health/ready", async (AppDbContext db, CancellationToken token) =>
    await db.Database.CanConnectAsync(token) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));
app.MapAccountEndpoints(publicOrigin);
app.MapProjectEndpoints();
app.MapGitHubEndpoints();
app.MapOAuthServer(publicOrigin, clientOrigin);
app.MapProfileEndpoints();
// Preserve verification fragments in previously sent email links.
app.MapGet("/auth/ui/", (ClientOrigins origins) => Results.Redirect(origins.Primary + "/verify-email")).AllowAnonymous();
app.Run();

public partial class Program;
