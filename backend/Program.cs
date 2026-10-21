var builder = WebApplication.CreateBuilder(args);

// Локальный файл не отслеживается Git; переменные окружения имеют приоритет.
builder.Configuration
    .AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false)
    .AddEnvironmentVariables();
builder.Services.Configure<StalcraftOptions>(
    builder.Configuration.GetSection(StalcraftOptions.SectionName));

var app = builder.Build();

// Проверяет только наш сервер, не авторизацию и не доступность внешнего API.
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.Run();
