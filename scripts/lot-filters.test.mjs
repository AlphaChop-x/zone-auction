// Node 24 native TypeScript stripping executes the same pure functions as the frontend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilterDraft, formatUnitBuyout, nextSort, selectLots, validateFilters as validateInput } from '../frontend/src/lotFilters.ts';

const validateFilters = draft => validateInput({ ...emptyFilterDraft(), ...draft });

const lot = (id, quantity, buyoutPrice, endTime) => ({
  id, itemId: '3g6p5', quantity, buyoutPrice, endTime,
  startPrice: '0', currentPrice: null, startTime: '2026-10-24T00:00:00Z',
});
const A = Object.freeze(lot('page:A', 2, '100', '2026-10-26T10:00:00Z'));
const B = Object.freeze(lot('page:B', 1, '70', '2026-10-25T10:00:00Z'));
const C = Object.freeze(lot('page:C', 1, null, '2026-10-27T10:00:00Z'));
const source = Object.freeze([A, B, C]);
const filters = (min = '', max = '', onlyBuyout = false, unitMin = '', unitMax = '') => {
  const result = validateFilters({ min, max, onlyBuyout, unitMin, unitMax });
  assert(result.valid); return result.filters;
};
const ids = rows => rows.map(row => row.id);

test('range 80–120 uses the TOTAL buyout: A (2 units at total 100), not unit price', () => {
  assert.deepEqual(selectLots(source, filters('80', '120'), 'loaded'), [A]);
});
test('optional bounds and buyout-only switch handle null correctly', () => {
  assert.deepEqual(selectLots(source, filters(), 'loaded'), [A, B, C]);
  assert.deepEqual(selectLots(source, filters('', '', true), 'loaded'), [A, B]);
  assert.deepEqual(selectLots(source, filters('0'), 'loaded'), [A, B]);
  assert.deepEqual(selectLots(source, filters('', '100'), 'loaded'), [A, B]);
});
test('buyout sort in both directions always puts null last', () => {
  assert.deepEqual(selectLots(source, filters(), 'buyout-asc'), [B, A, C]);
  assert.deepEqual(selectLots(source, filters(), 'buyout-desc'), [A, B, C]);
});
test('end-time sort compares instants in both directions, not local date text', () => {
  assert.deepEqual(selectLots(source, filters(), 'end-asc'), [B, A, C]);
  assert.deepEqual(selectLots(source, filters(), 'end-desc'), [C, A, B]);
  const sameInstant = lot('page:0', 1, '100', '2026-10-26T13:00:00+03:00');
  assert.deepEqual(ids(selectLots([A, sameInstant], filters(), 'end-asc')), ['page:0', 'page:A']);
});
test('ties use exact ordinal temporary ID, independent of input order and sort direction', () => {
  const lower = lot('page:a', 1, '100', A.endTime);
  const upper = lot('page:Z', 1, '100', A.endTime);
  const nullLower = lot('page:c', 1, null, A.endTime);
  const nullUpper = lot('page:B', 1, null, A.endTime);
  for (const sort of ['buyout-asc', 'buyout-desc', 'unit-asc', 'unit-desc', 'end-asc', 'end-desc']) {
    assert.deepEqual(ids(selectLots([lower, upper], filters(), sort)), ['page:Z', 'page:a']);
    assert.deepEqual(ids(selectLots([upper, lower], filters(), sort)), ['page:Z', 'page:a']);
    assert.deepEqual(ids(selectLots([nullLower, nullUpper], filters(), sort)), ['page:B', 'page:c']);
  }
});

test('unit buyout is total / quantity; its range combines with the total range using AND', () => {
  assert.deepEqual(selectLots(source, filters('', '', false, '45', '55'), 'loaded'), [A]);
  assert.deepEqual(selectLots(source, filters('80', '120', false, '60', '80'), 'loaded'), []);
  assert.deepEqual(selectLots(source, filters('70', '120', false, '50', '70'), 'loaded'), [A, B]);
  assert.deepEqual(selectLots(source, filters('', '', false, '0'), 'loaded'), [A, B]);
  assert.deepEqual(selectLots(source, filters('', '', false, '', '50'), 'loaded'), [A]);
  assert.deepEqual(selectLots(source, filters('', '', false, '50', '50'), 'loaded'), [A]);
});

test('unit sorting compares ratios, preserves null-last in both directions and applies to appended pages', () => {
  assert.deepEqual(selectLots(source, filters(), 'unit-asc'), [A, B, C]);
  assert.deepEqual(selectLots(source, filters(), 'unit-desc'), [B, A, C]);
  const next = lot('next:D', 10, '200', '2026-10-28T10:00:00Z');
  assert.deepEqual(selectLots([...source, next], filters('', '', false, '20', '60'), 'unit-asc'), [next, A]);
});

test('rounded display never determines unit range membership', () => {
  const third = lot('third', 3, '100', A.endTime);
  assert.equal(formatUnitBuyout(third), '≈33,33 ₽/шт.');
  assert.deepEqual(selectLots([third], filters('', '', false, '', '33.33'), 'loaded'), []);
  assert.deepEqual(selectLots([third], filters('', '', false, '33,33', '33.34'), 'loaded'), [third]);
  assert.deepEqual(selectLots([third], filters('', '', false, '33.3333333333333333333333333333334'), 'loaded'), []);
});

