import type { LotPage } from './api';

// Only the current loaded set, in browser memory. Not persisted, not an external lot identity.
let current: { itemId: string; itemName: string; pages: LotPage[] } | null = null;

export function clearOtherItem(itemId: string) {
  if (current?.itemId !== itemId) current = null;
}

export function rememberLots(itemId: string, itemName: string, pages: LotPage[]) {
  current = { itemId, itemName, pages };
}

export function findLoadedLot(itemId: string, lotId: string) {
  if (current?.itemId !== itemId) return null;
  for (const page of current.pages) {
    const lot = page.items.find(item => item.id === lotId);
    if (lot) return { lot, itemName: current.itemName, fetchedAt: page.fetchedAt };
  }
  return null;
}
