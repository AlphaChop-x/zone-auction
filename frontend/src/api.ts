export interface HealthResponse {
  status: 'ok';
}

// Все запросы идут к собственному серверу. Vite проксирует /api в разработке.
// Здесь нет реквизитов и обращений браузера к внешнему API.
export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { signal });
  if (!response.ok) throw new Error(`Health: HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('status' in data) || data.status !== 'ok') {
    throw new Error('Unexpected health response');
  }
  return { status: 'ok' };
}
