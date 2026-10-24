using System.Globalization;
using System.Text.Json;

public sealed record AuctionLot(string Id, string ItemId, int Quantity, string StartPrice,
    string? CurrentPrice, string? BuyoutPrice, DateTime StartTime, DateTime EndTime);
public sealed record LotPage(AuctionLot[] Items, int Offset, int Limit, long? NextOffset,
    bool HasMore, long TotalCount, DateTime FetchedAt, string Source, string PageId);

public static class AuctionNormalizer
{
    public static LotPage Normalize(JsonElement root, string itemId, int offset, int limit, string source)
    {
        try
        {
            var total = root.GetProperty("total").GetInt64();
            var lots = root.GetProperty("lots");
            if (total < 0 || lots.ValueKind != JsonValueKind.Array)
                throw AuctionError.InvalidResponse();
            var pageId = Guid.NewGuid().ToString("N");
            var items = lots.EnumerateArray().Select((lot, index) =>
            {
                var quantity = lot.GetProperty("amount").GetInt32();
                if (lot.GetProperty("itemId").GetString() != itemId || quantity <= 0) throw AuctionError.InvalidResponse();
                var startPrice = Money(lot.GetProperty("startPrice"));
                var buyout = Money(lot.GetProperty("buyoutPrice"));
                var current = lot.TryGetProperty("currentPrice", out var currentValue) && currentValue.ValueKind != JsonValueKind.Null
                    ? Money(currentValue) : null;
                var start = lot.GetProperty("startTime").GetDateTimeOffset().UtcDateTime;
                var end = lot.GetProperty("endTime").GetDateTimeOffset().UtcDateTime;
                if (end < start) throw AuctionError.InvalidResponse();
                return new AuctionLot($"{pageId}:{index}", itemId, quantity, startPrice, current,
                    buyout == "0" ? null : buyout, start, end);
            }).ToArray();
            var next = (long)offset + items.Length;
            var hasMore = items.Length > 0 && next < total && next <= int.MaxValue;
            return new(items, offset, limit, hasMore ? next : null, hasMore, total, DateTime.UtcNow, source, pageId);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException or FormatException or OverflowException)
        { throw AuctionError.InvalidResponse(); }
    }

    private static string Money(JsonElement value)
    {
        decimal amount = value.GetDecimal();
        if (amount < 0 || amount != decimal.Truncate(amount) || amount > long.MaxValue) throw AuctionError.InvalidResponse();
        return amount.ToString("0", CultureInfo.InvariantCulture);
    }
}
