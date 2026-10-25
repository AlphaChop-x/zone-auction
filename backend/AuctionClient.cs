using System.Net.Http.Headers;

public sealed class AuctionClient(AuctionTransport transport, AuctionTokenProvider tokens, StalcraftOptions options)
{
    public async Task<LotPage> GetAsync(string id, int offset, int limit, CancellationToken cancellationToken)
    {
        var token = await tokens.GetAsync(cancellationToken);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                var path = $"RU/auction/{Uri.EscapeDataString(id)}/lots?offset={offset}&limit={limit}&sort=buyout_price&order=asc&additional=false";
                using var document = await transport.SendAsync(() =>
                {
                    var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(options.ApiBaseUrl), path));
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    return request;
                }, cancellationToken);
                return AuctionNormalizer.Normalize(document.RootElement, id, offset, limit, options.ApiBaseUrl);
            }
            catch (AuctionError error) when (error.Status == 401)
            {
                if (attempt != 0)
                {
                    await tokens.RejectAsync(token, cancellationToken);
                    throw AuctionError.Auth();
                }
                token = await tokens.GetAsync(cancellationToken, token);
            }
        }
        throw AuctionError.Auth();
    }
}
