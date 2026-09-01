// Deterministically wait for the test-server webhook after() work.

const DEFAULT_BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

export interface WebhookDrainResult {
  drained: number;
  scheduled: number;
  errors: string[];
}

/**
 * Wait for all pending webhook work on the development/test server.
 *
 * The route registers work before returning 200, so this is a completion
 * signal rather than a timing-based sleep. The endpoint is unavailable when
 * NODE_ENV=production.
 */
export async function drainWebhook(
  shopCode: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<WebhookDrainResult> {
  const res = await fetch(`${baseUrl}/api/line/webhook/${encodeURIComponent(shopCode)}`, {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error(`drainWebhook: expected test-only GET to succeed, got ${res.status}`);
  }
  const body = (await res.json()) as Partial<WebhookDrainResult>;
  return {
    drained: body.drained ?? 0,
    scheduled: body.scheduled ?? 0,
    errors: body.errors ?? [],
  };
}
