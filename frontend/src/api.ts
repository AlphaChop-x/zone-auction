export interface Item {
  id: string;
  name: string;
  category: string;
  iconUrl: string | null;
}

export interface ItemPage {
  items: Item[];
  offset: number;
  limit: number;
  hasMore: boolean;
  totalCount: number;
  source: string;
  catalogRevision: string;
}

export class ApiError extends Error {
  constructor(public status: number, message = 'Не удалось выполнить запрос к серверу.', public code?: string, public retryAt?: number) { super(message); }
}

// Requests go only to our backend; no auction credentials in the browser.
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message : 'Не удалось выполнить запрос к серверу.';
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    const retry = response.headers.get('Retry-After');
    const retryAt = retry === null ? undefined : /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
    throw new ApiError(response.status, message, code, retryAt !== undefined && Number.isFinite(retryAt) ? retryAt : undefined);
  }
  return response.json() as Promise<T>;
}

export function getItems(query: string, offset: number, signal: AbortSignal) {
  return get<ItemPage>(`/api/items?${new URLSearchParams({ query, offset: String(offset), limit: '20' })}`, signal);
}

export function getItem(id: string, signal: AbortSignal) {
  return get<Item>(`/api/items/${encodeURIComponent(id)}`, signal);
}

export interface AuctionLot {
  id: string; // Temporary page ID + row index, NOT an external stable lot ID.
  itemId: string;
  quantity: number;
  startPrice: string;
  currentPrice: string | null;
  buyoutPrice: string | null;
  startTime: string;
  endTime: string;
}

export interface LotPage {
  items: AuctionLot[];
  offset: number;
  limit: number;
  nextOffset: number | null;
  hasMore: boolean;
  totalCount: number;
  fetchedAt: string;
  source: string;
  pageId: string;
}

export function getLots(id: string, offset: number, signal: AbortSignal) {
  return get<LotPage>(`/api/items/${encodeURIComponent(id)}/lots?${new URLSearchParams({ offset: String(offset), limit: '20' })}`, signal);
}
