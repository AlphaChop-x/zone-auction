using System.Text.Json;

public sealed record CatalogItem(string Id, string Name, string Category, string? IconUrl);
public sealed record ItemPage(CatalogItem[] Items, int Offset, int Limit, bool HasMore,
    int TotalCount, string Source, string CatalogRevision);

public sealed class ItemCatalog
{
    private sealed record CatalogData(string Source, string CatalogRevision, CatalogItem[] Items);
    private readonly CatalogData data;
    private readonly CatalogItem[] ordered;
    private readonly Dictionary<string, CatalogItem> byId;

    public ItemCatalog(string path)
    {
        data = JsonSerializer.Deserialize<CatalogData>(File.ReadAllText(path),
            new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidDataException("Invalid item catalog");
        ordered = data.Items.OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Id, StringComparer.Ordinal).ToArray();
        byId = ordered.ToDictionary(item => item.Id, StringComparer.Ordinal);
    }

    public ItemPage Search(string? query, int offset, int limit)
    {
        var normalized = (query ?? "").Trim();
        var matches = ordered.Where(item => item.Name.Contains(normalized, StringComparison.OrdinalIgnoreCase)).ToArray();
        var items = matches.Skip(offset).Take(limit).ToArray();
        return new(items, offset, limit, (long)offset + items.Length < matches.Length,
            matches.Length, data.Source, data.CatalogRevision);
    }

    public CatalogItem? Find(string id) => byId.GetValueOrDefault(id);
}
