using System.Text.Json.Nodes;

namespace Wireal.Api.Data;

// The wire format stays compatible with offline clients. Persistence is a graph
// of tracked relational entities; updates retain existing rows and their keys.
public static class WorkspaceGraph
{
    private static JsonObject Object(string json) => JsonNode.Parse(json)!.AsObject();
    private static string Text(JsonObject row, string key, string fallback = "") => row[key]?.GetValue<string>() ?? fallback;
    private static JsonArray Array(JsonObject row, string key) => row[key] as JsonArray ?? [];
    private static string Extras(JsonObject row, params string[] fields)
    {
        var result = (JsonObject)row.DeepClone();
        foreach (var field in fields) result.Remove(field);
        return result.ToJsonString();
    }
    private static JsonObject Merge(string extras, params (string Key, JsonNode? Value)[] fields)
    {
        var result = Object(extras);
        foreach (var (key, value) in fields) result[key] = value;
        return result;
    }
    private static JsonArray Rows<T>(IEnumerable<T> rows, Func<T, JsonNode?> project) => new(rows.Select(project).ToArray());

    /// A task's label array carries label names — the editor writes label.name
    /// and renaming a label rewrites every task — while documents written by an
    /// API client may carry ids. Resolve a name first and an id second so both
    /// spellings reach the same row; two labels sharing a name take the lowest
    /// id. The relational migration resolves labels the same way.
    public static Dictionary<string, string> LabelIds(IEnumerable<(string Id, string Name)> labels)
    {
        var index = new Dictionary<string, string>(StringComparer.Ordinal);
        var ordered = labels.OrderBy(label => label.Id, StringComparer.Ordinal).ToList();
        foreach (var (id, name) in ordered) index.TryAdd(name, id);
        foreach (var (id, _) in ordered) index.TryAdd(id, id);
        return index;
    }
    /// Label strings the workspace no longer defines are dropped, the way the
    /// JSON readers ignored them, and repeats collapse to the first mention.
    private static JsonArray LabelRefs(JsonArray values, Dictionary<string, string> index)
    {
        var result = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in values)
            if (node is JsonValue value && value.TryGetValue<string>(out var text)
                && index.TryGetValue(text, out var id) && seen.Add(id)) result.Add(JsonValue.Create(id));
        return result;
    }

    public static JsonObject Read(WorkspaceDocument workspace)
    {
        var names = workspace.Labels.ToDictionary(label => label.Id, label => label.Name, StringComparer.Ordinal);
        return Merge(workspace.SettingsJson,
            ("version", 9),
            ("map", Merge(workspace.MapSettingsJson, ("name", workspace.Name), ("kind", workspace.Kind),
                ("repositoryUrl", workspace.RepositoryUrl), ("repositoryLayout", workspace.RepositoryLayout))),
            ("projects", Rows(workspace.Projects.OrderBy(p => p.SortOrder), p => Merge(p.SettingsJson,
                ("id", p.Id), ("name", p.Name), ("repositoryUrl", p.RepositoryUrl)))),
            ("labels", Rows(workspace.Labels.OrderBy(l => l.SortOrder), l => Merge(l.SettingsJson, ("id", l.Id), ("name", l.Name)))),
            ("links", Rows(workspace.Dependencies.OrderBy(d => d.SortOrder), d => Merge(d.SettingsJson,
                ("id", d.Id), ("source", d.SourceId), ("target", d.TargetId)))),
            ("tasks", Rows(workspace.Tasks.OrderBy(t => t.SortOrder), t => Merge(t.SettingsJson,
                ("id", t.Id), ("name", t.Name), ("referenceId", t.ReferenceId), ("status", t.Status), ("objective", t.Objective),
                ("parentId", t.ParentId), ("position", new JsonObject { ["x"] = t.PositionX, ["y"] = t.PositionY }),
                ("projectIds", Rows(t.Projects.OrderBy(p => p.SortOrder), p => JsonValue.Create(p.ProjectId))),
                ("labels", Rows(t.Labels.OrderBy(l => l.SortOrder).Select(l => names.GetValueOrDefault(l.LabelId))
                    .Where(name => name is not null).Distinct(StringComparer.Ordinal), name => JsonValue.Create(name))),
                ("activity", Rows(t.Activities.OrderBy(a => a.SortOrder), a =>
                {
                    var row = Merge(a.SettingsJson, ("id", a.Id), ("text", a.Text), ("at", a.OccurredAt),
                        ("author", a.Author), ("authorType", a.AuthorType));
                    if (a.AuthorId is not null) row["authorId"] = a.AuthorId;
                    if (a.Kind is not null) row["kind"] = a.Kind;
                    if (a.Commit is not null) row["commit"] = a.Commit;
                    return row;
                }))))));
    }

    private static void Sync<T>(List<T> rows, JsonArray input, Func<T, string> key, Func<JsonNode, string> inputKey,
        Func<string, T> create, Action<T, JsonNode, int> update)
    {
        var existing = rows.ToDictionary(key, StringComparer.Ordinal);
        var keep = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < input.Count; index++)
        {
            var node = input[index]!;
            var id = inputKey(node);
            if (!keep.Add(id)) throw new InvalidOperationException("Duplicate workspace relationship.");
            if (!existing.TryGetValue(id, out var row)) { row = create(id); rows.Add(row); }
            update(row, node, index);
        }
        rows.RemoveAll(row => !keep.Contains(key(row)));
    }
    private static string Id(JsonNode node) => node["id"]!.GetValue<string>();

    public static void Write(WorkspaceDocument workspace, string json)
    {
        var data = Object(json);
        var map = data["map"]?.AsObject() ?? new JsonObject();
        workspace.Name = Text(map, "name");
        workspace.Kind = Text(map, "kind", "coding");
        workspace.RepositoryUrl = Text(map, "repositoryUrl");
        workspace.RepositoryLayout = Text(map, "repositoryLayout", workspace.RepositoryUrl.Length > 0 ? "monorepo" : "multirepo");
        workspace.MapSettingsJson = Extras(map, "name", "kind", "repositoryUrl", "repositoryLayout");
        workspace.SettingsJson = Extras(data, "version", "map", "projects", "tasks", "labels", "links");
        Sync(workspace.Projects, Array(data, "projects"), p => p.Id, Id,
            id => new WorkspaceProject { WorkspaceId = workspace.Id, Id = id }, (p, node, order) =>
            {
                var row = node.AsObject(); p.SortOrder = order; p.Name = Text(row, "name"); p.RepositoryUrl = Text(row, "repositoryUrl");
                p.SettingsJson = Extras(row, "id", "name", "repositoryUrl");
            });
        Sync(workspace.Labels, Array(data, "labels"), l => l.Id, Id,
            id => new WorkspaceLabel { WorkspaceId = workspace.Id, Id = id }, (l, node, order) =>
            {
                var row = node.AsObject(); l.SortOrder = order; l.Name = Text(row, "name"); l.SettingsJson = Extras(row, "id", "name");
            });
        var labelIds = LabelIds(workspace.Labels.Select(label => (label.Id, label.Name)));
        Sync(workspace.Tasks, Array(data, "tasks"), t => t.Id, Id,
            id => new WorkspaceTask { WorkspaceId = workspace.Id, Id = id }, (t, node, order) =>
            {
                var row = node.AsObject(); t.SortOrder = order; t.Name = Text(row, "name"); t.ReferenceId = Text(row, "referenceId");
                t.Status = Text(row, "status", "todo"); t.Objective = Text(row, "objective"); t.ParentId = row["parentId"]?.GetValue<string>();
                t.PositionX = row["position"]?["x"]?.GetValue<double>() ?? 0; t.PositionY = row["position"]?["y"]?.GetValue<double>() ?? 0;
                t.SettingsJson = Extras(row, "id", "name", "referenceId", "status", "objective", "parentId", "position", "projectIds", "labels", "activity");
                Sync(t.Projects, Array(row, "projectIds"), p => p.ProjectId, n => n.GetValue<string>(),
                    id => new WorkspaceProjectTask { WorkspaceId = workspace.Id, TaskId = t.Id, ProjectId = id }, (p, _, i) => p.SortOrder = i);
                Sync(t.Labels, LabelRefs(Array(row, "labels"), labelIds), l => l.LabelId, n => n.GetValue<string>(),
                    id => new WorkspaceTaskLabel { WorkspaceId = workspace.Id, TaskId = t.Id, LabelId = id }, (l, _, i) => l.SortOrder = i);
                Sync(t.Activities, Array(row, "activity"), a => a.Id, Id,
                    id => new WorkspaceTaskActivity { WorkspaceId = workspace.Id, TaskId = t.Id, Id = id }, (a, activity, i) =>
                    {
                        var item = activity.AsObject(); a.SortOrder = i; a.Text = Text(item, "text"); a.OccurredAt = Text(item, "at");
                        a.Author = Text(item, "author"); a.AuthorType = Text(item, "authorType", "user");
                        a.AuthorId = item["authorId"]?.GetValue<string>(); a.Kind = item["kind"]?.GetValue<string>();
                        a.Commit = item["commit"]?.GetValue<string>();
                        a.PathsJson = null;
                        a.SettingsJson = Extras(item, "id", "text", "at", "author", "authorType", "authorId", "kind", "paths", "commit");
                    });
            });
        Sync(workspace.Dependencies, Array(data, "links"), d => d.Id, Id,
            id => new WorkspaceDependency { WorkspaceId = workspace.Id, Id = id }, (d, node, order) =>
            {
                var row = node.AsObject(); d.SortOrder = order; d.SourceId = Text(row, "source"); d.TargetId = Text(row, "target");
                d.SettingsJson = Extras(row, "id", "source", "target");
            });
    }
}
