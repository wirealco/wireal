using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Wireal.Api.Auth;
using Wireal.Api.Data;
using Wireal.Api.Projects;

namespace Wireal.Api.GitHub;

public sealed record CommitUrlsRequest(string[]? Urls);
public sealed record UseInstallationRequest(string? Ticket, long InstallationId);

public sealed class GitHubConnections(AppDbContext db, IGitHubAppClient github, IMemoryCache cache,
    GitHubAppSettings settings, IDataProtectionProvider protection, ClientOrigins origins, TimeProvider clock)
{
    private const string StatePurpose = "Wireal.GitHubInstall.v1";
    private const string ChoosePurpose = "Wireal.GitHubChoose.v1";
    private const int MaxCommitUrls = 100;
    private static readonly Regex CommitUrl = new(@"^https://github\.com/([A-Za-z0-9-]{1,100})/([A-Za-z0-9._-]{1,150})/commit/([a-fA-F0-9]{40})$", RegexOptions.Compiled);

    private sealed record Connection(GitHubInstallation Installation, GitHubRepository[] Repositories);
    private sealed record Choice(Guid Workspace, Guid User, long Expires, GitHubInstallation[] Installations);
    private sealed record CommitRef(string Url, string Owner, string Repo, string Sha)
    {
        public string Key => (Owner + "/" + Repo + "@" + Sha).ToLowerInvariant();
        public string RepoKey => (Owner + "/" + Repo).ToLowerInvariant();
    }

    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    private Task<WorkspaceGitHubInstallation?> Row(Guid workspaceId, CancellationToken ct) =>
        db.GitHubInstallations.SingleOrDefaultAsync(x => x.WorkspaceId == workspaceId, ct);

    private static bool Connected(WorkspaceGitHubInstallation? row) => row is { DeclinedAt: null } && row.InstallationId != 0;

    // Adoption binds an installation the owner connected in another workspace.
    // Only the owner's own requests may trigger it: otherwise a collaborator
    // could name one of the owner's repositories and pull that installation in.
    private async Task<WorkspaceGitHubInstallation?> Resolve(WorkspaceDocument workspace, Guid actor, CancellationToken ct)
    {
        var row = await Row(workspace.Id, ct);
        if (row is not null) return Connected(row) ? row : null;
        return workspace.UserId == actor ? await Adopt(workspace, ct) : null;
    }

    private void Decline(WorkspaceGitHubInstallation row)
    {
        row.InstallationId = 0;
        row.AccountLogin = "";
        row.AccountType = "";
        row.RepositorySelection = "";
        row.DeclinedAt = Now;
    }

    /// The owner, signed in as a person, sees the whole installation. Anyone
    /// else, including the owner's own MCP or API tokens, sees only the
    /// repositories this workspace names that the installation can read, and
    /// nothing that identifies or manages the installation itself.
    public async Task<object> Status(Guid actor, Guid workspaceId, bool token, CancellationToken ct)
    {
        var workspace = await WorkspaceAccess.Require(db, actor, workspaceId, ct);
        var role = workspace.UserId == actor ? "owner" : "collaborator";
        if (!settings.Configured) return new { configured = false, connected = false, role };
        var row = await Resolve(workspace, actor, ct);
        if (row is null) return new { configured = true, connected = false, role };
        var connection = await Live(row.InstallationId, ct);
        if (connection is null)
        {
            Decline(row);
            await db.SaveChangesAsync(ct);
            return new { configured = true, connected = false, role };
        }
        var account = connection.Installation;
        var connectedBy = await db.Users.AsNoTracking().Where(x => x.Id == row.ConnectedBy)
            .Select(x => new { id = x.Id, name = x.DisplayName }).SingleOrDefaultAsync(ct);
        if (role != "owner" || token)
        {
            var allowed = RepositoryScope.Allowed(workspace);
            return new
            {
                configured = true,
                connected = true,
                role,
                account = account.AccountLogin,
                accountType = account.AccountType,
                connectedAt = DateTime.SpecifyKind(row.ConnectedAt, DateTimeKind.Utc),
                connectedBy,
                repositories = connection.Repositories.Where(x => allowed.Contains(x.FullName.ToLowerInvariant()))
                    .Select(x => new { fullName = x.FullName, @private = x.Private, defaultBranch = x.DefaultBranch }).ToArray()
            };
        }
        return new
        {
            configured = true,
            connected = true,
            role,
            installationId = row.InstallationId,
            account = account.AccountLogin,
            accountType = account.AccountType,
            repositorySelection = account.RepositorySelection,
            connectedAt = DateTime.SpecifyKind(row.ConnectedAt, DateTimeKind.Utc),
            connectedBy,
            manageUrl = ManageUrl(account, row.InstallationId),
            repositories = connection.Repositories.Select(x => new { fullName = x.FullName, @private = x.Private, defaultBranch = x.DefaultBranch }).ToArray()
        };
    }

    private static string ManageUrl(GitHubInstallation account, long installationId) =>
        account.AccountType == "Organization"
            ? $"https://github.com/organizations/{account.AccountLogin}/settings/installations/{installationId}"
            : $"https://github.com/settings/installations/{installationId}";

    private static string ConnectionKey(long installationId) => "github-connection:" + installationId.ToString(CultureInfo.InvariantCulture);

    private async Task<Connection?> Live(long installationId, CancellationToken ct)
    {
        var key = ConnectionKey(installationId);
        if (cache.TryGetValue(key, out Connection? cached) && cached is not null) return cached;
        var installation = await github.Installation(installationId, ct);
        if (installation is null) return null;
        var connection = new Connection(installation, await github.Repositories(installationId, ct));
        cache.Set(key, connection, TimeSpan.FromMinutes(2));
        return connection;
    }

    private static string AdoptionKey(Guid workspaceId) => "github-adoption:" + workspaceId;

    // A workspace reaches GitHub through its owner's installation, which may cover
    // every repository on the account. So the board is the boundary, not the
    // installation: a commit is answered only when a task in this workspace
    // already carries its URL. Otherwise one collaborator on one board could
    // read diffs out of every repository the owner ever installed the app on.
    private static HashSet<string> Carried(WorkspaceDocument workspace)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var task in workspace.Tasks)
        {
            if (JsonNode.Parse(task.SettingsJson) is not JsonObject settings ||
                settings["commitUrls"] is not JsonArray urls) continue;
            foreach (var url in urls)
                if (url is JsonValue value && value.TryGetValue<string>(out var text) && Parse(text) is { } reference)
                    keys.Add(reference.Key);
        }
        return keys;
    }

    private async Task<long[]> Candidates(WorkspaceDocument workspace, CancellationToken ct)
    {
        var rows = await db.GitHubInstallations.AsNoTracking()
            .Where(x => x.WorkspaceId != workspace.Id && x.DeclinedAt == null && x.InstallationId != 0 &&
                db.Workspaces.Any(w => w.Id == x.WorkspaceId && w.UserId == workspace.UserId))
            .OrderByDescending(x => x.ConnectedAt).Select(x => x.InstallationId).ToArrayAsync(ct);
        return [.. rows.Distinct()];
    }

    private async Task<WorkspaceGitHubInstallation?> Adopt(WorkspaceDocument workspace, CancellationToken ct)
    {
        if (cache.TryGetValue(AdoptionKey(workspace.Id), out bool _)) return null;
        var repositories = RepositoryScope.Repositories(workspace);
        long[] candidates = repositories.Length == 0 ? [] : await Candidates(workspace, ct);
        var unreached = false;
        foreach (var installationId in candidates)
        {
            GitHubInstallation? installation;
            try
            {
                if (!await Owns(installationId, repositories, ct)) continue;
                installation = await github.Installation(installationId, ct);
            }
            catch (DataFault) { unreached = true; continue; }
            if (installation is null) continue;
            var row = await Bind(workspace.Id, workspace.UserId, installationId, installation, ct);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException)
            {
                db.Entry(row).State = EntityState.Detached;
                var existing = await Row(workspace.Id, ct);
                return Connected(existing) ? existing : null;
            }
            return row;
        }
        if (!unreached) cache.Set(AdoptionKey(workspace.Id), true, TimeSpan.FromSeconds(60));
        return null;
    }

    private async Task<bool> Owns(long installationId, RepositoryRef[] repositories, CancellationToken ct)
    {
        foreach (var repository in repositories)
            if (await Readable(installationId, repository.Owner, repository.Repo, ct)) return true;
        return false;
    }

    private async Task<WorkspaceDocument> RequireOwner(Guid actor, Guid workspaceId, CancellationToken ct)
    {
        var workspace = await WorkspaceAccess.Require(db, actor, workspaceId, ct);
        if (workspace.UserId != actor) throw new DataFault("Only the owner can manage the GitHub connection.", 403);
        return workspace;
    }

    public async Task<object> Connect(Guid actor, Guid workspaceId, CancellationToken ct)
    {
        await RequireOwner(actor, workspaceId, ct);
        if (!settings.Configured) throw new DataFault("GitHub App is not configured on this server.", 409);
        return new { url = AuthorizeUrl(workspaceId, actor) };
    }

    private string State(Guid workspaceId, Guid user) => protection.CreateProtector(StatePurpose)
        .Protect(string.Join('|', workspaceId, user, Now.AddMinutes(10).Ticks.ToString(CultureInfo.InvariantCulture)));

    private string AuthorizeUrl(Guid workspaceId, Guid user) =>
        $"https://github.com/login/oauth/authorize?client_id={Uri.EscapeDataString(settings.ClientId)}&state={Uri.EscapeDataString(State(workspaceId, user))}";

    private string InstallUrl(Guid workspaceId, Guid user) =>
        $"https://github.com/apps/{settings.Slug}/installations/new?state={Uri.EscapeDataString(State(workspaceId, user))}";

    public async Task Disconnect(Guid actor, Guid workspaceId, CancellationToken ct)
    {
        await RequireOwner(actor, workspaceId, ct);
        var row = await Row(workspaceId, ct);
        if (row is null)
        {
            row = new WorkspaceGitHubInstallation { WorkspaceId = workspaceId, ConnectedBy = actor, ConnectedAt = Now };
            db.GitHubInstallations.Add(row);
        }
        Decline(row);
        await db.SaveChangesAsync(ct);
    }

    private (Guid Workspace, Guid User)? Ticket(string? state)
    {
        if (string.IsNullOrEmpty(state)) return null;
        string[] parts;
        try { parts = protection.CreateProtector(StatePurpose).Unprotect(state).Split('|'); }
        catch (System.Security.Cryptography.CryptographicException) { return null; }
        if (parts.Length != 3 || !Guid.TryParse(parts[0], out var workspace) || !Guid.TryParse(parts[1], out var user) ||
            !long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var expires) || new DateTime(expires, DateTimeKind.Utc) < Now) return null;
        return (workspace, user);
    }

    public async Task<string> Callback(string? code, long installationId, string? setupAction, string? state, CancellationToken ct)
    {
        var error = origins.Primary + "/?github=error";
        if (Ticket(state) is not { } ticket) return error;
        if (setupAction == "request") return $"{origins.Primary}/?github=requested&workspace={ticket.Workspace}";
        if (!settings.Configured || string.IsNullOrEmpty(code)) return error;
        if (!await db.Workspaces.AnyAsync(w => w.Id == ticket.Workspace && w.UserId == ticket.User, ct)) return error;
        GitHubInstallation[] installations;
        try { installations = await github.UserInstallations(code, ct); }
        catch (DataFault) { return error; }
        if (installationId <= 0)
        {
            if (installations.Length == 0) return InstallUrl(ticket.Workspace, ticket.User);
            var payload = protection.CreateProtector(ChoosePurpose)
                .Protect(JsonSerializer.Serialize(new Choice(ticket.Workspace, ticket.User, Now.AddMinutes(10).Ticks, installations)));
            return $"{origins.Primary}/?github=choose&workspace={ticket.Workspace}&ticket={Uri.EscapeDataString(payload)}";
        }
        if (!installations.Any(x => x.Id == installationId)) return error;
        GitHubInstallation? installation;
        try { installation = await github.Installation(installationId, ct); }
        catch (DataFault) { return error; }
        if (installation is null) return error;
        await Bind(ticket.Workspace, ticket.User, installationId, installation, ct);
        if (await db.Users.SingleOrDefaultAsync(x => x.Id == ticket.User, ct) is { } user) user.ActiveWorkspaceId = ticket.Workspace;
        await db.SaveChangesAsync(ct);
        return $"{origins.Primary}/?github=connected&workspace={ticket.Workspace}";
    }

    private async Task<WorkspaceGitHubInstallation> Bind(Guid workspaceId, Guid user, long installationId, GitHubInstallation installation, CancellationToken ct)
    {
        var row = await Row(workspaceId, ct);
        if (row is null)
        {
            row = new WorkspaceGitHubInstallation { WorkspaceId = workspaceId };
            db.GitHubInstallations.Add(row);
        }
        row.InstallationId = installationId;
        row.AccountLogin = Cut(installation.AccountLogin, 100);
        row.AccountType = installation.AccountType;
        row.RepositorySelection = installation.RepositorySelection;
        row.ConnectedBy = user;
        row.ConnectedAt = Now;
        row.DeclinedAt = null;
        cache.Remove(ConnectionKey(installationId));
        cache.Remove(AdoptionKey(workspaceId));
        return row;
    }

    private Choice? ChoiceTicket(string? ticket, Guid workspaceId, Guid actor)
    {
        if (string.IsNullOrEmpty(ticket)) return null;
        Choice? choice;
        try { choice = JsonSerializer.Deserialize<Choice>(protection.CreateProtector(ChoosePurpose).Unprotect(ticket)); }
        catch (Exception error) when (error is System.Security.Cryptography.CryptographicException or JsonException) { return null; }
        if (choice is null || choice.Workspace != workspaceId || choice.User != actor ||
            new DateTime(choice.Expires, DateTimeKind.Utc) < Now) return null;
        return choice;
    }

    public async Task<object> InstallationChoices(Guid actor, Guid workspaceId, string? ticket, CancellationToken ct)
    {
        await RequireOwner(actor, workspaceId, ct);
        if (!settings.Configured) throw new DataFault("GitHub App is not configured on this server.", 409);
        var choice = ChoiceTicket(ticket, workspaceId, actor) ?? throw StaleTicket();
        var ids = choice.Installations.Select(x => x.Id).ToArray();
        var taken = await WorkspaceAccess.Visible(db, actor).Where(w => w.Id != workspaceId)
            .Join(db.GitHubInstallations.Where(x => x.DeclinedAt == null && x.InstallationId != 0),
                w => w.Id, x => x.WorkspaceId, (w, x) => x.InstallationId)
            .Where(id => ids.Contains(id)).Distinct().ToListAsync(ct);
        return new
        {
            installations = choice.Installations.Select(x => new
            {
                id = x.Id,
                account = x.AccountLogin,
                accountType = x.AccountType,
                connectedElsewhere = taken.Contains(x.Id)
            }).ToArray(),
            installUrl = InstallUrl(workspaceId, actor)
        };
    }

    public async Task<object> UseInstallation(Guid actor, Guid workspaceId, UseInstallationRequest input, CancellationToken ct)
    {
        await RequireOwner(actor, workspaceId, ct);
        if (!settings.Configured) throw new DataFault("GitHub App is not configured on this server.", 409);
        var choice = ChoiceTicket(input.Ticket, workspaceId, actor) ?? throw StaleTicket();
        if (!choice.Installations.Any(x => x.Id == input.InstallationId)) throw StaleTicket();
        var installation = await github.Installation(input.InstallationId, ct)
            ?? throw new DataFault("That GitHub installation is no longer available.", 409);
        await Bind(workspaceId, actor, input.InstallationId, installation, ct);
        await db.SaveChangesAsync(ct);
        return await Status(actor, workspaceId, false, ct);
    }

    private static DataFault StaleTicket() => new("The GitHub sign-in expired. Connect again.");

    private static string Cut(string value, int length) => value.Length <= length ? value : value[..length];

    private async Task<(WorkspaceDocument Workspace, WorkspaceGitHubInstallation Row)> RequireConnection(Guid actor, Guid workspaceId, CancellationToken ct)
    {
        var workspace = await WorkspaceAccess.Require(db, actor, workspaceId, ct);
        if (!settings.Configured) throw new DataFault("GitHub App is not configured on this server.", 409);
        return (workspace, await Resolve(workspace, actor, ct) ?? throw new DataFault("This workspace is not connected to GitHub.", 409));
    }

    private async Task<bool> Readable(long installationId, string owner, string repo, CancellationToken ct)
    {
        var key = $"github-readable:{installationId}:{(owner + "/" + repo).ToLowerInvariant()}";
        if (cache.TryGetValue(key, out bool cached)) return cached;
        var readable = await github.Readable(installationId, owner, repo, ct);
        if (!readable)
        {
            github.Forget(installationId);
            cache.Remove(ConnectionKey(installationId));
            readable = await github.Readable(installationId, owner, repo, ct);
        }
        cache.Set(key, readable, readable ? TimeSpan.FromMinutes(10) : TimeSpan.FromSeconds(30));
        return readable;
    }

    public async Task<object[]> Folders(Guid actor, Guid workspaceId, string owner, string repo, string? path, CancellationToken ct)
    {
        var (workspace, row) = await RequireConnection(actor, workspaceId, ct);
        // The owner browses any repository their installation reads while
        // choosing one; everyone else only the repositories the owner chose.
        if (workspace.UserId != actor && !RepositoryScope.Allows(workspace, owner, repo))
            throw new DataFault("This repository is not part of the workspace.", 403);
        if (!await Readable(row.InstallationId, owner, repo, ct)) throw new DataFault("Repository not found.", 404);
        var folder = (path ?? "").Trim('/');
        var key = $"github-folders:{row.InstallationId}:{(owner + "/" + repo).ToLowerInvariant()}:{folder}";
        if (cache.TryGetValue(key, out object[]? cached) && cached is not null) return cached;
        var branch = (await Live(row.InstallationId, ct))?.Repositories
            .FirstOrDefault(x => string.Equals(x.FullName, owner + "/" + repo, StringComparison.OrdinalIgnoreCase))?.DefaultBranch;
        var folders = await github.Folders(row.InstallationId, owner, repo, folder, branch, ct) ?? throw new DataFault("Folder not found.", 404);
        var result = folders.Select(x => (object)new { name = x.Name, path = x.Path }).ToArray();
        cache.Set(key, result, TimeSpan.FromMinutes(5));
        return result;
    }

    public async Task<JsonArray> Commits(Guid actor, Guid workspaceId, CommitUrlsRequest input, CancellationToken ct)
    {
        var workspace = await WorkspaceAccess.Require(db, actor, workspaceId, ct);
        var urls = input.Urls ?? [];
        if (urls.Length > MaxCommitUrls) throw new DataFault($"Send at most {MaxCommitUrls} commit URLs.");
        var refs = urls.Select(Parse).ToArray();
        var carried = Carried(workspace);
        // A collaborator can write commit URLs into tasks, so for them the
        // commit must also sit in a repository the owner chose for this board.
        if (workspace.UserId != actor)
        {
            var allowed = RepositoryScope.Allowed(workspace);
            carried.RemoveWhere(key => !allowed.Contains(key[..key.IndexOf('@')]));
        }
        var row = settings.Configured ? await Resolve(workspace, actor, ct) : null;
        var answers = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var reference in refs.Where(x => x is not null).Select(x => x!))
            if (!carried.Contains(reference.Key)) answers[reference.Key] = Failed(reference.Url, "unauthorized", null);
        if (row is not null)
        {
            var distinct = refs.Where(x => x is not null).Select(x => x!).Where(x => carried.Contains(x.Key))
                .GroupBy(x => x.Key).Select(group => group.First()).ToArray();
            var repositories = distinct.GroupBy(x => x.RepoKey).Select(group => group.First()).ToArray();
            var checks = await Bounded(repositories.Select(reference => (Func<Task<bool>>)(async () =>
            {
                try { return await Readable(row.InstallationId, reference.Owner, reference.Repo, ct); }
                catch (DataFault) { return false; }
            })), 4, ct);
            var readable = repositories.Zip(checks).ToDictionary(pair => pair.First.RepoKey, pair => pair.Second, StringComparer.Ordinal);

            var wanted = distinct.Where(x => readable.GetValueOrDefault(x.RepoKey)).ToArray();
            var keys = wanted.Select(x => x.Key).ToArray();
            var stored = await db.GitHubCommitSnapshots.Where(x => keys.Contains(x.Key))
                .ToDictionaryAsync(x => x.Key, x => x, StringComparer.Ordinal, ct);
            var pending = wanted.Where(x => !stored.TryGetValue(x.Key, out var snapshot) || Stale(snapshot)).ToArray();
            var fetched = await Bounded(pending.Select(reference => (Func<Task<GitHubCommit?>>)(async () =>
            {
                if (!stored.ContainsKey(reference.Key))
                    return await github.Commit(row.InstallationId, reference.Owner, reference.Repo, reference.Sha, ct);
                try { return await github.Commit(row.InstallationId, reference.Owner, reference.Repo, reference.Sha, ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch { return null; }
            })), 4, ct);
            foreach (var (reference, commit) in pending.Zip(fetched))
            {
                if (commit is null || commit.Error is not null || commit.Files is null)
                {
                    if (!stored.ContainsKey(reference.Key))
                        answers[reference.Key] = Failed(reference.Url, commit?.Error ?? "network", commit?.Status);
                    continue;
                }
                stored[reference.Key] = await Store(reference, commit, stored.GetValueOrDefault(reference.Key), ct);
            }
            foreach (var reference in distinct)
            {
                if (answers.ContainsKey(reference.Key)) continue;
                if (!readable.GetValueOrDefault(reference.RepoKey)) { answers[reference.Key] = Failed(reference.Url, "unauthorized", null); continue; }
                if (stored.TryGetValue(reference.Key, out var snapshot)) answers[reference.Key] = Succeeded(reference, snapshot);
            }
        }
        var response = new JsonArray();
        foreach (var (url, reference) in urls.Zip(refs))
        {
            if (reference is null) { response.Add(Failed(url, "invalid", null)); continue; }
            if (row is null) { response.Add(Failed(reference.Url, "not-connected", null)); continue; }
            response.Add(answers.TryGetValue(reference.Key, out var answer) ? answer.DeepClone().AsObject() : Failed(reference.Url, "network", null));
        }
        return response;
    }

    private static bool Stale(GitHubCommitSnapshot snapshot)
    {
        var files = JsonNode.Parse(snapshot.FilesJson) as JsonArray;
        return files is { Count: > 0 } && files.Any(row => row is not JsonObject file || !file.ContainsKey("patch"));
    }

    private async Task<GitHubCommitSnapshot> Store(CommitRef reference, GitHubCommit commit, GitHubCommitSnapshot? snapshot, CancellationToken ct)
    {
        var files = new JsonArray();
        foreach (var file in commit.Files!)
        {
            var patch = file.Patch;
            var truncated = file.PatchTruncated;
            if (patch is { Length: > 4000 })
            {
                var boundary = patch.LastIndexOf('\n', 3999, 200);
                patch = patch[..(boundary >= 0 ? boundary + 1 : 4000)];
                truncated = true;
            }
            var row = new JsonObject { ["path"] = file.Path };
            if (file.PreviousPath is { Length: > 0 } previous) row["previousPath"] = previous;
            row["status"] = file.Status;
            row["additions"] = file.Additions;
            row["deletions"] = file.Deletions;
            row["patch"] = patch;
            if (truncated) row["patchTruncated"] = true;
            files.Add(row);
        }
        var existing = snapshot is not null;
        snapshot ??= new GitHubCommitSnapshot
        {
            Key = reference.Key,
            Owner = Cut(reference.Owner, 100),
            Repo = Cut(reference.Repo, 150),
            Sha = reference.Sha
        };
        snapshot.CommittedAt = commit.CommittedAt;
        snapshot.Additions = commit.Files.Sum(file => file.Additions);
        snapshot.Deletions = commit.Files.Sum(file => file.Deletions);
        snapshot.FilesJson = files.ToJsonString();
        snapshot.FetchedAt = Now;
        if (!existing) db.GitHubCommitSnapshots.Add(snapshot);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException)
        {
            if (existing) throw;
            db.Entry(snapshot).State = EntityState.Detached;
            return await db.GitHubCommitSnapshots.AsNoTracking().SingleAsync(x => x.Key == snapshot.Key, ct);
        }
        db.Entry(snapshot).State = EntityState.Detached;
        return snapshot;
    }

    private static JsonObject Succeeded(CommitRef reference, GitHubCommitSnapshot snapshot) => new()
    {
        ["url"] = reference.Url,
        ["owner"] = reference.Owner,
        ["repo"] = reference.Repo,
        ["sha"] = reference.Sha,
        ["committedAt"] = snapshot.CommittedAt is { } when
            ? JsonValue.Create(DateTime.SpecifyKind(when, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)) : null,
        ["additions"] = snapshot.Additions,
        ["deletions"] = snapshot.Deletions,
        ["files"] = JsonNode.Parse(snapshot.FilesJson) as JsonArray ?? new JsonArray()
    };

    private static JsonObject Failed(string url, string kind, int? status)
    {
        var error = new JsonObject { ["kind"] = kind };
        if (status is { } code) error["status"] = code;
        return new JsonObject { ["url"] = url, ["error"] = error };
    }

    private static CommitRef? Parse(string? url)
    {
        var match = CommitUrl.Match(url?.Trim() ?? "");
        if (!match.Success) return null;
        var sha = match.Groups[3].Value.ToLowerInvariant();
        var owner = match.Groups[1].Value;
        var repo = match.Groups[2].Value;
        return new CommitRef($"https://github.com/{owner}/{repo}/commit/{sha}", owner, repo, sha);
    }

    private static async Task<T[]> Bounded<T>(IEnumerable<Func<Task<T>>> work, int limit, CancellationToken ct)
    {
        using var gate = new SemaphoreSlim(limit);
        return await Task.WhenAll(work.Select(async item =>
        {
            await gate.WaitAsync(ct);
            try { return await item(); } finally { gate.Release(); }
        }));
    }
}
