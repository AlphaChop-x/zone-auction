var builder = WebApplication.CreateBuilder(args);

// Локальный файл не отслеживается Git; переменные окружения имеют приоритет.
builder.Configuration
    .AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false)
    .AddEnvironmentVariables();
builder.Services.Configure<StalcraftOptions>(
    builder.Configuration.GetSection(StalcraftOptions.SectionName));
builder.Services.AddSingleton(new ItemCatalog(Path.Combine(builder.Environment.ContentRootPath, "Data", "items.ru.json")));
var auctionOptions = builder.Configuration.GetSection(StalcraftOptions.SectionName).Get<StalcraftOptions>()!;
if (auctionOptions.RequestTimeoutSeconds is < 1 or > 120 || auctionOptions.MinimumRequestIntervalMs is < 0 or > 60000
    || auctionOptions.CacheSeconds is < 1 or > 60 || auctionOptions.ErrorCacheSeconds is < 1 or > 60
    || auctionOptions.MaxCachedPages is < 1 or > 10000 || auctionOptions.MaxPendingPages is < 1 or > 100
    || auctionOptions.Region != "RU"
    || !Uri.TryCreate(auctionOptions.ApiBaseUrl, UriKind.Absolute, out _) || !Uri.TryCreate(auctionOptions.TokenUrl, UriKind.Absolute, out _))
    throw new InvalidOperationException("Invalid server auction settings.");
builder.Services.AddSingleton(auctionOptions);
builder.Services.AddSingleton(provider => new AuctionTransport(new HttpClient(new SocketsHttpHandler
{
    AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5)
}) { Timeout = Timeout.InfiniteTimeSpan }, provider.GetRequiredService<StalcraftOptions>()));
builder.Services.AddSingleton<AuctionTokenProvider>();
builder.Services.AddSingleton<AuctionClient>();
builder.Services.AddSingleton<AuctionPages>();

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

app.MapGet("/api/items/{id}/lots", async (string id, HttpContext context, ItemCatalog catalog, AuctionPages pages) =>
{
    if (catalog.Find(id) is null)
        return Results.NotFound(new { code = "item_not_found", message = "Предмет не найден в справочнике." });
    var errors = new Dictionary<string, string>();
    int Parse(string name, int fallback, int min, int max)
    {
        var query = context.Request.Query;
        if (!query.ContainsKey(name)) return fallback;
        if (query[name].Count != 1 || !int.TryParse(query[name], out var value) || value < min || value > max)
        {
            errors[name] = $"Ожидается целое число от {min} до {max}.";
            return fallback;
        }
        return value;
    }
    var offset = Parse("offset", 0, 0, int.MaxValue);
    var limit = Parse("limit", 20, 1, 200);
    if (errors.Count > 0)
        return Results.BadRequest(new { code = "invalid_parameters", message = "Проверьте параметры лотов.", fieldErrors = errors });
    // Browser/proxy caches must not substitute an older page after manual refresh.
    context.Response.Headers.CacheControl = "no-store";
    try
    {
        return Results.Ok(await pages.GetAsync(id, offset, limit, context.RequestAborted));
    }
    catch (AuctionError error)
    {
        if (error.RetryAt is { } retryAt)
            context.Response.Headers.RetryAfter = Math.Max(0, (long)Math.Ceiling((retryAt - DateTimeOffset.UtcNow).TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Results.Json(new { code = error.Code, message = error.Message }, statusCode: error.Status);
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    { return Results.StatusCode(499); }
});

app.Run();
