import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { canTransitionTourOrder } from '@/server/tour-domain';
import { hydrateTourOrders } from '@/server/tour-orders';

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/tour-orders/:id/confirm-payment — 導遊確認收款（#8-B，10 分冊 §3）。
 *
 * `PENDING → CONFIRMED`，同時 `payment_status → PAID`、清掉 `hold_expires_at`
 * （已收款的單不該再被逾期 cron 取消）。
 *
 * ⚠️ 這支**不做任何真實金流**。它記錄的是「導遊說他收到錢了」——匯款五碼比對、
 * 綠界 callback 都屬後續切片。名字叫 confirm-payment 但只改狀態，是刻意的：
 * 手動單本來就是線下收款。
 */
export const POST = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');

  const { data: current, error: readError } = await t.supabase.from('tour_orders')
    .select('id, status, total_amount').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  // 已經是 CONFIRMED 也回 409：店家按下去沒有發生他以為會發生的事，就必須被告知。
  if (!canTransitionTourOrder(current.status, 'CONFIRMED')) {
    return fail(409, '此訂單狀態已變更', ERR.CONFLICT);
  }

  const { data, error } = await t.supabase.from('tour_orders')
    .update({
      status: 'CONFIRMED', payment_status: 'PAID',
      /**
       * ⚠️ `payment_status = 'PAID'` 必須連同**實收金額**一起寫。
       *
       * 初版只翻旗標、沒寫金額，被 CI 的 23514 擋下來：historical overlay 的
       * `tour_orders` 帶著 `check (payment_status <> 'PAID' or paid_amount = total_amount)`。
       * 那個約束是對的——一筆「已付款」而實收 0 元的訂單，就是這整張 issue 在修的
       * 那種假宣稱：畫面說收到錢了，資料庫裡沒有任何金額佐證。canonical 的 `0087`
       * 因此補上同一個不變量（見該檔「實收金額」段），而不是把測試改成接受它。
       */
      paid_amount: current.total_amount,
      hold_expires_at: null, updated_at: new Date().toISOString(),
    })
    // 帶上 status 條件做 CAS：兩個店員同時按，只有一個會 match。
    .eq('tenant_id', t.tenantId).eq('id', id).eq('status', current.status)
    .select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(409, '此訂單狀態已變更', ERR.CONFLICT);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [data]);
  return ok(order);
});
