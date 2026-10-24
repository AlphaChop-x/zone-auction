import type { AuctionLot } from './api';

export interface FilterDraft {
  min: string;
  max: string;
  unitMin: string;
  unitMax: string;
  onlyBuyout: boolean;
}

interface ExactBound {
  coefficient: bigint;
  factor: bigint;
  text: string;
}

export interface LotFilters {
  min: ExactBound | null;
  max: ExactBound | null;
  unitMin: ExactBound | null;
  unitMax: ExactBound | null;
  onlyBuyout: boolean;
}

export const sortLabels = {
  loaded: 'Порядок загрузки',
  'buyout-asc': 'Выкуп: по возрастанию',
  'buyout-desc': 'Выкуп: по убыванию',
  'unit-asc': 'Выкуп за шт.: по возрастанию',
  'unit-desc': 'Выкуп за шт.: по убыванию',
  'end-asc': 'Окончание: сначала ближайшие',
  'end-desc': 'Окончание: сначала поздние',
} as const;
export type LotSort = keyof typeof sortLabels;
export type SortColumn = 'buyout' | 'unit' | 'end';
export const nextSort = (current: LotSort, column: SortColumn): LotSort =>
  current === `${column}-asc` ? `${column}-desc` : current === `${column}-desc` ? 'loaded' : `${column}-asc`;

export const emptyFilterDraft = (): FilterDraft => ({ min: '', max: '', unitMin: '', unitMax: '', onlyBuyout: false });

// Keep the quotient as a rational: rounding is exclusively a presentation concern.
export function unitBuyout(lot: Pick<AuctionLot, 'buyoutPrice' | 'quantity'>) {
  if (lot.buyoutPrice === null) return null;
  if (!Number.isSafeInteger(lot.quantity) || lot.quantity <= 0) throw new RangeError('Invalid lot quantity');
  return { numerator: BigInt(lot.buyoutPrice), denominator: BigInt(lot.quantity) };
}

export function formatUnitBuyout(lot: Pick<AuctionLot, 'buyoutPrice' | 'quantity'>): string {
  const price = unitBuyout(lot);
  if (price === null) return '—';
  const scaled = price.numerator * 100n;
  const rounded = (scaled * 2n + price.denominator) / (price.denominator * 2n);
  const fraction = (rounded % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${scaled % price.denominator === 0n ? '' : '≈'}${(rounded / 100n).toLocaleString('ru-RU')}${fraction ? `,${fraction}` : ''} ₽/шт.`;
}

function parseBound(input: string): ExactBound | null {
  const value = input.trim();
  if (!value) return null;
  // Decimal strings only: no Number/parseFloat, exponent notation or silent rounding.
  if (value.length > 64 || !/^\d+(?:[.,]\d+)?$/.test(value))
    throw new Error('Введите неотрицательное число: цифры и, при необходимости, точку или запятую (до 64 символов).');
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return {
    coefficient: BigInt(integer + decimals),
    factor: 10n ** BigInt(decimals.length),
    text: decimals ? `${integer}.${decimals}` : integer,
  };
}

export function validateFilters(draft: FilterDraft):
  { valid: true; filters: LotFilters } | { valid: false; errors: Partial<Record<'min' | 'max' | 'unitMin' | 'unitMax', string>> } {
  const errors: Partial<Record<'min' | 'max' | 'unitMin' | 'unitMax', string>> = {};
  const bounds: Record<'min' | 'max' | 'unitMin' | 'unitMax', ExactBound | null> = { min: null, max: null, unitMin: null, unitMax: null };
  for (const key of ['min', 'max', 'unitMin', 'unitMax'] as const) {
    try { bounds[key] = parseBound(draft[key]); } catch (error) { errors[key] = (error as Error).message; }
  }
  for (const [minKey, maxKey, label] of [['min', 'max', 'Выкуп до'], ['unitMin', 'unitMax', 'За штуку до']] as const) {
    const min = bounds[minKey], max = bounds[maxKey];
    if (min !== null && max !== null && min.coefficient * max.factor > max.coefficient * min.factor)
      errors[maxKey] = `Значение «${label}» должно быть не меньше нижней границы.`;
  }
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, filters: { ...bounds, onlyBuyout: draft.onlyBuyout } };
}

export function selectLots(lots: readonly AuctionLot[], filters: LotFilters, sort: LotSort): AuctionLot[] {
  const result = lots.filter(lot => {
    if (lot.buyoutPrice === null) return !filters.onlyBuyout && filters.min === null && filters.max === null && filters.unitMin === null && filters.unitMax === null;
    const price = BigInt(lot.buyoutPrice);
    return (filters.min === null || price * filters.min.factor >= filters.min.coefficient)
      && (filters.max === null || price * filters.max.factor <= filters.max.coefficient)
      && (filters.unitMin === null || price * filters.unitMin.factor >= filters.unitMin.coefficient * BigInt(lot.quantity))
      && (filters.unitMax === null || price * filters.unitMax.factor <= filters.unitMax.coefficient * BigInt(lot.quantity));
  });
  if (sort === 'loaded') return result;
  return result.sort((a, b) => {
    let order: number;
    if (sort === 'buyout-asc' || sort === 'buyout-desc' || sort === 'unit-asc' || sort === 'unit-desc') {
      // Null is last in BOTH directions; do not reverse a null-aware ascending list.
      if (a.buyoutPrice === null && b.buyoutPrice !== null) return 1;
      if (a.buyoutPrice !== null && b.buyoutPrice === null) return -1;
      const left = a.buyoutPrice === null ? 0n : BigInt(a.buyoutPrice) * (sort.startsWith('unit-') ? BigInt(b.quantity) : 1n);
      const right = b.buyoutPrice === null ? 0n : BigInt(b.buyoutPrice) * (sort.startsWith('unit-') ? BigInt(a.quantity) : 1n);
      order = left < right ? -1 : left > right ? 1 : 0;
    } else {
      order = Math.sign(Date.parse(a.endTime) - Date.parse(b.endTime));
    }
    if (order !== 0) return sort.endsWith('-desc') ? -order : order;
    // The agreed temporary pageId:rowIndex, exact ordinal comparison. Only stable within this set.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
