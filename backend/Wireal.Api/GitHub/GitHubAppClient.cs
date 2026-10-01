using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Wireal.Api.Projects;

namespace Wireal.Api.GitHub;

public sealed record GitHubInstallation(long Id, string AccountLogin, string AccountType, string RepositorySelection);
public sealed record GitHubRepository(string FullName, bool Private, string DefaultBranch);
public sealed record GitHubFolder(string Name, string Path);
public sealed record GitHubFile(string Path, string? PreviousPath, string Status, int Additions, int Deletions,
    string? Patch = null, bool PatchTruncated = false);
public sealed record GitHubCommit(GitHubFile[]? Files, DateTime? CommittedAt, string? Error, int? Status);

public interface IGitHubAppClient
{
    Task<GitHubInstallation?> Installation(long installationId, CancellationToken ct);
    Task<GitHubInstallation[]> UserInstallations(string code, CancellationToken ct);
    Task<GitHubRepository[]> Repositories(long installationId, CancellationToken ct);
    Task<bool> Readable(long installationId, string owner, string repo, CancellationToken ct);
    Task<GitHubFolder[]?> Folders(long installationId, string owner, string repo, string path, string? reference, CancellationToken ct);
    Task<GitHubCommit> Commit(long installationId, string owner, string repo, string sha, CancellationToken ct);
    void Forget(long installationId);
}

public sealed class GitHubAppClient(HttpClient http, GitHubAppSettings settings, IMemoryCache cache) : IGitHubAppClient
{
    private const string Api = "https://api.github.com";
    private static readonly string[] Statuses = ["added", "modified", "removed", "renamed", "copied", "changed", "unchanged"];

    private static DataFault Unavailable() => new("GitHub is unavailable. Try again.", 503);

    private static void Prepare(HttpRequestMessage request, string token)
    {
        request.Headers.UserAgent.ParseAdd("Wireal.Api/1.0");
        request.Headers.Accept.ParseAdd("application/vnd.github+json");
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    private async Task<HttpResponseMessage> Send(HttpMethod method, string url, string token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, url);
        Prepare(request, token);
        try { return await http.SendAsync(request, ct); }
        catch (Exception error) when (error is HttpRequestException || error is OperationCanceledException && !ct.IsCancellationRequested)
        { throw Unavailable(); }
    }

