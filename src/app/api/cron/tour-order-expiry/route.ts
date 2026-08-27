/**
 * GET /api/cron/tour-order-expiry — 逾期未付款的旅遊訂單自動取消並釋放名額。
 *
 * 10 分冊 §3：
 *   - 綠界（線上刷卡）：下單 + 30 分鐘未付 → 釋放名額、訂單 CANCELLED
 *   - 匯款：下單 + 3 天未付（租戶可設定）→ 同上
 *   - LINE / 手動單：`hold_expires_at` 為 null → **永不自動過期**（導遊自己管理）
 *
 * 也就是說「要不要過期」完全由 `hold_expires_at` 決定，這支 cron 不自己推算期限
 * ——期限是下單那一刻由 checkout（11 分冊，Phase 9）依收款方式寫進去的。
 * 目前唯一會建單的入口是手動建單，它一律寫 null，所以在 checkout 上線之前
 * 這支 cron 正常情況下會處理 0 筆。**回 0 是誠實的答案，不是沒接上。**
 *
 * 排程在 vercel.json（Hobby 方案限制為每日一次；07 分冊原註的「每小時」已過時）。
 *
 * 冪等：查詢條件帶 `status='PENDING'` 且 `payment_status='UNPAID'`，
 * 已取消／已付款的列不會再被匹配，重跑不會重複釋放名額。
 * 釋放名額與改狀態的順序與 `POST /api/tour-orders/:id/cancel` 一致：
 * **先用帶 `status='PENDING'` 條件的 update 取得資料列，拿到的才釋放名額**
 * ——反過來寫的話，與人工取消同時發生就會把同一批名額放兩次。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const nowIso = new Date().toISOString();

  const { data: expired, error } = await admin
    .from('tour_orders')
    .update({
      status: 'CANCELLED',
      cancel_reason: '付款期限已過，系統自動取消並釋放名額',
      hold_expires_at: null,
      updated_at: nowIso,
    })
    .eq('status', 'PENDING')
    .eq('payment_status', 'UNPAID')
    .not('hold_expires_at', 'is', null)
    .lt('hold_expires_at', nowIso)
    .select('id, tenant_id, departure_id, party_size');

  if (error) {
    console.error('[cron] tour-order-expiry: 取消逾期訂單失敗', error);
    return new Response('update failed', { status: 500 });
  }

  let released = 0;
  const failures: string[] = [];
  for (const row of expired ?? []) {
    const { error: rsErr } = await admin.rpc('release_seats', {
      p_departure: row.departure_id,
      p_count: row.party_size,
    });
    // 單筆失敗只 log、不中斷整批（07 分冊慣例）。訂單已經是 CANCELLED，
    // 這裡失敗代表名額沒放回去——所以要留下可查的紀錄，不能靜默吞掉。
    if (rsErr) {
      console.error('[cron] tour-order-expiry: release_seats 失敗', row.id, rsErr);
      failures.push(row.id as string);
    } else {
      released += 1;
    }
  }

  return NextResponse.json({
    cancelled: (expired ?? []).length,
    seatsReleased: released,
    releaseFailedOrderIds: failures,
  });
}
