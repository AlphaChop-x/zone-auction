public sealed class AuctionError(int status, string code, string message, DateTimeOffset? retryAt = null)
    : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public DateTimeOffset? RetryAt { get; } = retryAt;

    public static AuctionError Unavailable() => new(502, "source_unavailable", "Источник лотов недоступен. Повторите запрос позже.");
    public static AuctionError InvalidResponse() => new(502, "invalid_source_response", "Источник вернул некорректные данные. Повторите запрос позже.");
    public static AuctionError Auth() => new(502, "source_auth_failed", "Не удалось авторизовать сервер в API источника.");
}
