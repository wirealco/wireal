using System.Text.Json.Nodes;

namespace Wireal.Api.Projects;

public sealed record QueryFilter(string Field, string Op, JsonNode? Value);
public sealed record QueryOrder(string Field, bool Ascending = true);
public sealed record DataQuery(string Table, string Operation = "select", string Columns = "*",
    QueryFilter[]? Filters = null, QueryFilter[][]? Any = null, QueryOrder[]? Order = null,
    int Offset = 0, int Limit = 1000, string? Single = null, bool Count = false, bool Head = false, JsonObject? Values = null);
public sealed record DataResult(object? Data, object? Error = null, int? Count = null);
public sealed class DataFault(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public static class DataQueries
{
    public static DataResult Result(IEnumerable<JsonObject> rows, DataQuery query, int? count = null)
    {
        var projected = rows.Select(row => query.Columns == "*" ? row : new JsonObject(query.Columns.Split(',')
            .Select(x => x.Trim()).Where(x => x.Length > 0).Select(key => KeyValuePair.Create(key, row[key]?.DeepClone())))).ToArray();
        if (query.Single is not null && (projected.Length > 1 || query.Single == "required" && projected.Length == 0))
            throw new DataFault("Expected one record.", 404);
        return new(query.Head ? null : query.Single is not null ? projected.FirstOrDefault() : projected, Count: count);
    }

    public static void Validate(DataQuery query)
    {
        if (query.Offset < 0 || query.Limit is < 1 or > 1000 || query.Columns.Length > 2000 ||
            (query.Filters?.Length ?? 0) > 30 || (query.Any?.Length ?? 0) > 10 ||
            (query.Any ?? []).Any(x => x.Length > 20) || (query.Order?.Length ?? 0) > 5 ||
            query.Single is not (null or "required" or "optional")) throw new DataFault("Invalid query.");
        foreach (var f in (query.Filters ?? []).Concat((query.Any ?? []).SelectMany(x => x)))
            if (f.Op == "in" && (f.Value is not JsonArray a || a.Count > 1000) ||
                f.Value?.ToJsonString().Length > 100_000) throw new DataFault("Invalid filter.");
    }
}
