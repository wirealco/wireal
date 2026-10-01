using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Wireal.Api.Data;

namespace Wireal.Api.Projects;

public sealed record RepositoryRef(string Owner, string Repo)
{
    public string Key => (Owner + "/" + Repo).ToLowerInvariant();
}

// The GitHub installation belongs to the workspace owner and may reach every
// repository on their account. What a workspace may read through it is the set
// of repositories its document names: map.repositoryUrl and each project's
// repositoryUrl. Only the owner can change those fields (and the project
// folders that scope them), so the set is always the one the owner last saved.
public static partial class RepositoryScope
{
    [GeneratedRegex(@"^(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9-]{1,100})/([A-Za-z0-9._-]{1,150})(?:[/#?].*)?$", RegexOptions.IgnoreCase)]
    private static partial Regex RepositoryUrl();

    public const string OwnerOnly =
        "Only the workspace owner can change which GitHub repositories and folders this workspace uses.";

    public static RepositoryRef? Parse(string? url)
    {
        var match = RepositoryUrl().Match(url?.Trim() ?? "");
        if (!match.Success) return null;
        var repo = match.Groups[2].Value;
        if (repo.EndsWith(".git", StringComparison.OrdinalIgnoreCase)) repo = repo[..^4];
        return repo.Length == 0 ? null : new RepositoryRef(match.Groups[1].Value, repo);
    }

    public static RepositoryRef[] Repositories(WorkspaceDocument workspace) => Distinct(
        workspace.Projects.Select(x => x.RepositoryUrl).Prepend(workspace.RepositoryUrl));

    public static HashSet<string> Allowed(WorkspaceDocument workspace) =>
        Repositories(workspace).Select(x => x.Key).ToHashSet(StringComparer.Ordinal);

    public static bool Allows(WorkspaceDocument workspace, string owner, string repo) =>
        Allowed(workspace).Contains(new RepositoryRef(owner, repo).Key);

    private static RepositoryRef[] Distinct(IEnumerable<string?> urls) =>
        [.. urls.Select(Parse).OfType<RepositoryRef>().GroupBy(x => x.Key, StringComparer.Ordinal).Select(group => group.First())];

    private static string Text(JsonObject? row, string key) =>
        row?[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text.Trim() : "";

    private static bool SameRepository(string previous, string next) =>
        string.Equals(previous, next, StringComparison.OrdinalIgnoreCase) ||
        Parse(previous) is { } before && Parse(next) is { } after && before.Key == after.Key;

    private static string Layout(JsonObject? map) =>
        Text(map, "repositoryLayout") is { Length: > 0 } layout ? layout : Text(map, "repositoryUrl").Length > 0 ? "monorepo" : "multirepo";

    // Mirrors normalizeProjectPath in src/domain.ts.
    private static string Folder(string path)
    {
        path = MultipleSlashes().Replace(path.Trim(), "/");
        while (path.StartsWith("./", StringComparison.Ordinal) || path.StartsWith('/'))
            path = path.StartsWith("./", StringComparison.Ordinal) ? path[2..] : path[1..];
        return path.TrimEnd('/');
    }

    [GeneratedRegex("/{2,}")]
    private static partial Regex MultipleSlashes();

    private static string[] Paths(JsonObject project) =>
        project["paths"] is JsonArray paths
            ? [.. paths.Select(x => x is JsonValue v && v.TryGetValue<string>(out var path) ? Folder(path) : "")
                .Where(x => x.Length > 0).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)]
            : [];

    /// Throws 403 when a save by someone other than the owner changes what the
    /// workspace reads on GitHub: the workspace repository or layout, a
    /// project's repository or folders, or a new project that names a
    /// repository the owner did not already choose. Removing a project is
    /// allowed; it only narrows the set.
    public static void RequireUnchanged(JsonObject previous, JsonObject next)
    {
        var before = previous["map"] as JsonObject;
        var after = next["map"] as JsonObject;
        if (!SameRepository(Text(before, "repositoryUrl"), Text(after, "repositoryUrl")) || Layout(before) != Layout(after))
            throw new DataFault(OwnerOnly, 403);
        var known = (previous["projects"] as JsonArray ?? []).OfType<JsonObject>()
            .GroupBy(x => Text(x, "id"), StringComparer.Ordinal).ToDictionary(x => x.Key, x => x.First(), StringComparer.Ordinal);
        var allowed = Distinct((previous["projects"] as JsonArray ?? []).OfType<JsonObject>()
            .Select(x => Text(x, "repositoryUrl")).Prepend(Text(before, "repositoryUrl"))).Select(x => x.Key).ToHashSet(StringComparer.Ordinal);
        foreach (var project in (next["projects"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var url = Text(project, "repositoryUrl");
            if (known.TryGetValue(Text(project, "id"), out var old))
            {
                if (!SameRepository(Text(old, "repositoryUrl"), url) || !Paths(old).SequenceEqual(Paths(project), StringComparer.Ordinal))
                    throw new DataFault(OwnerOnly, 403);
                continue;
            }
            if (url.Length > 0 && (Parse(url) is not { } repository || !allowed.Contains(repository.Key)) || Paths(project).Length > 0)
                throw new DataFault(OwnerOnly, 403);
        }
    }
}
