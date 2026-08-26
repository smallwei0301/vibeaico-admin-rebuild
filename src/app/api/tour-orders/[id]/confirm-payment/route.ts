import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTourOrder } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/tour-orders/[id]/confirm-payment — 導遊後台「確認收款」⚙M。
 *
 * 10 分冊 §3 的匯款流程：旅客回報後五碼 → 導遊按這顆 → `payment_status='PAID'`
 * 且訂單 `PENDING → CONFIRMED`，同時清掉 `hold_expires_at`（已付款就不再自動
 * 釋放名額）。
 *
 * ⚠️ **這支不發任何通知。** 10 分冊 §3 最後一句寫「狀態變更走 LINE 推播 +
 * Email 通知」，但那需要 tour_orders 綁到 customers/line_users 的通知鏈，
 * 屬 issue #8 範圍之外（本 issue 的範圍表只列狀態動作）。畫面文案因此只能
 * 說「已確認收款」，不得寫「已通知旅客」——那是我們沒做的事
 * （14 分冊 §8.10 的通則）。
 *
 * 已取消的訂單不得確認收款（名額已釋放，改回 CONFIRMED 會憑空多出報名人數）。
 * 已 PAID 重複按 → 409，不是靜默成功。
 */
export const POST = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  const { data: cur, error: rerr } = await t.supabase
    .from('tour_orders').select('status, payment_status')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (rerr) throw rerr;
  if (!cur) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  if (cur.status === 'CANCELLED')
    return fail(409, '已取消的訂單無法確認收款', ERR.CONFLICT);
  if (cur.payment_status === 'PAID')
    return fail(409, '此訂單已確認收款', ERR.CONFLICT);
  if (cur.payment_status === 'REFUNDED')
    return fail(409, '已退款的訂單無法再確認收款', ERR.CONFLICT);

  const { data, error } = await t.supabase.from('tour_orders')
    .update({
      payment_status: 'PAID',
      // COMPLETED 的訂單補確認收款時不要把狀態往回推
      status: cur.status === 'PENDING' ? 'CONFIRMED' : cur.status,
      hold_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', t.tenantId).eq('id', id)
    .select('*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此訂單', ERR.NOT_FOUND);

  return ok(mapTourOrder(data));
});
