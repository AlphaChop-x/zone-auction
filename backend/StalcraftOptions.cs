// Настройки будущего серверного адаптера. Реквизиты никогда не возвращаются клиенту.
public sealed class StalcraftOptions
{
    public const string SectionName = "Stalcraft";

    public string ApiBaseUrl { get; set; } = "https://eapi.stalzone.com/";
    public string TokenUrl { get; set; } = "https://exbo.net/oauth/token";
    public string Region { get; set; } = "RU";
    public int RequestTimeoutSeconds { get; set; } = 15;
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
}
