/**
 * POST /api/line/webhook/[shopCode] — 每家店專屬的 LINE Messaging API webhook。
 * 規格：docs/integration/06-LINE-INTEGRATION.md §3（逐字為基底）與 §3.1。
 *
 * 要點（06 §3）：
 * - runtime='nodejs'（需要 crypto）。
 * - 不走 requireTenant（LINE 打進來沒有 session）→ 用 shopCode 查店、service role 存取。
 * - 簽章驗證失敗回 401；合法 HMAC 但 malformed JSON 回 400；合法 JSON 驗證通過後
 *   事件處理錯誤只 log 並維持 200，否則 LINE 會不斷重送。
 * - 驗簽通過後先回 200，事件處理交給 Next `after()`；需要的資料在 response
 *   前取出，背景 callback 不依賴已結束的 Request。
 *
 * 偏離規格原文之處（均註明理由）：
 * - timingSafeEqual 兩 buffer 長度不同會 throw → 先比長度，不等直接 401。
 * - tenants select 多取 shop_code/name：handleEvent 的 AI 客服上下文（09 §7.2）
 *   需要店名與公開頁 URL，一次查省一趟 round-trip。
 * - getLineCredentials 丟 LINE_001（該店尚未設定 channel）時回 404 結束——
 *   沒有 secret 無從驗簽，回 5xx 只會讓 LINE 無限重送。
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { after } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { getLineCredentials } from '@/server/line';

export const runtime = 'nodejs';

/** 尚未完成的 after() 工作；僅供非 production 的 deterministic drain 使用。 */
type DrainState = {
  pending: Set<Promise<void>>;
  scheduled: number;
  errors: string[];
};

/**
 * 只在明確開啟的 local/CI test server 寫入 drain state；production 不記錄這些
 * process-global state。每個 shop 的 state 也有固定上限，避免測試 seam 變成
 * 無界的 runtime observability buffer。
 */
const drainStateByShop = new Map<string, DrainState>();
const MAX_DRAIN_SHOPS = 32;
const MAX_PENDING_WORK_PER_SHOP = 100;
const MAX_RECENT_ERRORS = 20;
const TEST_DRAIN_HEADER = 'x-line-webhook-test-drain';

function testDrainEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.LINE_WEBHOOK_DRAIN_ENABLED === 'true';
}

function drainStateFor(shopCode: string): DrainState | undefined {
  if (!testDrainEnabled()) return undefined;
  const existing = drainStateByShop.get(shopCode);
  if (existing) return existing;
  if (drainStateByShop.size >= MAX_DRAIN_SHOPS) {
    console.error('[line-webhook]', shopCode, 'test drain state capacity exceeded');
    return undefined;
  }
  const state: DrainState = { pending: new Set(), scheduled: 0, errors: [] };
  drainStateByShop.set(shopCode, state);
  return state;
}

function noteEventError(shopCode: string, eventType: unknown, error: unknown): void {
  console.error('[line-webhook]', shopCode, eventType, error);
  const state = drainStateFor(shopCode);
  if (!state) return;
  state.errors.push(`${shopCode}|${String(eventType)}|${String(error)}`);
  if (state.errors.length > MAX_RECENT_ERRORS) state.errors.shift();
}

/**
 * 僅供 local/CI test server 的 deterministic drain seam。正式環境、未設定明確
 * flag、或沒有測試 header 時都維持 405；這不是 production observability API。
 * `scheduled` 是該 shop 在此 process 累計排入數，`drained` 是本次 GET 等待的工作數。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ shopCode: string }> },
) {
  if (!testDrainEnabled() || req.headers.get(TEST_DRAIN_HEADER) !== '1') {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const { shopCode } = await params;
  const state = drainStateByShop.get(shopCode);
  const inflight = state ? [...state.pending] : [];
  await Promise.all(inflight);
  return Response.json({
    drained: inflight.length,
    scheduled: state?.scheduled ?? 0,
    errors: [...(state?.errors ?? [])],
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ shopCode: string }> }) {
  const { shopCode } = await params;
  const admin = createAdminSupabase();
  const { data: tenant } = await admin.from('tenants')
    .select('id, shop_code, name').eq('shop_code', shopCode).maybeSingle();
  if (!tenant) return new Response('unknown shop', { status: 404 });

  const raw = await req.text();                     // 簽章要用原始 body

  let creds: Awaited<ReturnType<typeof getLineCredentials>>;
  try {
    creds = await getLineCredentials(tenant.id);
  } catch {
    return new Response('line not configured', { status: 404 }); // LINE_001：未設定 channel
  }
  const { token, secret, lineConfig } = creds;

  const expect = createHmac('sha256', secret).update(raw).digest('base64');
  const got = req.headers.get('x-line-signature') ?? '';
  // timingSafeEqual 遇到長度不同的 buffer 會 throw —— 長度不等先短路 401
  const expectBuf = Buffer.from(expect);
  const gotBuf = Buffer.from(got);
  if (!got || expectBuf.length !== gotBuf.length || !timingSafeEqual(expectBuf, gotBuf))
    return new Response('bad signature', { status: 401 });

  let events: any[];
  try {
    const payload = JSON.parse(raw) as { events?: unknown } | null;
    events = Array.isArray(payload?.events) ? payload.events : [];
  } catch (e) {
    noteEventError(shopCode, 'parse', e);
    return new Response('invalid JSON', { status: 400 });
  }

  const drainState = drainStateFor(shopCode);
  let finishWork: (() => void) | undefined;
  let work: Promise<void> | undefined;
  if (drainState && drainState.pending.size < MAX_PENDING_WORK_PER_SHOP) {
    work = new Promise<void>((resolve) => { finishWork = resolve; });
    drainState.pending.add(work);
    drainState.scheduled += 1;
  }

  try {
    after(async () => {
      try {
        // Keep line-events out of the response path; this preserves the AI reply branch
        // while avoiding its module load before the webhook acknowledgement.
        const { handleEvent } = await import('@/server/line-events');
        for (const ev of events ?? []) {
          try { await handleEvent(admin, tenant, token, lineConfig, ev); }
          catch (e) { noteEventError(shopCode, ev?.type, e); }
        }
      } catch (e) {
        noteEventError(shopCode, 'after()', e);
      } finally {
        if (drainState && work && finishWork) {
          drainState.pending.delete(work);
          finishWork();
        }
      }
    });
  } catch (e) {
    // A registration failure must not turn a valid LINE webhook into a silent loss.
    if (drainState && work && finishWork) {
      drainState.pending.delete(work);
      finishWork();
    }
    noteEventError(shopCode, 'after()', e);
  }

  return new Response('ok');
}
