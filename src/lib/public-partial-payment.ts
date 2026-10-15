/**
 * #988：旅客訂單狀態頁的「已付金額／待付尾款」。
 *
 * 欄位語意（查證）：`paid_amount` = 實際已收（confirm-payment 寫入；0109 CHECK：
 * PARTIAL 時 0 < paid < total）；`deposit_amount` = 應付訂金（不是已收）。
 * 尾款沿用後端 guide-action-inbox 語意：total − paid，不扣 refunded_amount
 * （已退款的訂單 payment_status 會離開 PARTIAL，PARTIAL 下 refunded 不影響尾款）。
 * paidAmount 缺失／非有限／<=0／>=total 視為不可靠，回傳 null（不顯示）。
 */
import type { TourOrder } from '@/lib/types';

export type PartialPaymentBreakdown = { paidAmount: number; balanceDue: number };

export function partialPaymentBreakdown(
  order: Pick<TourOrder, 'paymentStatus' | 'totalAmount' | 'paidAmount'>,
): PartialPaymentBreakdown | null {
  if (order.paymentStatus !== 'PARTIAL') return null;
  const paid = order.paidAmount;
  if (paid == null || !Number.isFinite(paid) || paid <= 0) return null;
  const balance = order.totalAmount - paid;
  if (!Number.isFinite(balance) || balance <= 0) return null;
  return { paidAmount: paid, balanceDue: balance };
}
