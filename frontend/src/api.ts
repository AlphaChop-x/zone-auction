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
  constructor(public status: number) { super(`HTTP ${status}`); }
}

// Requests go only to our backend; no auction credentials in the browser.
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

export function getItems(query: string, offset: number, signal: AbortSignal) {
  return get<ItemPage>(`/api/items?${new URLSearchParams({ query, offset: String(offset), limit: '20' })}`, signal);
}

export function getItem(id: string, signal: AbortSignal) {
  return get<Item>(`/api/items/${encodeURIComponent(id)}`, signal);
}
