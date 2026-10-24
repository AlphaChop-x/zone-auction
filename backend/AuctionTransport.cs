using System.Net;
using System.Text.Json;

// One instance for the entire backend, including OAuth. No request/response bodies logged.
public sealed class AuctionTransport(HttpClient client, StalcraftOptions options) : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private DateTimeOffset nextRequest;
    private DateTimeOffset? retryAt;
    private DateTimeOffset blockedUntil;
    private AuctionError? blockedError;

    public async Task<JsonDocument> SendAsync(Func<HttpRequestMessage> createRequest, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.RequestTimeoutSeconds));
        var entered = false;
        try
        {
            await gate.WaitAsync(timeout.Token);
            entered = true;
            if (DateTimeOffset.UtcNow < blockedUntil)
                throw blockedError ?? new AuctionError(429, "source_rate_limited", "Источник ограничил частоту запросов. Повторите позже.", retryAt);
            var delay = nextRequest - DateTimeOffset.UtcNow;
            if (delay > TimeSpan.Zero) await Task.Delay(delay, timeout.Token);
            using var request = createRequest();
            nextRequest = DateTimeOffset.UtcNow.AddMilliseconds(options.MinimumRequestIntervalMs);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            // Observed production reset is Unix milliseconds. Do not guess an interval from the limit alone.
            if (response.Headers.TryGetValues("X-Ratelimit-Remaining", out var remaining)
                && long.TryParse(remaining.FirstOrDefault(), out var count) && count == 0)
            {
                DateTimeOffset? reset = null;
                if (response.Headers.TryGetValues("X-Ratelimit-Reset", out var resets)
                    && long.TryParse(resets.FirstOrDefault(), out var milliseconds) && milliseconds is > 0 and < 253402300800000)
                    reset = DateTimeOffset.FromUnixTimeMilliseconds(milliseconds);
                retryAt = reset;
                blockedUntil = reset ?? DateTimeOffset.UtcNow.AddSeconds(options.ErrorCacheSeconds);
                blockedError = new(429, "source_rate_limited", "Лимит источника исчерпан. Повторите позже.", reset);
            }
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                retryAt = GetRetryAt(response);
                // Unknown delay is a local backoff, never represented as the provider's Retry-After.
                blockedUntil = retryAt ?? DateTimeOffset.UtcNow.AddSeconds(options.ErrorCacheSeconds);
                blockedError = new(429, "source_rate_limited", "Источник ограничил частоту запросов. Повторите позже.", retryAt);
                throw blockedError;
            }
            if (response.StatusCode == HttpStatusCode.Unauthorized)
                throw new AuctionError(401, "upstream_unauthorized", "Авторизация источника отклонена.");
            if (response.StatusCode == HttpStatusCode.Forbidden) throw AuctionError.Auth();
            if (response.StatusCode == HttpStatusCode.BadRequest && request.Method == HttpMethod.Post) throw AuctionError.Auth();
            if (!response.IsSuccessStatusCode)
            {
                var error = new AuctionError(502, "source_unavailable", "Источник лотов недоступен. Повторите запрос позже.", GetRetryAt(response));
                if (error.RetryAt is { } until) { blockedUntil = until; blockedError = error; }
                throw error;
            }
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            return await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AuctionError(504, "source_timeout", "Источник не ответил вовремя. Повторите запрос.");
        }
        catch (HttpRequestException) { throw AuctionError.Unavailable(); }
        catch (JsonException) { throw AuctionError.InvalidResponse(); }
        finally { if (entered) gate.Release(); }
    }

    private static DateTimeOffset? GetRetryAt(HttpResponseMessage response)
    {
        var header = response.Headers.RetryAfter;
        return header?.Date?.ToUniversalTime() ?? (header?.Delta is { } delta ? DateTimeOffset.UtcNow.Add(delta) : null);
    }

    public void Dispose() { gate.Dispose(); client.Dispose(); }
}
