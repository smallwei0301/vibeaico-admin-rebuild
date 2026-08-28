// Deterministically wait for LINE webhook after() work in development/test.
// The route deliberately has no such endpoint in production.
const DEFAULT_BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

export async function drainWebhook(
  shopCode: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<{ drained: number; scheduled: number; errors: string[] }> {
  const res = await fetch(`${baseUrl}/api/line/webhook/${shopCode}`, { method: 'GET' });
  if (!res.ok) throw new Error(`drainWebhook: expected test-only GET to succeed, got ${res.status}`);
  const body = (await res.json()) as { drained?: number; scheduled?: number; errors?: string[] };
  return { drained: body.drained ?? 0, scheduled: body.scheduled ?? 0, errors: body.errors ?? [] };
}
