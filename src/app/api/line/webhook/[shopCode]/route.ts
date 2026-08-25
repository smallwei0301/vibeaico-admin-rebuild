/**
 * POST /api/line/webhook/[shopCode] — 每家店專屬的 LINE Messaging API webhook。
 * 規格：docs/integration/06-LINE-INTEGRATION.md §3（逐字為基底）+ §3.1（issue #31）。
 *
 * 要點（06 §3）：
 * - runtime='nodejs'（需要 crypto）。
 * - 不走 requireTenant（LINE 打進來沒有 session）→ 用 shopCode 查店、service role 存取。
 * - 簽章驗證失敗回 401 就結束；驗證通過後永遠回 200（處理錯誤只 log，
 *   否則 LINE 會不斷重送）。
 * - **驗簽通過後立刻回 200，事件處理放到 after() 裡跑**（06 §3.1）：LINE 對
 *   webhook 有秒級的容忍時間，冷啟動時「查 DB → 解密 → 驗簽 → 處理完所有事件」
 *   會超出，逾時＝顧客那則訊息被靜默丟掉（redelivery 預設關閉，不會補送）。
 *   驗簽**仍在回應之前**——「先回 200」指的是事件處理，不是驗簽。
 *
 * 偏離規格原文之處（均註明理由）：
 * - timingSafeEqual 兩 buffer 長度不同會 throw → 先比長度，不等直接 401。
 * - tenants select 多取 shop_code/name/business_type：handleEvent 的 AI 客服上下文
 *   （09 §7.2）需要店名與公開頁 URL；business_type 決定內建指令要用哪一組
 *   MODE_PRESETS.richMenuCells 的文字與回覆方式（06 §3 關鍵字覆蓋規格），
 *   一次查省一趟 round-trip。
 * - **tenant_settings 以 PostgREST 內嵌一起撈**（issue #31）：驗簽前原本有兩趟
 *   DB round-trip（tenants、tenant_settings），現在併成一趟。解密與 LINE_001
 *   判斷共用 src/server/line.ts 的 decryptLineCredentials()，兩條路徑不會分岔。
 *   **刻意不加憑證快取**：快取在冷啟動時是空的（正是出事的那一發），省不到
 *   那 100ms，卻要換來「店家換了 token、系統還在用舊的」這種假的已知。理由
 *   寫在 06 §3.1。
 * - getLineCredentials 丟 LINE_001（該店尚未設定 channel）時回 404 結束——
 *   沒有 secret 無從驗簽，回 5xx 只會讓 LINE 無限重送。
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { after } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { decryptLineCredentials, type LineSettingsRow } from '@/server/line';
// ⚠️ handleEvent **刻意不在檔頭 import**——見下方 after() 內的動態 import 說明。

export const runtime = 'nodejs';

/**
 * 尚未跑完的 after() 事件處理。
 *
 * 用途只有一個：讓整合測試能**確定地**等到背景處理結束再斷言（見下方 GET）。
 * 不做 sleep 猜等——那種測試會偶發紅燈，也會偶發綠燈（12 §2.3 禁用 sleep 等待）。
 * 正式環境不暴露排空端點，這個 Set 只是 add/delete 一個 promise，處理完即移除。
 */
const pendingEventWork = new Set<Promise<void>>();

/**
 * 累計「排入過幾筆 after() 事件處理」（單調遞增，不受完成時機影響）。
 * pendingEventWork.size 是**當下**還在跑的筆數，會因為跑太快而變 0——拿它當
 * 「有沒有排入工作」的證據是不可靠的；這個累計數才是。
 */
let scheduledEventWork = 0;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * after() 內被吞掉的例外，最近 20 筆（**只在非正式環境累積**，給整合測試斷言
 * 「錯誤有留下紀錄」用——測試 process 攔不到 next dev 的 stdout）。
 * 正式環境唯一的紀錄管道就是 console.error（Vercel Runtime Logs）。
 */
const recentEventErrors: string[] = [];

/** 事件處理失敗：一定 console.error；非正式環境另外留一份給測試斷言 */
function noteEventError(shopCode: string, evType: unknown, err: unknown): void {
  console.error('[line-webhook]', shopCode, evType, err);
  if (IS_PRODUCTION) return;
  recentEventErrors.push(`${shopCode}|${String(evType)}|${String(err)}`);
  if (recentEventErrors.length > 20) recentEventErrors.shift();
}

/**
 * GET /api/line/webhook/[shopCode] — **僅開發／測試環境**：等待所有尚未完成的
 * after() 事件處理，回 { drained, scheduled, errors }。正式環境（NODE_ENV=production，含
 * Vercel 的 preview 與 production 部署）維持原本的 405，行為與未實作 GET 時相同。
 */
export async function GET() {
  if (IS_PRODUCTION) {
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

  // 驗簽前只有這一趟 DB：店 + 該店的 LINE 設定（tenant_settings.tenant_id 是
  // tenants(id) 的 FK，PostgREST 可內嵌）。
  const { data: row } = await admin
    .from('tenants')
    // ⚠️ 這個 select 字串必須是**單一字面值**：supabase-js 用它推導回傳型別，
    //    拆成字串相接會退化成 GenericStringError（typecheck 直接紅）。
    .select('id, shop_code, name, business_type, tenant_settings(line, line_channel_secret_enc, line_channel_access_token_enc)')
    .eq('shop_code', shopCode)
    .maybeSingle();
  if (!row) return new Response('unknown shop', { status: 404 });

  const raw = await req.text();                     // 簽章要用原始 body

  // 一對一內嵌在 PostgREST 可能回物件也可能回陣列（版本差異），兩種都收。
  const embedded = (row as Record<string, unknown>).tenant_settings;
  const settingsRow = (Array.isArray(embedded) ? embedded[0] : embedded) as LineSettingsRow;

  let creds: ReturnType<typeof decryptLineCredentials>;
  try {
    creds = decryptLineCredentials(settingsRow);
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
  const tenant = {
    id: row.id as string,
    shop_code: row.shop_code as string,
    name: row.name as string,
    business_type: row.business_type as string | null,
  };

  // 回 200 之後才處理事件。after() 內不得再碰 req（請求已結束），需要的東西
  // （tenant、token、lineConfig、events）都已在上面取出。
  let markDone!: () => void;
  const work = new Promise<void>((resolve) => { markDone = resolve; });
  pendingEventWork.add(work);
  scheduledEventWork += 1;
  after(async () => {
    try {
      // 動態 import：`line-events` 會連帶載入 modes / i18n / flex-menu / ai-reply
      // （ai-reply 又載入 @anthropic-ai/sdk）。那一整包**跟回應無關**，卻會算進
      // 冷啟動的模組載入時間，也就是算進 LINE 的等待。搬到這裡之後，回應路徑
      // 只剩 crypto + supabase 客戶端 + line.ts。
      const { handleEvent } = await import('@/server/line-events');
      for (const ev of events ?? []) {
        try { await handleEvent(admin, tenant, token, lineConfig, ev); }
        catch (e) { noteEventError(shopCode, ev?.type, e); }
      }
    } catch (e) {
      // 迴圈外的意外（例如 events 不是陣列）——after() 內的例外不能讓函式靜默
      // 死掉，一定要留下紀錄，否則就是「後端每一步都成功」的假象。
      noteEventError(shopCode, 'after()', e);
    } finally {
      pendingEventWork.delete(work);
      markDone();
    }
  });

  return new Response('ok');
}
