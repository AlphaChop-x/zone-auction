import type { AuctionLot } from './api';

export interface FilterDraft {
  min: string;
  max: string;
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
  onlyBuyout: boolean;
}

export const sortLabels = {
  loaded: 'Порядок загрузки',
  'buyout-asc': 'Выкуп: по возрастанию',
  'buyout-desc': 'Выкуп: по убыванию',
  'end-asc': 'Окончание: сначала ближайшие',
  'end-desc': 'Окончание: сначала поздние',
} as const;
export type LotSort = keyof typeof sortLabels;

export const emptyFilterDraft = (): FilterDraft => ({ min: '', max: '', onlyBuyout: false });

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
  { valid: true; filters: LotFilters } | { valid: false; errors: Partial<Record<'min' | 'max', string>> } {
  const errors: Partial<Record<'min' | 'max', string>> = {};
  let min: ExactBound | null = null, max: ExactBound | null = null;
  try { min = parseBound(draft.min); } catch (error) { errors.min = (error as Error).message; }
  try { max = parseBound(draft.max); } catch (error) { errors.max = (error as Error).message; }
  if (min !== null && max !== null && min.coefficient * max.factor > max.coefficient * min.factor)
    errors.max = 'Выкуп до должен быть не меньше значения «Выкуп от».';
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, filters: { min, max, onlyBuyout: draft.onlyBuyout } };
}

export function selectLots(lots: readonly AuctionLot[], filters: LotFilters, sort: LotSort): AuctionLot[] {
  const result = lots.filter(lot => {
    if (lot.buyoutPrice === null) return !filters.onlyBuyout && filters.min === null && filters.max === null;
    const price = BigInt(lot.buyoutPrice);
    return (filters.min === null || price * filters.min.factor >= filters.min.coefficient)
      && (filters.max === null || price * filters.max.factor <= filters.max.coefficient);
  });
  if (sort === 'loaded') return result;
  return result.sort((a, b) => {
    let order: number;
    if (sort === 'buyout-asc' || sort === 'buyout-desc') {
      // Null is last in BOTH directions; do not reverse a null-aware ascending list.
      if (a.buyoutPrice === null && b.buyoutPrice !== null) return 1;
      if (a.buyoutPrice !== null && b.buyoutPrice === null) return -1;
      const left = a.buyoutPrice === null ? 0n : BigInt(a.buyoutPrice);
      const right = b.buyoutPrice === null ? 0n : BigInt(b.buyoutPrice);
      order = left < right ? -1 : left > right ? 1 : 0;
    } else {
      order = Math.sign(Date.parse(a.endTime) - Date.parse(b.endTime));
    }
    if (order !== 0) return sort.endsWith('-desc') ? -order : order;
    // The agreed temporary pageId:rowIndex, exact ordinal comparison. Only stable within this set.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
