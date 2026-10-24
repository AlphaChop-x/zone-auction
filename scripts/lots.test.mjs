// Integration checks against a controlled HTTP source. These are NOT live API checks.
// Build backend first, then: node --test scripts/lots.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = 'http://127.0.0.1:5089';
let backend, mode = 'normal', tokens = 0, requests = 0, active = 0, peak = 0;
let delay = 0, rejectedToken = '', remainingHeader = false;
let tokenLifetime = 3600, rejectOAuth = false;
const times = [];
const forms = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const mock = createServer(async (req, res) => {
  if (req.url === '/token') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    forms.push(new URLSearchParams(Buffer.concat(chunks).toString()));
    tokens++;
    if (rejectOAuth) { res.writeHead(400); res.end('PRIVATE token diagnostic'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ access_token: `test-token-${tokens}`, token_type: 'Bearer', expires_in: tokenLifetime }));
    return;
  }
  requests++; active++; peak = Math.max(peak, active); times.push(Date.now());
  const url = new URL(req.url, 'http://mock');
  const offset = Number(url.searchParams.get('offset'));
  assert.equal(url.searchParams.get('sort'), 'buyout_price');
  assert.equal(url.searchParams.get('order'), 'asc');
  assert.equal(url.searchParams.get('additional'), 'false');
  assert.match(req.headers.authorization, /^Bearer test-token-/);
  const thisMode = mode;
  await pause(delay);
  active--;
  if (thisMode === 'timeout') { await pause(1500); }
  if (res.destroyed) return;
  if (thisMode === 'authAlways' || (thisMode === 'authOnce' && req.headers.authorization === rejectedToken)) {
    res.writeHead(401); res.end('PRIVATE diagnostic must not escape'); return;
  }
  if (thisMode === 'forbidden') { res.writeHead(403); res.end('PRIVATE'); return; }
  if (thisMode === 'rate' || thisMode === 'rateNoHeader' || thisMode === 'rateDate') {
    if (thisMode === 'rate') res.setHeader('Retry-After', '2');
    if (thisMode === 'rateDate') res.setHeader('Retry-After', new Date(Date.now() + 2500).toUTCString());
    res.writeHead(429); res.end('PRIVATE'); return;
  }
  if (thisMode === 'unavailable') { res.writeHead(503); res.end('PRIVATE'); return; }
  if (thisMode === 'badJson') { res.end('{'); return; }
  res.setHeader('content-type', 'application/json');
  if (remainingHeader) {
    remainingHeader = false;
    res.setHeader('X-Ratelimit-Remaining', '0');
    res.setHeader('X-Ratelimit-Reset', String(Date.now() + 1500));
  }
  const lot = { itemId: url.pathname.split('/')[3], amount: 2,
    startPrice: 9223372036854775807n, buyoutPrice: 0, startTime: '2026-10-24T11:00:00+03:00',
    endTime: '2026-10-25T11:00:00+03:00', additional: {} };
  const lots = thisMode === 'empty' ? [] : [lot, { ...lot, buyoutPrice: 500, currentPrice: 70 }];
  // Serialize Int64 literally, avoiding JavaScript Number rounding in the fake source too.
  let body = JSON.stringify({ total: thisMode === 'empty' ? 100 : 6, lots }, (_, value) =>
    typeof value === 'bigint' ? 'INT64_SENTINEL' : value).replaceAll('"INT64_SENTINEL"', '9223372036854775807');
  if (thisMode === 'wrongItem') body = body.replaceAll(lot.itemId, 'wrong');
  res.end(body);
});
before(async () => {
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const source = `http://127.0.0.1:${mock.address().port}/`;
  backend = spawn('dotnet', ['bin/Debug/net10.0/ZoneAuction.Api.dll', '--urls', base], {
    cwd: fileURLToPath(new URL('../backend/', import.meta.url)), stdio: 'ignore',
    env: { ...process.env, Stalcraft__ApiBaseUrl: source, Stalcraft__TokenUrl: source + 'token',
      Stalcraft__ClientId: 'test-id', Stalcraft__ClientSecret: 'test-secret-not-real',
      Stalcraft__RequestTimeoutSeconds: '1', Stalcraft__MinimumRequestIntervalMs: '40',
      Stalcraft__CacheSeconds: '1', Stalcraft__ErrorCacheSeconds: '1', Stalcraft__MaxPendingPages: '3' }
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await pause(100);
  }
  throw new Error('Test backend did not start');
});
after(() => { backend?.kill(); mock.closeAllConnections(); mock.close(); });
const get = (offset = 0, id = '3g6p5', extra = '') => fetch(`${base}/api/items/${id}/lots?offset=${offset}&limit=1${extra}`);

test('unknown ID and invalid pagination never contact source', async () => {
  assert.equal((await get(0, 'UNKNOWN')).status, 404);
  for (const extra of ['&limit=0', '&offset=-1', '&limit=201', '&limit=oops']) assert.equal((await get(0, '3g6p5', extra)).status, 400);
  assert.equal(requests, 0); assert.equal(tokens, 0);
});
test('exact decimal strings, UTC, optional currentPrice, zero buyout, raw page length', async () => {
  const response = await get(); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await response.json();
  assert.equal(page.items[0].startPrice, '9223372036854775807');
  assert.equal(page.items[0].buyoutPrice, null); assert.equal(page.items[0].currentPrice, null);
  assert.equal(page.items[1].buyoutPrice, '500'); assert.equal(page.items[1].currentPrice, '70');
  assert.equal(page.items[0].startTime, '2026-10-24T08:00:00Z');
  assert.equal(page.nextOffset, 2); assert.equal(page.hasMore, true); // source returned two despite limit=1
  assert.equal(page.items.length, 2); assert.notEqual(page.items[0].id, page.items[1].id);
  assert.equal(forms[0].get('grant_type'), 'client_credentials');
  assert.equal(forms[0].get('scope'), ''); assert(forms[0].has('scope'));
  assert.equal(forms[0].get('client_id'), 'test-id');
  assert(!JSON.stringify(page).includes('test-token')); assert(!JSON.stringify(page).includes('test-secret'));
  const cached = await (await get()).json(); assert.deepEqual(cached, page); assert.equal(requests, 1); assert.equal(tokens, 1);
  const next = await (await get(2)).json(); assert.equal(next.nextOffset, 4); assert.notEqual(next.pageId, page.pageId);
});
test('single flight, disconnected waiter, bounded queue, common rate gate and token reuse', async () => {
  delay = 150;
  const before = requests;
  const responses = await Promise.all(Array.from({ length: 12 }, () => get(10)));
  const pages = await Promise.all(responses.map(r => r.json()));
  assert(pages.every(page => page.pageId === pages[0].pageId)); assert.equal(requests - before, 1);
  const abort = new AbortController();
  const canceled = fetch(`${base}/api/items/3g6p5/lots?offset=11&limit=1`, { signal: abort.signal }).catch(() => null);
  const survivor = get(11); await pause(30); abort.abort(); await canceled;
  assert.equal((await survivor).status, 200);
  const queue = await Promise.all([get(12), get(13), get(14), get(15)]);
  assert(queue.some(r => r.status === 503)); assert.equal(peak, 1); assert.equal(tokens, 1);
  assert(times.every((time, index) => index === 0 || time - times[index - 1] >= 25));
  delay = 0;
});
test('expired cache yields a new page and original fetchedAt is preserved on hits', async () => {
  const old = await (await get(20)).json(); await pause(1100);
  const fresh = await (await get(20)).json(); assert.notEqual(old.pageId, fresh.pageId);
  assert(new Date(fresh.fetchedAt) > new Date(old.fetchedAt)); assert.equal(tokens, 1);
});
test('empty source page stops pagination even when total is inconsistent; bad data is not empty', async () => {
  mode = 'empty'; const empty = await (await get(30)).json();
  assert.deepEqual(empty.items, []); assert.equal(empty.hasMore, false); assert.equal(empty.nextOffset, null);
  for (const [offset, value, code] of [[31, 'badJson', 'invalid_source_response'], [32, 'wrongItem', 'invalid_source_response'], [33, 'unavailable', 'source_unavailable']]) {
    mode = value; const response = await get(offset); assert.equal(response.status, 502);
    const body = await response.json(); assert.equal(body.code, code); assert(!JSON.stringify(body).includes('PRIVATE'));
  }
  mode = 'normal';
});
test('one reauthorization after 401, parallel callers share it; 403 does not reauthorize', async () => {
  mode = 'authOnce'; rejectedToken = `Bearer test-token-${tokens}`;
  const before = tokens;
  const responses = await Promise.all([get(40), get(41)]); assert(responses.every(r => r.status === 200));
  assert.equal(tokens - before, 1);
  mode = 'forbidden'; const count = tokens; assert.equal((await get(42)).status, 502); assert.equal(tokens, count);
  mode = 'authAlways'; const requestCount = requests;
  assert.equal((await get(43)).status, 502); assert.equal(requests - requestCount, 2); assert.equal(tokens - count, 1);
  mode = 'normal'; await pause(1100);
});
test('429 cooldown across different pages; delta, date and absent Retry-After', async () => {
  for (const [offset, value] of [[50, 'rate'], [52, 'rateDate'], [54, 'rateNoHeader']]) {
    mode = value; const before = requests; const response = await get(offset);
    assert.equal(response.status, 429); assert.equal((await response.json()).code, 'source_rate_limited');
    const retry = response.headers.get('retry-after');
    if (value === 'rateNoHeader') assert.equal(retry, null); else assert(Number(retry) > 0);
    assert.equal((await get(offset + 1)).status, 429); assert.equal(requests - before, 1);
    await pause(value === 'rateNoHeader' ? 1100 : 3100);
  }
  mode = 'normal';
});
test('token expires in memory and parallel page requests share its renewal', async () => {
  mode = 'authOnce'; rejectedToken = `Bearer test-token-${tokens}`; tokenLifetime = 1;
  assert.equal((await get(56)).status, 200);
  const before = tokens; mode = 'normal'; await pause(1100); tokenLifetime = 3600;
  assert((await Promise.all([get(57), get(58)])).every(response => response.status === 200));
  assert.equal(tokens - before, 1);
});
test('observed zero remaining + millisecond reset prevents another outgoing request', async () => {
  remainingHeader = true; const before = requests;
  assert.equal((await get(60)).status, 200); const response = await get(61);
  assert.equal(response.status, 429); assert(Number(response.headers.get('retry-after')) > 0);
  assert.equal(requests - before, 1); await pause(1600);
});
test('source timeout is HTTP 504, never an empty page', async () => {
  mode = 'timeout'; const response = await get(70);
  assert.equal(response.status, 504); assert.equal((await response.json()).code, 'source_timeout');
  mode = 'normal';
});
test('OAuth rejection is sanitized and is not retried indefinitely', async () => {
  mode = 'authAlways'; rejectOAuth = true;
  const before = tokens, count = requests;
  const response = await get(80); assert.equal(response.status, 502);
  const body = await response.json(); assert.equal(body.code, 'source_auth_failed');
  assert(!JSON.stringify(body).includes('PRIVATE')); assert.equal(tokens - before, 1); assert.equal(requests - count, 1);
});
