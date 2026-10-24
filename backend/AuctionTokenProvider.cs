using System.Text.Json;

public sealed class AuctionTokenProvider(AuctionTransport transport, StalcraftOptions options)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private string? token;
    private DateTimeOffset refreshAt;
    private AuctionError? lastError;
    private DateTimeOffset retryAt;

    // rejectedToken lets parallel 401s reuse a token already refreshed by another caller.
    public async Task<string> GetAsync(CancellationToken cancellationToken, string? rejectedToken = null)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (token is not null && DateTimeOffset.UtcNow < refreshAt && token != rejectedToken) return token;
            if (token == rejectedToken) token = null;
            if (lastError is not null && DateTimeOffset.UtcNow < retryAt) throw lastError;
            if (string.IsNullOrWhiteSpace(options.ClientId) || string.IsNullOrWhiteSpace(options.ClientSecret))
                throw new AuctionError(503, "source_not_configured", "На сервере не настроен доступ к API лотов.");
            try
            {
                using var document = await transport.SendAsync(() => new HttpRequestMessage(HttpMethod.Post, options.TokenUrl)
                {
                    Content = new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        ["client_id"] = options.ClientId, ["client_secret"] = options.ClientSecret,
                        ["grant_type"] = "client_credentials", ["scope"] = ""
                    })
                }, cancellationToken);
                var root = document.RootElement;
                var value = root.GetProperty("access_token").GetString();
                var expires = root.GetProperty("expires_in").GetDouble();
                if (string.IsNullOrWhiteSpace(value) || !double.IsFinite(expires) || expires < 1 || expires > 315360000
                    || !string.Equals(root.GetProperty("token_type").GetString(), "Bearer", StringComparison.OrdinalIgnoreCase))
                    throw AuctionError.InvalidResponse();
                token = value;
                refreshAt = DateTimeOffset.UtcNow.AddSeconds(expires - Math.Min(60, expires / 10));
                lastError = null;
                return token;
            }
            catch (Exception error) when (error is AuctionError or JsonException or InvalidOperationException or KeyNotFoundException or FormatException)
            {
                lastError = error is AuctionError { Status: not 401 } known ? known : AuctionError.Auth();
                retryAt = lastError.RetryAt ?? DateTimeOffset.UtcNow.AddSeconds(options.ErrorCacheSeconds);
                throw lastError;
            }
        }
        finally { gate.Release(); }
    }

    public async Task RejectAsync(string rejectedToken, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (token != rejectedToken) return;
            token = null;
            lastError = AuctionError.Auth();
            retryAt = DateTimeOffset.UtcNow.AddSeconds(options.ErrorCacheSeconds);
        }
        finally { gate.Release(); }
    }
}
