// Reproducible browser checks with controlled API responses; no live auction credentials.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { join } from 'node:path';

let server, browser;
const origin = 'http://127.0.0.1:5181';
const fetchedAt = '2026-10-24T07:00:00Z';
const item = { id: 'test-item', name: 'Контрольный предмет с длинным названием', category: 'test/category', iconUrl: null };
const makeLot = (id, quantity, buyoutPrice) => ({
  id, itemId: item.id, quantity, buyoutPrice, startPrice: '10', currentPrice: null,
  startTime: '2026-10-23T00:00:00Z', endTime: '2026-10-27T10:00:00Z',
});
const lots = [makeLot('page:A', 2, '100'), makeLot('page:B', 1, '70'), makeLot('page:C', 1, null)];
const pageData = (offset = 0) => ({
  items: offset === 0 ? lots : [makeLot('next:D', 10, '200')], offset, limit: 20,
  nextOffset: offset === 0 ? 3 : null, hasMore: offset === 0, totalCount: 4,
  fetchedAt: offset === 0 ? fetchedAt : '2026-10-24T08:00:00Z', source: 'https://eapi.stalzone.com/', pageId: `page-${offset}`,
});

before(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 5181, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function scenario(run) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], calls = [];
  const control = { lots: 'ok', search: 'ok', delay: 0 };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/lots')) {
      const offset = Number(url.searchParams.get('offset')); calls.push(offset);
      const mode = control.lots;
      if (control.delay) await new Promise(resolve => setTimeout(resolve, control.delay));
      if (mode === 'error' || mode === 'rate') return route.fulfill({ status: mode === 'rate' ? 429 : 503,
        headers: mode === 'rate' ? { 'Retry-After': '2' } : {}, json: { message: 'Контрольная ошибка источника' } });
      const data = pageData(offset);
      if (mode === 'empty') { data.items = []; data.hasMore = false; data.nextOffset = null; }
      if (mode === 'invalid') data.items = [makeLot('invalid', 0, '100')];
      return route.fulfill({ json: data });
    }
    if (url.pathname === '/api/items') {
      const mode = control.search;
      if (control.delay) await new Promise(resolve => setTimeout(resolve, control.delay));
      if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'Контрольная ошибка поиска' } });
      return route.fulfill({ json: { items: mode === 'empty' ? [] : [item], totalCount: mode === 'empty' ? 0 : 1,
        offset: 0, limit: 20, hasMore: false, source: 'https://github.com/EXBO-Studio/stalzone-database', catalogRevision: 'test-revision' } });
    }
    if (url.pathname === `/api/items/${item.id}`) return route.fulfill({ json: item });
    return route.fulfill({ status: 404, json: { message: 'Неизвестный предмет' } });
  });
  try { await run(page, control, calls); assert.deepEqual(errors, []); }
  finally { await page.close(); }
}
const heading = (page, name) => page.getByRole('heading', { name, exact: true }).waitFor();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const openList = async page => { await page.goto(`${origin}/items/${item.id}/lots`, { waitUntil: 'networkidle' }); await page.locator('tbody tr').first().waitFor(); };
const apply = page => button(page, 'Применить фильтры').click();
const shown = (page, count, total) => page.getByRole('status').filter({ hasText: `Показано ${count} из ${total} загруженных` }).waitFor();

test('selected details, exact unit price, saved pages/drafts/sort, explicit return and browser Back/Forward', async () => scenario(async (page, control, calls) => {
  await page.goto(`${origin}/?query=контрольный`);
  await page.getByRole('link', { name: new RegExp(item.name) }).click();
  await page.locator('tbody tr').first().waitFor();
  await button(page, 'Загрузить ещё').click(); await shown(page, 4, 4);
  await page.getByLabel('Выкуп от', { exact: true }).fill('80'); await apply(page); await shown(page, 2, 4);
  await page.getByRole('button', { name: /^Выкуп за шт\./ }).click();
  await page.getByLabel('Выкуп до', { exact: true }).fill('999'); // Preserve an unapplied draft, too.
  const links = () => page.locator('tbody a');
  const original = await links().evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  const selected = page.locator('tbody a[href$="page%3AA"]');
  await selected.focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert(await selected.evaluate(node => node === document.activeElement));
  assert.notEqual(await selected.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  await page.keyboard.press('Enter');
  await heading(page, item.name);
  assert.match(await page.locator('dl').innerText(), /50,00 ₽\/шт\./);
  assert.match(await page.locator('.lot-warning').innerText(), /измениться или исчезнуть/);
  assert.equal(await page.locator('time').last().getAttribute('datetime'), fetchedAt);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  const before = calls.length;
  await page.goBack(); await shown(page, 2, 4);
  assert.equal(await page.getByLabel('Выкуп до', { exact: true }).inputValue(), '999');
  assert.deepEqual(await links().evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), original);
  await page.goForward(); await heading(page, item.name);
  await page.getByRole('link', { name: 'К лотам предмета', exact: true }).click(); await shown(page, 2, 4);
  assert.equal(calls.length, before, 'return must not reload the auction');
  await page.getByRole('link', { name: 'Вернуться к поиску' }).click();
  assert.equal(new URL(page.url()).searchParams.get('query'), 'контрольный');
}));

