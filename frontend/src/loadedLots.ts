import type { Item, LotPage } from './api';
import type { FilterDraft, LotSort } from './lotFilters';

export type Operation = 'initial' | 'more' | 'refresh';
export interface LotsView {
  draft: FilterDraft;
  appliedDraft: FilterDraft;
  sort: LotSort;
  failure: { error: Error; operation: Operation } | null;
}

// Only the current loaded set, in browser memory. Not persisted, not an external lot identity.
let current: { itemId: string; itemName: string; pages: LotPage[]; view: LotsView } | null = null;
let selectedItem: Item | null = null;

export function clearOtherItem(itemId: string) {
  if (current?.itemId !== itemId) current = null;
  if (selectedItem?.id !== itemId) selectedItem = null;
}

export const getLoadedItem = (itemId: string) => selectedItem?.id === itemId ? selectedItem : null;
export function rememberItem(item: Item) { selectedItem = item; }

export function getLoadedLots(itemId: string) {
  return current?.itemId === itemId ? current : null;
}

export function rememberLots(itemId: string, itemName: string, pages: LotPage[], view: LotsView) {
  current = { itemId, itemName, pages, view };
}

export function findLoadedLot(itemId: string, lotId: string) {
  if (current?.itemId !== itemId) return null;
  for (const page of current.pages) {
    const lot = page.items.find(item => item.id === lotId);
    if (lot) return { lot, itemName: current.itemName, fetchedAt: page.fetchedAt };
  }
  return null;
}
