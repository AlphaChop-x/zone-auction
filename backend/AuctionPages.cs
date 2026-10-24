// Short bounded shared cache + single flight. A disconnected browser stops waiting,
// but does not cancel a shared source request needed by other browsers.
public sealed class AuctionPages(AuctionClient client, StalcraftOptions options, IHostApplicationLifetime lifetime)
{
    private sealed record Entry(LotPage? Page, AuctionError? Error, DateTimeOffset Expires);
    private readonly object sync = new();
    private readonly Dictionary<(string Id, int Offset, int Limit), Entry> cache = new();
    private readonly Dictionary<(string Id, int Offset, int Limit), Task<LotPage>> pending = new();

    public Task<LotPage> GetAsync(string id, int offset, int limit, CancellationToken cancellationToken)
    {
        Task<LotPage> task;
        var key = (id, offset, limit);
        lock (sync)
        {
            foreach (var expired in cache.Where(pair => pair.Value.Expires <= DateTimeOffset.UtcNow).Select(pair => pair.Key).ToArray())
                cache.Remove(expired);
            if (cache.TryGetValue(key, out var entry))
                return entry.Error is { } error ? Task.FromException<LotPage>(error) : Task.FromResult(entry.Page!);
            if (!pending.TryGetValue(key, out task!))
            {
                if (pending.Count >= options.MaxPendingPages)
                    return Task.FromException<LotPage>(new AuctionError(503, "server_busy", "Сервер занят запросами к источнику. Повторите позже."));
                var completion = new TaskCompletionSource<LotPage>(TaskCreationOptions.RunContinuationsAsynchronously);
                task = completion.Task;
                pending.Add(key, task);
                // Observe faults even when all browsers disconnect.
                _ = task.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                _ = FetchAsync(key, completion);
            }
        }
        return task.WaitAsync(cancellationToken);
    }

    private async Task FetchAsync((string Id, int Offset, int Limit) key, TaskCompletionSource<LotPage> completion)
    {
        // Ensure the pending task is installed before a synchronous fake HTTP handler can finish.
        await Task.Yield();
        try
        {
            var page = await client.GetAsync(key.Id, key.Offset, key.Limit, lifetime.ApplicationStopping);
            lock (sync) Store(key, new(page, null, DateTimeOffset.UtcNow.AddSeconds(options.CacheSeconds)));
            completion.TrySetResult(page);
        }
        catch (AuctionError error)
        {
            lock (sync) Store(key, new(null, error, error.RetryAt ?? DateTimeOffset.UtcNow.AddSeconds(options.ErrorCacheSeconds)));
            completion.TrySetException(error);
        }
        catch (OperationCanceledException) { completion.TrySetCanceled(); }
        catch (Exception) { completion.TrySetException(AuctionError.Unavailable()); }
        finally { lock (sync) pending.Remove(key); }
    }

    private void Store((string Id, int Offset, int Limit) key, Entry entry)
    {
        if (cache.Count >= options.MaxCachedPages)
            cache.Remove(cache.MinBy(pair => pair.Value.Expires).Key);
        cache[key] = entry;
    }
}
