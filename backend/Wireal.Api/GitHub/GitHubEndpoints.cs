using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Wireal.Api.Projects;

namespace Wireal.Api.GitHub;

public static class GitHubEndpoints
{
    private static readonly Func<EndpointFilterInvocationContext, EndpointFilterDelegate, ValueTask<object?>> PeopleOnly =
        async (context, next) => context.HttpContext.User.HasClaim(c => c.Type == "client_id") ? Results.Forbid() : await next(context);

    public static void MapGitHubEndpoints(this WebApplication app)
    {
        var github = app.MapGroup("/api/github/workspaces").RequireAuthorization().AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (DataFault error) { return Results.Json(new DataResult(null, new { message = error.Message, code = error.Status.ToString() }), statusCode: error.Status); }
            catch (DbUpdateConcurrencyException) { return Results.Json(new DataResult(null, new { message = "Data changed concurrently. Reload and retry.", code = "409" }), statusCode: 409); }
            catch (Exception error) when (error is FormatException or InvalidOperationException or System.Text.Json.JsonException or ArgumentException)
            { return Results.Json(new DataResult(null, new { message = "Invalid request data.", code = "400" }), statusCode: 400); }
        });
        github.MapGet("/{id:guid}", (Guid id, ClaimsPrincipal user, GitHubConnections service, CancellationToken ct) => service.Status(ProjectService.Owner(user), id, user.HasClaim(c => c.Type == "client_id"), ct));
        github.MapPost("/{id:guid}/connect", (Guid id, ClaimsPrincipal user, GitHubConnections service, CancellationToken ct) =>
            service.Connect(ProjectService.Owner(user), id, ct)).AddEndpointFilter(PeopleOnly);
        github.MapGet("/{id:guid}/installation-choices", (Guid id, string? ticket, ClaimsPrincipal user, GitHubConnections service, CancellationToken ct) =>
            service.InstallationChoices(ProjectService.Owner(user), id, ticket, ct)).AddEndpointFilter(PeopleOnly);
        github.MapPost("/{id:guid}/installations", (Guid id, UseInstallationRequest input, ClaimsPrincipal user, GitHubConnections service, CancellationToken ct) =>
            service.UseInstallation(ProjectService.Owner(user), id, input, ct)).AddEndpointFilter(PeopleOnly);
        github.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, GitHubConnections service, CancellationToken ct) =>
        { await service.Disconnect(ProjectService.Owner(user), id, ct); return Results.NoContent(); }).AddEndpointFilter(PeopleOnly);
        github.MapGet("/{id:guid}/repositories/{owner}/{repo}/folders", (Guid id, string owner, string repo, string? path, ClaimsPrincipal user, GitHubConnections service, CancellationToken ct) =>
            service.Folders(ProjectService.Owner(user), id, owner, repo, path, ct)).AddEndpointFilter(PeopleOnly);
        github.MapPost("/{id:guid}/commits", (Guid id, CommitUrlsRequest input, ClaimsPrincipal user, GitHubConnections service, CancellationToken ct) =>
            service.Commits(ProjectService.Owner(user), id, input, ct)).AddEndpointFilter(PeopleOnly);
        app.MapGet("/auth/github/app/callback", async (HttpContext context, GitHubConnections service, CancellationToken ct) =>
        {
            var query = context.Request.Query;
            _ = long.TryParse(query["installation_id"], NumberStyles.None, CultureInfo.InvariantCulture, out var installationId);
            return Results.Redirect(await service.Callback(query["code"], installationId, query["setup_action"], query["state"], ct));
        }).AllowAnonymous().RequireRateLimiting("auth");
    }
}
