// Реквизиты никогда не возвращаются клиенту.
public sealed class StalcraftOptions
{
    public const string SectionName = "Stalcraft";

    public string ApiBaseUrl { get; set; } = "https://eapi.stalzone.com/";
    public string TokenUrl { get; set; } = "https://exbo.net/oauth/token";
    public string Region { get; set; } = "RU";
    public int RequestTimeoutSeconds { get; set; } = 15;
    // Application policies, not published provider limits.
    public int MinimumRequestIntervalMs { get; set; } = 1000;
    public int CacheSeconds { get; set; } = 10;
    public int ErrorCacheSeconds { get; set; } = 2;
    public int MaxCachedPages { get; set; } = 256;
    public int MaxPendingPages { get; set; } = 16;
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
}