test('unit formatting handles exact values, half-up rounding, carry and Int64 without Number conversion', () => {
  assert.equal(formatUnitBuyout(A), '50 ₽/шт.');
  assert.equal(formatUnitBuyout(C), '—');
  assert.equal(formatUnitBuyout(lot('half', 2, '1', A.endTime)), '0,5 ₽/шт.');
  assert.equal(formatUnitBuyout(lot('eighth', 8, '1', A.endTime)), '≈0,13 ₽/шт.');
  assert.equal(formatUnitBuyout(lot('carry', 1000, '1999', A.endTime)), '≈2 ₽/шт.');
  assert.equal(formatUnitBuyout(lot('max', 1, '9223372036854775807', A.endTime)), `${9223372036854775807n.toLocaleString('ru-RU')} ₽/шт.`);
  assert.throws(() => formatUnitBuyout(lot('zero-quantity', 0, '100', A.endTime)), RangeError);
});

test('unit validation rejects bad boundaries and inverted ranges at the correct fields; reset clears both ranges', () => {
  for (const value of ['-1', 'NaN', '1e3', '1.2.3']) {
    const result = validateFilters({ unitMin: value }); assert(!result.valid && result.errors.unitMin);
  }
  const badMax = validateFilters({ unitMax: '-1' }); assert(!badMax.valid && badMax.errors.unitMax);
  const inverted = validateFilters({ unitMin: '70', unitMax: '50' }); assert(!inverted.valid && inverted.errors.unitMax);
  const reset = validateFilters(emptyFilterDraft()); assert(reset.valid);
  assert.deepEqual(selectLots(source, reset.filters, 'loaded'), source);
});

test('unit comparisons above safe integer precision and equal ratios use exact cross multiplication and ID ties', () => {
  const low = lot('z', 3, '9007199254740992', A.endTime);
  const high = lot('a', 3, '9007199254740993', A.endTime);
  assert.deepEqual(selectLots([high, low], filters(), 'unit-asc'), [low, high]);
  assert.deepEqual(selectLots([low, high], filters(), 'unit-desc'), [high, low]);
  const equal = lot('page:0', 4, '200', A.endTime);
  assert.deepEqual(selectLots([A, equal], filters(), 'unit-desc'), [equal, A]);
});

test('header arrow cycle is ascending, descending, loaded; choosing another column starts ascending', () => {
  for (const column of ['buyout', 'unit', 'end']) {
    assert.equal(nextSort('loaded', column), `${column}-asc`);
    assert.equal(nextSort(`${column}-asc`, column), `${column}-desc`);
    assert.equal(nextSort(`${column}-desc`, column), 'loaded');
  }
  assert.equal(nextSort('unit-desc', 'buyout'), 'buyout-asc');
});
test('both endpoints are inclusive; zero is a real bound; decimal input is exact', () => {
  assert.deepEqual(selectLots(source, filters('70', '100'), 'loaded'), [A, B]);
  assert.deepEqual(selectLots(source, filters('100', '100'), 'loaded'), [A]);
  assert.deepEqual(selectLots(source, filters('70', '70'), 'loaded'), [B]);
  assert.deepEqual(selectLots(source, filters('', '0'), 'loaded'), []);
  assert.deepEqual(selectLots(source, filters('70,00000000000000000001', '100.000'), 'loaded'), [A]);
  assert.deepEqual(selectLots(source, filters(' 070.000 ', '100,00'), 'loaded'), [A, B]);
});
test('negative, nonnumeric, exponential input and inverted ranges are rejected at their fields', () => {
  for (const value of ['-1', '-0', 'abc', 'NaN', 'Infinity', '1e3', '1.2.3', '.', '1,', '0x10', '9'.repeat(65)]) {
    const min = validateFilters({ min: value, max: '', onlyBuyout: false });
    const max = validateFilters({ min: '', max: value, onlyBuyout: false });
    assert(!min.valid && min.errors.min, value); assert(!max.valid && max.errors.max, value);
  }
  const inverted = validateFilters({ min: '120', max: '80', onlyBuyout: false });
  assert(!inverted.valid && inverted.errors.max);
  const precise = validateFilters({ min: '100.00000000000000000001', max: '100', onlyBuyout: false });
  assert(!precise.valid);
});
test('prices beyond Number.MAX_SAFE_INTEGER remain distinct in filtering and sorting', () => {
  const smaller = lot('page:z', 1, '9007199254740992', A.endTime);
  const larger = lot('page:a', 1, '9007199254740993', A.endTime);
  const largest = lot('page:0', 1, '9223372036854775807', A.endTime);
  assert.deepEqual(selectLots([larger, smaller, largest], filters(), 'buyout-asc'), [smaller, larger, largest]);
  assert.deepEqual(selectLots([smaller, larger, largest], filters(), 'buyout-desc'), [largest, larger, smaller]);
  assert.deepEqual(selectLots([smaller, larger, largest], filters('9007199254740993', '9007199254740993'), 'loaded'), [larger]);
});
test('new pages use current parameters, source arrays remain intact, reset restores full loaded set', () => {
  const current = filters('80', '120');
  const nextPageLot = Object.freeze(lot('next:D', 3, '90', '2026-10-28T10:00:00Z'));
  const loaded = Object.freeze([...source, nextPageLot]);
  assert.deepEqual(selectLots(loaded, current, 'buyout-asc'), [nextPageLot, A]);
  assert.deepEqual(source, [A, B, C]); assert.deepEqual(loaded, [A, B, C, nextPageLot]);
  const reset = validateFilters(emptyFilterDraft()); assert(reset.valid);
  assert.deepEqual(selectLots(loaded, reset.filters, 'loaded'), loaded);
  assert.deepEqual(selectLots(loaded, reset.filters, 'buyout-asc'), [B, nextPageLot, A, C]);
});
