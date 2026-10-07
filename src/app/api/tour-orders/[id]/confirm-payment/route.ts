import { z } from 'zod';
import { handle, ok, fail, ERR, readOptionalJsonBody, PUBLIC_JSON_BODY_LIMIT_BYTES } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { canRegisterDepositPayment, canRegisterFullPayment, canTransitionTourOrder } from '@/server/tour-domain';
import { hydrateTourOrders } from '@/server/tour-orders';

type Context = { params: Promise<{ id: string }> };

/** #769：kind 省略 = FULL（相容既有無 body 的呼叫）。 */
const bodySchema = z.object({ kind: z.enum(['DEPOSIT', 'FULL']).optional() });

/** 空 body 合法（= FULL）；非空必須是合法 JSON 並通過 zod。上限以串流位元組計（超限 413）。 */
async function readKind(req: Request): Promise<'DEPOSIT' | 'FULL'> {
  const raw = await readOptionalJsonBody(req, PUBLIC_JSON_BODY_LIMIT_BYTES);
  if (raw === undefined) return 'FULL';
  return bodySchema.parse(raw).kind ?? 'FULL';
}

/**
 * POST /api/tour-orders/:id/confirm-payment — 導遊確認收款（#8-B，10 分冊 §3）。
 *
 * `PENDING → CONFIRMED`（#769 起另允許已接受未付款的 `CONFIRMED + UNPAID` 申請單，status 維持 CONFIRMED），同時 `payment_status → PAID`、清掉 `hold_expires_at`
 * （已收款的單不該再被逾期 cron 取消）。
 *
 * #769（Owner 2026-10-07）：body `{ kind?: 'DEPOSIT' | 'FULL' }`，省略 = FULL。
 * - FULL：PENDING+UNPAID、CONFIRMED+UNPAID、CONFIRMED+PARTIAL（補尾款）→ `PAID`、paid = total。
 * - DEPOSIT：只限 CONFIRMED+UNPAID+已鎖名額，且 DB 的 `deposit_amount` 滿足 0 < x < total
 *   → `PARTIAL`、paid = deposit_amount（取 DB 值，不信 body）、清 hold（已收訂金不再自動逾期）。
 *
 * ⚠️ 這支**不做任何真實金流**。它記錄的是「導遊說他收到錢了」——匯款五碼比對、
 * 綠界 callback 都屬後續切片。名字叫 confirm-payment 但只改狀態，是刻意的：
 * 手動單本來就是線下收款。
 *
 * ⚠️ Final Risk B2（claude-fable-5-1，#46）：REQUEST 訂單在導遊接受
 * （`accept_tour_request`）之前 `seats_reserved = false`，代表名額根本還沒鎖。
 * 這支路由原本只看 `status` 轉換合不合法，不看 `seats_reserved`——若對一筆還
 * 沒被接受的 PENDING REQUEST 訂單呼叫，會做出「已收款、已確認」的訂單，但席次
 * 從未真的鎖住，等於允許一筆得到店家承諾、卻沒有真實名額支撐的訂單，是這個
 * Issue 在修的同一種假成功換一個進入點。修法：`seats_reserved = false` 一律
 * 409，要求先呼叫 `/accept` 完成原子重查與鎖位，才能確認收款。
 */
export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const kind = await readKind(req);

  const { data: current, error: readError } = await t.supabase.from('tour_orders')
    .select('id, status, payment_status, total_amount, deposit_amount, seats_reserved').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  // 已經是 CONFIRMED 也回 409：店家按下去沒有發生他以為會發生的事，就必須被告知。
  const eligible = kind === 'DEPOSIT'
    ? canRegisterDepositPayment({
      status: current.status, paymentStatus: current.payment_status, seatsReserved: current.seats_reserved,
      depositAmount: current.deposit_amount, totalAmount: current.total_amount,
    })
    : current.status === 'CONFIRMED'
      ? canRegisterFullPayment({
        status: current.status, paymentStatus: current.payment_status, seatsReserved: current.seats_reserved,
      })
      : canTransitionTourOrder(current.status, 'CONFIRMED') && current.payment_status === 'UNPAID';
  if (!eligible) return fail(409, '此訂單狀態已變更', ERR.CONFLICT);
  if (!current.seats_reserved) {
    return fail(409, '此訂單尚未鎖定名額，請先接受申請', ERR.TOUR_REQUEST_NOT_ELIGIBLE);
  }

  const patch = kind === 'DEPOSIT'
    ? {
      // 只收訂金：PARTIAL 的 CHECK 要求 0 < paid < total（0108）；已收訂金不再自動逾期取消。
      status: 'CONFIRMED', payment_status: 'PARTIAL', paid_amount: Number(current.deposit_amount),
      hold_expires_at: null, updated_at: new Date().toISOString(),
    }
    : {
      // status 不寫新意義：PENDING 路徑由 CAS 保證 → 需轉 CONFIRMED；已 CONFIRMED 者維持原值。
      status: 'CONFIRMED', payment_status: 'PAID',
      /**
       * ⚠️ `payment_status = 'PAID'` 必須連同**實收金額**一起寫（0087 的
       * `paid_amount = total_amount` 約束；一筆「已付款」而實收 0 元就是假宣稱）。
       */
      paid_amount: current.total_amount,
      hold_expires_at: null, updated_at: new Date().toISOString(),
    };

  const { data, error } = await t.supabase.from('tour_orders')
    .update(patch)
    // CAS：帶 status 與「讀到的 payment_status」。兩個店員同時按，或與逾期 cron（取消後 status = CANCELLED）並發時 CAS 不中 → 409。
    .eq('tenant_id', t.tenantId).eq('id', id).eq('status', current.status).eq('payment_status', current.payment_status)
    .select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(409, '此訂單狀態已變更', ERR.CONFLICT);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [data]);
  return ok(order);
});
