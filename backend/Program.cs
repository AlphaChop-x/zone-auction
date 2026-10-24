var builder = WebApplication.CreateBuilder(args);

// Локальный файл не отслеживается Git; переменные окружения имеют приоритет.
builder.Configuration
    .AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false)
    .AddEnvironmentVariables();
builder.Services.Configure<StalcraftOptions>(
    builder.Configuration.GetSection(StalcraftOptions.SectionName));
builder.Services.AddSingleton(new ItemCatalog(Path.Combine(builder.Environment.ContentRootPath, "Data", "items.ru.json")));

var app = builder.Build();

// Проверяет только наш сервер, не авторизацию и не доступность внешнего API.
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/items", (HttpRequest request, ItemCatalog catalog) =>
{
    var errors = new Dictionary<string, string>();
    var query = request.Query["query"].ToString().Trim();
    if (query.Length > 200) errors["query"] = "Не более 200 символов.";
    int Parse(string name, int fallback, int min, int max)
    {
        if (!request.Query.ContainsKey(name)) return fallback;
        if (request.Query[name].Count != 1 || !int.TryParse(request.Query[name], out var value) || value < min || value > max)
        {
            errors[name] = $"Ожидается целое число от {min} до {max}.";
            return fallback;
        }
        return value;
    }
    if (request.Query["query"].Count > 1) errors["query"] = "Укажите один запрос.";
    var offset = Parse("offset", 0, 0, int.MaxValue);
    var limit = Parse("limit", 20, 1, 200);
    return errors.Count > 0
        ? Results.BadRequest(new { code = "invalid_parameters", message = "Проверьте параметры поиска.", fieldErrors = errors })
        : Results.Ok(catalog.Search(query, offset, limit));
});

app.MapGet("/api/items/{id}", (string id, ItemCatalog catalog) =>
    catalog.Find(id) is { } item ? Results.Ok(item)
        : Results.NotFound(new { code = "item_not_found", message = "Предмет не найден." }));

app.Run();
