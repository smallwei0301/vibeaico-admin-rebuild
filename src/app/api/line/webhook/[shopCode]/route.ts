/**
 * POST /api/line/webhook/[shopCode] — 每家店專屬的 LINE Messaging API webhook。
 * 規格：docs/integration/06-LINE-INTEGRATION.md §3（逐字為基底）。
 *
 * 要點（06 §3）：
 * - runtime='nodejs'（需要 crypto）。
 * - 不走 requireTenant（LINE 打進來沒有 session）→ 用 shopCode 查店、service role 存取。
 * - 簽章驗證失敗回 401 就結束；驗證通過後永遠回 200（處理錯誤只 log，
 *   否則 LINE 會不斷重送）。
 *
 * 偏離規格原文之處（均註明理由）：
 * - timingSafeEqual 兩 buffer 長度不同會 throw → 先比長度，不等直接 401。
 * - tenants select 多取 shop_code/name：handleEvent 的 AI 客服上下文（09 §7.2）
 *   需要店名與公開頁 URL，一次查省一趟 round-trip。
 * - getLineCredentials 丟 LINE_001（該店尚未設定 channel）時回 404 結束——
 *   沒有 secret 無從驗簽，回 5xx 只會讓 LINE 無限重送。
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminSupabase } from '@/server/supabase';
import { getLineCredentials } from '@/server/line';
import { handleEvent } from '@/server/line-events';

export const runtime = 'nodejs';

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
  for (const ev of events ?? []) {
    try { await handleEvent(admin, tenant, token, lineConfig, ev); }
    catch (e) { console.error('[line-webhook]', shopCode, ev.type, e); }
  }
  return new Response('ok');
}
