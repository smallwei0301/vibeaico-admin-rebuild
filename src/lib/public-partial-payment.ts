/**
 * #988：旅客訂單狀態頁的「已付金額／待付尾款」。
 *
 * 欄位語意（查證）：`paid_amount` = 實際已收（confirm-payment 寫入；0109 CHECK：
 * PARTIAL 時 0 < paid < total）；`deposit_amount` = 應付訂金（不是已收）。
 * 尾款沿用後端 guide-action-inbox 語意：total − paid，不扣 refunded_amount
 * （已退款的訂單 payment_status 會離開 PARTIAL，PARTIAL 下 refunded 不影響尾款）。
 * 已取消（CANCELLED）訂單：取消 route 只改 status、不動 payment_status，故 CANCELLED + PARTIAL 是合法狀態；
 * 此時頁面已顯示「此訂單已取消」，不可再顯示「待付尾款」造成旅客誤以為仍須付款，一律回傳 null。
 * paidAmount 缺失／非有限／<=0／>=total 視為不可靠，回傳 null（不顯示）。
 */
import type { TourOrder } from '@/lib/types';

export type PartialPaymentBreakdown = { paidAmount: number; balanceDue: number };

export function partialPaymentBreakdown(
  order: Pick<TourOrder, 'status' | 'paymentStatus' | 'totalAmount' | 'paidAmount'>,
): PartialPaymentBreakdown | null {
  if (order.status === 'CANCELLED') return null;
  if (order.paymentStatus !== 'PARTIAL') return null;
  const paid = order.paidAmount;
  if (paid == null || !Number.isFinite(paid) || paid <= 0) return null;
  const balance = order.totalAmount - paid;
  if (!Number.isFinite(balance) || balance <= 0) return null;
  return { paidAmount: paid, balanceDue: balance };
}

/**
 * #917：已取消且曾付款的訂單，狀態頁仍要讓旅客看到「已付金額」（供與店家洽談退款）。
 * 只在 CANCELLED + (PARTIAL | PAID) 且 paidAmount 為大於 0 的有限數值時回傳；其餘回 null。
 * 不含待付尾款，且不改動 partialPaymentBreakdown 對 CANCELLED 的行為（#994 依賴）。
 */
export function cancelledPaidAmount(
  order: Pick<TourOrder, 'status' | 'paymentStatus' | 'paidAmount'>,
): number | null {
  if (order.status !== 'CANCELLED') return null;
  if (order.paymentStatus !== 'PARTIAL' && order.paymentStatus !== 'PAID') return null;
  const paid = order.paidAmount;
  if (paid == null || !Number.isFinite(paid) || paid <= 0) return null;
  return paid;
}
