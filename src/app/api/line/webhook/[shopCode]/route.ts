/**
 * POST /api/line/webhook/[shopCode] — 每家店專屬的 LINE Messaging API webhook。
 * 規格：docs/integration/06-LINE-INTEGRATION.md §3（逐字為基底）與 §3.1。
 *
 * 要點（06 §3）：
 * - runtime='nodejs'（需要 crypto）。
 * - 不走 requireTenant（LINE 打進來沒有 session）→ 用 shopCode 查店、service role 存取。
 * - 簽章驗證失敗回 401 就結束；驗證通過後永遠回 200（處理錯誤只 log，
 *   否則 LINE 會不斷重送）。
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
const pendingEventWork = new Set<Promise<void>>();

/** 從此 route 啟動後累計排入的背景工作數；不以 pending size 代替。 */
let scheduledEventWork = 0;

/** 非正式環境提供測試可驗證的錯誤摘要；正式環境只寫 Runtime Log。 */
const recentEventErrors: string[] = [];

function noteEventError(shopCode: string, eventType: unknown, error: unknown): void {
  console.error('[line-webhook]', shopCode, eventType, error);
  if (process.env.NODE_ENV === 'production') return;
  recentEventErrors.push(`${shopCode}|${String(eventType)}|${String(error)}`);
  if (recentEventErrors.length > 20) recentEventErrors.shift();
}

/**
 * 僅開發／測試環境的排空觀測端點。正式環境維持沒有 GET handler 時的 405。
 * `scheduled` 是累計排入數，`drained` 是本次 GET 等待時看到的工作數。
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const inflight = [...pendingEventWork];
  await Promise.all(inflight);
  return Response.json({
    drained: inflight.length,
    scheduled: scheduledEventWork,
    errors: [...recentEventErrors],
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

  const { events } = JSON.parse(raw);
  let finishWork!: () => void;
  const work = new Promise<void>((resolve) => { finishWork = resolve; });
  pendingEventWork.add(work);
  scheduledEventWork += 1;

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
        pendingEventWork.delete(work);
        finishWork();
      }
    });
  } catch (e) {
    // A registration failure must not turn a valid LINE webhook into a silent loss.
    pendingEventWork.delete(work);
    finishWork();
    noteEventError(shopCode, 'after()', e);
  }

  return new Response('ok');
}
