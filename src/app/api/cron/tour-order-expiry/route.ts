/**
 * GET /api/cron/tour-order-expiry — 逾期未付款旅遊訂單釋放名額（10 分冊 §3）。
 *
 * ⚠️ 這支原本是**佔位路由**，驗完 Bearer 就回
 * `{ skipped: true, reason: 'tour tables not built (Phase 10)' }`。
 * 那句理由在 `0066` 建好 trips/plans/departures 之後就已經半假、在 `0087` 建好
 * `tour_orders` 之後完全不成立——留著它，畫面上的排程看起來在跑，實際上每天回一句
 * 「表還沒建」。#8-B 讓它真的做事。
 *
 * 邏輯（10 分冊 §3 的表格）：
 *   綠界（線上刷卡） hold_expires_at = 下單 + 30 分鐘
 *   匯款             hold_expires_at = 下單 + 3 天（租戶可設定）
 *   LINE / 手動單    hold_expires_at = null → **不自動過期**，由導遊管理
 *
 * 所以這支不自己算期限，只認 `hold_expires_at`：**是誰、依什麼規則寫進那個欄位，
 * 是建單端的事**。cron 重新推導一次期限的話，兩邊規則一旦分歧，訂單會在導遊完全
 * 沒預期的時間被取消。
 *
 * 每一筆都走 `expire_tour_order` rpc（`0100`）—— 改狀態與釋放名額同一交易。
 *
 * ⚠️ 這裡**不能**用通用的 `cancel_tour_order`（#350，來自 #271 的 Final Risk MAJOR-1）。
 * 它的終態守門是 `status in ('CANCELLED', 'COMPLETED')`，**`CONFIRMED` 不在其中**。
 * 下面的 select 與 rpc 執行之間有時間差，而通用取消不會重新驗前提：
 *
 *   T+1.0s  select 把訂單 X（PENDING、已過期）列進 batch
 *   T+1.5s  導遊按 confirm-payment → X 變 CONFIRMED / PAID，commit
 *   T+2.0s  cron 取消 X，寫入「未在保留期限內完成付款」並釋放名額
 *
 * 結果是一筆已收款的訂單被系統以「未付款」為由取消、席次放回去可以再賣。
 * `expire_tour_order` 把 `PENDING` + 已過期的條件放進 `for update` 的 where，
 * 在 row lock 底下重新求值，條件不成立就回 `false`、什麼都不做。
 *
 * 下面這個 select 的 filter 仍然保留，但它的角色只是**縮小掃描範圍**，不是守門；
 * 真正的守門在 rpc 裡。把它當守門正是這個缺陷的成因。
 *
 * ⚠️ #769：掃描範圍是 `status in (PENDING, CONFIRMED)` 且 `payment_status = UNPAID`。
 * `CONFIRMED + UNPAID` 是 `accept_tour_request` 產生的「已接受、付款保留中」狀態
 * （名額已鎖、`hold_expires_at` = 接受當下 + 保留時數）。在 migration 0138 套用之前，
 * `expire_tour_order` 對這些列回 false（無害、不取消）；套用後才會實際釋放名額。
 * 現況如實：現行 `expire_tour_order`（0100/0111）只認 PENDING，對 CONFIRMED 回 false。
 * 0138 必須在 row lock 內同時檢查 `status in (PENDING, CONFIRMED)`、
 * `payment_status = 'UNPAID'` 與 hold 已逾期；confirm-payment 會清 `hold_expires_at`
 * 並設 PAID，該鎖內重檢才能防止 #350 型競態（已收款被取消）。
 *
 * 批次飢餓：0138 前 CONFIRMED + UNPAID 逾期列 rpc 永遠回 false，若與 PENDING 混在
 * 同一個 `order by hold_expires_at limit 500`，累積滿 500 筆就會把 PENDING 擠出批次。
 * 因此 PENDING 與 CONFIRMED + UNPAID **分兩次查詢、各自 limit BATCH_LIMIT**（不對半分：
 * PENDING 維持原本每輪吞吐，CONFIRMED 另有自己的額度），合併後處理。
 *
 * 單筆失敗只 log 不中斷整批（07 分冊慣例）。回 { scanned, cancelled }。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { TOUR_ORDER_AUTO_EXPIRE_REASON } from '@/server/tour-orders';

export const runtime = 'nodejs';

/** 一輪最多處理的筆數：避免單次執行時間失控，剩下的下一輪接手（不會漏，只是慢） */
const BATCH_LIMIT = 500;

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const nowIso = new Date().toISOString();

  // 只掃已過期的 PENDING，以及 CONFIRMED + UNPAID（#769）——這是**範圍縮小**，不是守門。
  // 真正守門是 expire_tour_order 在 row lock 底下的重新檢查（#350）。
  // 兩組分開查、各自 order + limit，避免 0138 前永遠回 false 的 CONFIRMED 列餓死 PENDING。
  const pendingQ = admin
    .from('tour_orders')
    .select('id, tenant_id')
    .eq('status', 'PENDING')
    .not('hold_expires_at', 'is', null)
    .lt('hold_expires_at', nowIso)
    .order('hold_expires_at', { ascending: true })
    .limit(BATCH_LIMIT);
  const acceptedQ = admin
    .from('tour_orders')
    .select('id, tenant_id')
    .eq('status', 'CONFIRMED')
    .eq('payment_status', 'UNPAID')
    .not('hold_expires_at', 'is', null)
    .lt('hold_expires_at', nowIso)
    .order('hold_expires_at', { ascending: true })
    .limit(BATCH_LIMIT);
  const [{ data: pendingRows, error }, { data: acceptedRows, error: acceptedError }] =
    await Promise.all([pendingQ, acceptedQ]);
  if (error || acceptedError) {
    console.error('[cron] tour-order-expiry: 查詢 tour_orders 失敗', error ?? acceptedError);
    return new Response('query failed', { status: 500 });
  }
  const rows = [...(pendingRows ?? []), ...(acceptedRows ?? [])];

  let cancelled = 0;
  for (const row of rows) {
    try {
      const { data: released, error: rpcError } = await admin.rpc('expire_tour_order', {
        p_tenant: row.tenant_id,
        p_order: row.id,
        p_reason: TOUR_ORDER_AUTO_EXPIRE_REASON,
      });
      if (rpcError) throw rpcError;
      if (released === true) cancelled++;
    } catch (e) {
      console.error('[cron] tour-order-expiry: 取消失敗', row.tenant_id, row.id, e);
    }
  }

  return NextResponse.json({ scanned: rows.length, cancelled });
}
