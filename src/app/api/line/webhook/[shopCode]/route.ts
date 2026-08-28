/**
 * LINE webhook — 06 §3.1 / issue #31.
 *
 * Authentication remains on the request path. Once the signature has been
 * accepted, event work is scheduled with Next's after() so LINE gets its 200
 * without waiting for database writes, replies, or optional AI work.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { after } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { decryptLineCredentials, type LineSettingsRow } from '@/server/line';

export const runtime = 'nodejs';

const pendingEventWork = new Set<Promise<void>>();
let scheduledEventWork = 0;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_DRAIN_TEST_RUNTIME = !IS_PRODUCTION && process.env.LINE_WEBHOOK_DRAIN_ENABLED === 'true';
const recentEventErrors: string[] = [];

function noteEventError(shopCode: string, eventType: unknown, error: unknown): void {
  console.error('[line-webhook]', shopCode, eventType, error);
  if (IS_PRODUCTION) return;
  recentEventErrors.push(`${shopCode}|${String(eventType)}|${String(error)}`);
  if (recentEventErrors.length > 20) recentEventErrors.shift();
}

/** Test-only deterministic completion signal. All normal deployments retain POST-only behavior. */
export async function GET() {
  if (!IS_DRAIN_TEST_RUNTIME) {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const inflight = [...pendingEventWork];
  await Promise.allSettled(inflight);
  return Response.json({
    drained: inflight.length,
    scheduled: scheduledEventWork,
    errors: [...recentEventErrors],
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ shopCode: string }> }) {
  const { shopCode } = await params;
  const admin = createAdminSupabase();

  // One DB round trip before the response: the tenant and its LINE settings.
  const { data: row } = await admin
    .from('tenants')
    .select('id, shop_code, name, tenant_settings(line, line_channel_secret_enc, line_channel_access_token_enc)')
    .eq('shop_code', shopCode)
    .maybeSingle();
  if (!row) return new Response('unknown shop', { status: 404 });

  const raw = await req.text();
  const embedded = (row as Record<string, unknown>).tenant_settings;
  const settings = (Array.isArray(embedded) ? embedded[0] : embedded) as LineSettingsRow;

  let credentials: ReturnType<typeof decryptLineCredentials>;
  try {
    credentials = decryptLineCredentials(settings);
  } catch {
    return new Response('line not configured', { status: 404 });
  }
  const { token, secret, lineConfig } = credentials;

  const expected = createHmac('sha256', secret).update(raw).digest('base64');
  const received = req.headers.get('x-line-signature') ?? '';
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (!received || expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return new Response('bad signature', { status: 401 });
  }

  const tenant = {
    id: row.id as string,
    shop_code: row.shop_code as string,
    name: row.name as string,
  };

  let markDone!: () => void;
  const work = new Promise<void>((resolve) => { markDone = resolve; });
  pendingEventWork.add(work);
  scheduledEventWork += 1;

  after(async () => {
    try {
      // Event handling imports a much larger module graph; keep it out of the
      // signature/response path and never access req after this point.
      const { events } = JSON.parse(raw);
      const { handleEvent } = await import('@/server/line-events');
      for (const event of events ?? []) {
        try {
          await handleEvent(admin, tenant, token, lineConfig, event);
        } catch (error) {
          noteEventError(shopCode, event?.type, error);
        }
      }
    } catch (error) {
      noteEventError(shopCode, 'after()', error);
    } finally {
      pendingEventWork.delete(work);
      markDone();
    }
  });

  return new Response('ok');
}
