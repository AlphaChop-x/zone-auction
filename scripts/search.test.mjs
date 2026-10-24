// Native Node test runner; build backend first. No additional test dependencies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { itemName } from './item-name.mjs';

const catalog = JSON.parse(await readFile(new URL('../backend/Data/items.ru.json', import.meta.url), 'utf8'));
const url = 'http://127.0.0.1:5088';
let server;
before(async () => {
  server = spawn('dotnet', ['bin/Debug/net10.0/ZoneAuction.Api.dll', '--urls', url], {
    cwd: fileURLToPath(new URL('../backend/', import.meta.url)), stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${url}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test backend did not start');
});
after(() => server?.kill());
const search = async (params) => {
  const response = await fetch(`${url}/api/items?${new URLSearchParams(params)}`);
  assert.equal(response.status, 200);
  return response.json();
};

test('official name shapes: RU translation and literal text; no silent English fallback', () => {
  assert.equal(itemName({ type: 'translation', lines: { ru: 'Костюм', en: 'Suit' } }), 'Костюм');
  assert.equal(itemName({ type: 'text', text: '  АК-74  ' }), 'АК-74');
  assert.throws(() => itemName({ type: 'translation', lines: { en: 'Suit' } }));
});

test('real Russian substring, case and surrounding spaces give identical results', async () => {
  const normal = await search({ query: 'костюм', limit: '200' });
  const uppercase = await search({ query: '  КОСТЮМ  ', limit: '200' });
  assert.deepEqual(uppercase, normal);
  assert(normal.totalCount > 0);
  assert(normal.items.some(item => item.id === '3g6p5' && item.name === 'Костюм «Штрих»'));
  assert.equal(normal.catalogRevision, catalog.catalogRevision);
  assert.equal(normal.source, catalog.source);
});

test('empty query, stable pagination, last page and nonexistent name', async () => {
  const first = await search({ limit: '7' });
  const second = await search({ offset: '7', limit: '7' });
  const combined = await search({ limit: '14' });
  assert.deepEqual([...first.items, ...second.items], combined.items);
  assert.equal(first.totalCount, catalog.items.length);
  assert.deepEqual(await search({ query: '  ', limit: '7' }), first);
  const absent = await search({ query: 'несуществующий_предмет_987654321' });
  assert.equal(absent.totalCount, 0);
  assert.deepEqual(absent.items, []);
  assert.equal(absent.hasMore, false);
  const beyond = await search({ offset: '2147483647' });
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.hasMore, false);
});

test('invalid query and pagination return structured HTTP 400', async () => {
  for (const params of ['offset=-1', 'offset=abc', 'offset=2147483648', 'limit=0', 'limit=201', 'limit=1.5', 'limit=', 'limit=1&limit=2', 'query=a&query=b', `query=${'a'.repeat(201)}`]) {
    const response = await fetch(`${url}/api/items?${params}`);
    assert.equal(response.status, 400, params);
    const error = await response.json();
    assert.equal(error.code, 'invalid_parameters');
    assert(Object.keys(error.fieldErrors).length > 0);
  }
});

test('item IDs are preserved and exact-case lookup is enforced', async () => {
  const item = catalog.items.find(item => /[a-zA-Z]/.test(item.id));
  const response = await fetch(`${url}/api/items/${encodeURIComponent(item.id)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), item);
  const otherCase = item.id === item.id.toUpperCase() ? item.id.toLowerCase() : item.id.toUpperCase();
  if (!catalog.items.some(item => item.id === otherCase)) {
    assert.equal((await fetch(`${url}/api/items/${otherCase}`)).status, 404);
  }
  assert.equal((await fetch(`${url}/api/items/not-a-real-item`)).status, 404);
});