    private string AppToken()
    {
        var now = DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = settings.AppId.ToString(CultureInfo.InvariantCulture),
            IssuedAt = now.AddSeconds(-60),
            NotBefore = now.AddSeconds(-60),
            Expires = now.AddMinutes(9),
            SigningCredentials = new SigningCredentials(settings.SigningKey(), SecurityAlgorithms.RsaSha256)
        });
    }

    private static string TokenKey(long installationId) => "github-app-token:" + installationId.ToString(CultureInfo.InvariantCulture);

    public void Forget(long installationId) => cache.Remove(TokenKey(installationId));

    private async Task<string> InstallationToken(long installationId, CancellationToken ct)
    {
        var key = TokenKey(installationId);
        if (cache.TryGetValue(key, out string? cached) && cached is not null) return cached;
        using var response = await Send(HttpMethod.Post, $"{Api}/app/installations/{installationId}/access_tokens", AppToken(), ct);
        if (!response.IsSuccessStatusCode) throw Unavailable();
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var token = body.RootElement.TryGetProperty("token", out var value) ? value.GetString() : null;
        if (string.IsNullOrEmpty(token)) throw Unavailable();
        var expires = body.RootElement.TryGetProperty("expires_at", out var when) && when.ValueKind == JsonValueKind.String &&
            when.TryGetDateTimeOffset(out var at) ? at : DateTimeOffset.UtcNow.AddHours(1);
        var lifetime = expires.AddMinutes(-5) - DateTimeOffset.UtcNow;
        if (lifetime > TimeSpan.Zero) cache.Set(key, token, lifetime);
        return token;
    }

    public async Task<GitHubInstallation?> Installation(long installationId, CancellationToken ct)
    {
        using var response = await Send(HttpMethod.Get, $"{Api}/app/installations/{installationId}", AppToken(), ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        if (!response.IsSuccessStatusCode) throw Unavailable();
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return Account(installationId, body.RootElement);
    }

    public async Task<GitHubInstallation[]> UserInstallations(string code, CancellationToken ct)
    {
        using var exchange = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = settings.ClientId, ["client_secret"] = settings.ClientSecret, ["code"] = code
            })
        };
        exchange.Headers.UserAgent.ParseAdd("Wireal.Api/1.0");
        exchange.Headers.Accept.ParseAdd("application/json");
        string? token;
        try
        {
            using var exchanged = await http.SendAsync(exchange, ct);
            if (!exchanged.IsSuccessStatusCode) return [];
            using var body = JsonDocument.Parse(await exchanged.Content.ReadAsStringAsync(ct));
            token = body.RootElement.TryGetProperty("access_token", out var value) ? value.GetString() : null;
        }
        catch (Exception error) when (error is HttpRequestException or JsonException || error is OperationCanceledException && !ct.IsCancellationRequested)
        { return []; }
        if (string.IsNullOrEmpty(token)) return [];
        var installations = new List<GitHubInstallation>();
        for (var page = 1; page <= 10; page += 1)
        {
            using var response = await Send(HttpMethod.Get, $"{Api}/user/installations?per_page=100&page={page}", token, ct);
            if (!response.IsSuccessStatusCode) return [];
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (!body.RootElement.TryGetProperty("installations", out var rows) || rows.ValueKind != JsonValueKind.Array) break;
            foreach (var row in rows.EnumerateArray())
                if (row.TryGetProperty("id", out var id) && id.TryGetInt64(out var value)) installations.Add(Account(value, row));
            if (rows.GetArrayLength() < 100) break;
        }
        return [.. installations];
    }

    private static GitHubInstallation Account(long installationId, JsonElement row)
    {
        var account = row.TryGetProperty("account", out var value) && value.ValueKind == JsonValueKind.Object ? value : default;
        return new GitHubInstallation(installationId, Text(account, "login"), Text(account, "type") is "Organization" ? "Organization" : "User",
            Text(row, "repository_selection") is "all" ? "all" : "selected");
    }

    public async Task<GitHubRepository[]> Repositories(long installationId, CancellationToken ct)
    {
        var token = await InstallationToken(installationId, ct);
        var repositories = new List<GitHubRepository>();
        for (var page = 1; page <= 3; page += 1)
        {
            using var response = await Send(HttpMethod.Get, $"{Api}/installation/repositories?per_page=100&page={page}", token, ct);
            if (!response.IsSuccessStatusCode) throw Unavailable();
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (!body.RootElement.TryGetProperty("repositories", out var rows) || rows.ValueKind != JsonValueKind.Array) break;
            foreach (var row in rows.EnumerateArray())
                repositories.Add(new GitHubRepository(Text(row, "full_name"),
                    row.TryGetProperty("private", out var isPrivate) && isPrivate.ValueKind == JsonValueKind.True, Text(row, "default_branch")));
            if (rows.GetArrayLength() < 100 || repositories.Count >= 300) break;
        }
        return [.. repositories.Take(300)];
    }

    public async Task<bool> Readable(long installationId, string owner, string repo, CancellationToken ct)
    {
        var token = await InstallationToken(installationId, ct);
        using var response = await Send(HttpMethod.Get, $"{Api}/repos/{Uri.EscapeDataString(owner)}/{Uri.EscapeDataString(repo)}", token, ct);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized) return false;
        if (!response.IsSuccessStatusCode) throw Unavailable();
        return true;
    }

    public async Task<GitHubFolder[]?> Folders(long installationId, string owner, string repo, string path, string? reference, CancellationToken ct)
    {
        var token = await InstallationToken(installationId, ct);
        var url = $"{Api}/repos/{Uri.EscapeDataString(owner)}/{Uri.EscapeDataString(repo)}/contents/" +
            string.Join('/', path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Uri.EscapeDataString));
        if (!string.IsNullOrEmpty(reference)) url += "?ref=" + Uri.EscapeDataString(reference);
        using var response = await Send(HttpMethod.Get, url, token, ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        if (!response.IsSuccessStatusCode) throw Unavailable();
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (body.RootElement.ValueKind != JsonValueKind.Array) return null;
        return [.. body.RootElement.EnumerateArray().Where(row => Text(row, "type") == "dir")
            .Select(row => new GitHubFolder(Text(row, "name"), Text(row, "path")))
            .OrderBy(folder => folder.Name, StringComparer.Ordinal)];
    }

    public async Task<GitHubCommit> Commit(long installationId, string owner, string repo, string sha, CancellationToken ct)
    {
        string token;
        try { token = await InstallationToken(installationId, ct); }
        catch (DataFault) { return new GitHubCommit(null, null, "network", null); }
        var files = new List<GitHubFile>();
        DateTime? committedAt = null;
        for (var page = 1; page <= 10; page += 1)
        {
            HttpResponseMessage result;
            try { result = await Send(HttpMethod.Get, $"{Api}/repos/{Uri.EscapeDataString(owner)}/{Uri.EscapeDataString(repo)}/commits/{sha}?per_page=300&page={page}", token, ct); }
            catch (DataFault) { return new GitHubCommit(null, null, "network", null); }
            using var response = result;
            if (!response.IsSuccessStatusCode) return new GitHubCommit(null, null, Failure(response), (int)response.StatusCode);
            JsonDocument body;
            try { body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct)); }
            catch (JsonException) { return new GitHubCommit(null, null, "network", null); }
            using (body)
            {
                if (!body.RootElement.TryGetProperty("files", out var rows) || rows.ValueKind != JsonValueKind.Array)
                    return new GitHubCommit(null, null, "network", null);
                committedAt ??= CommittedAt(body.RootElement);
                foreach (var row in rows.EnumerateArray())
                    if (File(row) is { } file) files.Add(file);
                if (rows.GetArrayLength() < 300) break;
            }
        }
        return new GitHubCommit([.. files], committedAt, null, null);
    }

    private static string Failure(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.TooManyRequests || (response.StatusCode == HttpStatusCode.Forbidden &&
            response.Headers.TryGetValues("x-ratelimit-remaining", out var remaining) && remaining.FirstOrDefault() == "0"))
            return "rate-limited";
        return response.StatusCode switch
        {
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "unauthorized",
            HttpStatusCode.NotFound => "not-found",
            _ => "network"
        };
    }

    private static DateTime? CommittedAt(JsonElement root)
    {
        if (!root.TryGetProperty("commit", out var commit) || commit.ValueKind != JsonValueKind.Object) return null;
        foreach (var side in new[] { "committer", "author" })
            if (commit.TryGetProperty(side, out var person) && person.ValueKind == JsonValueKind.Object &&
                person.TryGetProperty("date", out var date) && date.ValueKind == JsonValueKind.String &&
                DateTime.TryParse(date.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var when))
                return when;
        return null;
    }

    private static GitHubFile? File(JsonElement row)
    {
        if (row.ValueKind != JsonValueKind.Object || Text(row, "filename") is not { Length: > 0 } path) return null;
        var status = Text(row, "status");
        var previous = Text(row, "previous_filename");
        var patch = row.TryGetProperty("patch", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        var truncated = patch is { Length: > 4000 };
        if (truncated)
        {
            var boundary = patch!.LastIndexOf('\n', 3999, 200);
            patch = patch[..(boundary >= 0 ? boundary + 1 : 4000)];
        }
        return new GitHubFile(path, previous.Length > 0 ? previous : null, Statuses.Contains(status) ? status : "changed",
            Number(row, "additions"), Number(row, "deletions"), patch, truncated);
    }

    private static string Text(JsonElement value, string key) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var found) && found.ValueKind == JsonValueKind.String
            ? found.GetString() ?? "" : "";

    private static int Number(JsonElement value, string key) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var found) && found.ValueKind == JsonValueKind.Number &&
            found.TryGetInt32(out var number) ? number : 0;
}