test('360 / 768 / 1440 layouts, keyboard actions, no-buyout and invalid quantity details', async () => scenario(async (page, control) => {
  await openList(page);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `list overflow at ${width}`);
    if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, `zone-list-final-${width}.png`), fullPage: true });
    await page.locator('tbody a[href$="page%3AC"]').focus(); await page.keyboard.press('Enter');
    await heading(page, item.name);
    assert.match(await page.locator('dl').innerText(), /Не рассчитывается: нет выкупа/);
    assert.doesNotMatch(await page.locator('dl').innerText(), /0,00 ₽\/шт\./);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `details overflow at ${width}`);
    if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, `zone-details-final-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'К лотам предмета', exact: true }).click(); await shown(page, 3, 3);
  }
  control.lots = 'invalid';
  await button(page, 'Обновить').click(); await shown(page, 1, 1);
  await page.locator('tbody a').click(); await heading(page, item.name);
  assert.match(await page.locator('dl').innerText(), /Не рассчитывается: некорректное количество/);
}));

test('unavailable direct, missing, reloaded and stale details never substitute a different lot', async () => scenario(async (page, control) => {
  await page.goto(`${origin}/items/${item.id}/lots/page%3AA`);
  await heading(page, 'Лот недоступен в загруженном наборе');
  await page.getByRole('link', { name: 'К лотам предмета', exact: true }).click(); await shown(page, 3, 3);
  await page.locator('tbody a').first().click(); await heading(page, item.name);
  await page.reload(); await heading(page, 'Лот недоступен в загруженном наборе');
  assert.equal(await page.locator('dl').count(), 0);
  await page.getByRole('link', { name: 'К лотам предмета', exact: true }).click(); await shown(page, 3, 3);
  // Client-side navigation to an absent key while a valid set is loaded.
  await page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, `/items/${item.id}/lots/missing`);
  await heading(page, 'Лот недоступен в загруженном наборе');
  assert.equal(await page.locator('dl').count(), 0);
  await page.getByRole('link', { name: 'К лотам предмета', exact: true }).click(); await shown(page, 3, 3);
  await page.locator('tbody a').first().click(); await heading(page, item.name);
  await page.goBack(); await shown(page, 3, 3);
  control.lots = 'empty'; await button(page, 'Обновить').click(); await heading(page, 'Лотов нет');
  await page.goForward(); await heading(page, 'Лот недоступен в загруженном наборе');
  assert.equal(await page.locator('dl').count(), 0);
}));

test('search initial/loading/empty/error/retry and unknown item', async () => scenario(async (page, control) => {
  await page.goto(origin); await heading(page, 'Какой предмет ищем?');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  control.delay = 500; control.search = 'empty';
  await page.getByLabel('Найти предмет по названию').fill('ничего');
  await page.getByText('Ищем предметы…', { exact: true }).waitFor();
  await heading(page, 'Предметы не найдены');
  control.search = 'error'; await button(page, 'Найти').click(); await heading(page, 'Не удалось загрузить предметы');
  control.search = 'ok'; control.delay = 0; await button(page, 'Повторить запрос').click();
  await page.getByRole('link', { name: new RegExp(item.name) }).waitFor();
  await page.goto(`${origin}/items/unknown`); await heading(page, 'Предмет не найден');
  assert.equal(await page.locator('.lots-section').count(), 0);
}));

test('initial/more/refresh failures, progress, rate limit and source timestamp retention', async () => scenario(async (page, control, calls) => {
  control.delay = 500; control.lots = 'error';
  await page.goto(`${origin}/items/${item.id}`);
  await page.getByText('Загружаем лоты…', { exact: true }).waitFor(); await heading(page, 'Не удалось загрузить лоты');
  control.lots = 'ok'; await button(page, 'Повторить запрос лотов').click(); await shown(page, 3, 3);
  control.lots = 'error'; await button(page, 'Загрузить ещё').click();
  await page.getByText('Загружаем ещё лоты…', { exact: true }).waitFor(); await heading(page, 'Не удалось загрузить ещё лоты');
  await shown(page, 3, 3); assert.equal(calls.at(-1), 3);
  control.lots = 'ok'; await button(page, 'Повторить запрос лотов').click(); await shown(page, 4, 4);
  const timestamp = await page.locator('.lots-meta').innerText();
  control.lots = 'error'; await button(page, 'Обновить').click();
  await page.getByText('Обновляем набор с первой страницы…', { exact: true }).waitFor(); await heading(page, 'Не удалось обновить лоты');
  await shown(page, 4, 4); assert.equal(await page.locator('.lots-meta').innerText(), timestamp);
  control.lots = 'rate'; await button(page, 'Повторить запрос лотов').click(); await heading(page, 'Ограничение запросов');
  await page.getByText(/Повтор доступен после/).waitFor();
  assert(await button(page, 'Повторить запрос лотов').isDisabled());
  assert(await button(page, 'Обновить').isDisabled());
  const count = calls.length;
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(node => node.textContent === 'Повторить запрос лотов').disabled);
  assert.equal(calls.length, count, 'retry time must not trigger automatic requests');
  control.lots = 'ok'; await button(page, 'Повторить запрос лотов').click(); await shown(page, 3, 3);
}));

test('empty source differs from filtered empty; invalid range retains applied results and focuses its field', async () => scenario(async (page, control) => {
  control.lots = 'empty'; await page.goto(`${origin}/items/${item.id}`); await heading(page, 'Лотов нет');
  control.lots = 'ok'; await button(page, 'Обновить').click(); await shown(page, 3, 3);
  await page.getByLabel('Выкуп от', { exact: true }).fill('200'); await apply(page);
  await heading(page, 'Нет лотов по выбранным фильтрам');
  assert(await button(page, 'Загрузить ещё').isEnabled());
  await page.getByLabel('Выкуп до', { exact: true }).fill('100'); await apply(page);
  assert.equal(await page.getByLabel('Выкуп до', { exact: true }).getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'buyout-max');
  await shown(page, 0, 3);
  await button(page, 'Загрузить ещё').click(); await shown(page, 1, 4);
  await button(page, 'Сбросить фильтры').click(); await shown(page, 4, 4);
}));
