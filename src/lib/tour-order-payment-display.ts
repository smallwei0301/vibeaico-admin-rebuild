/**
 * #1000：店家團體訂單頁的收款顯示。
 *
 * `depositAmount` = 建單時設定的「應收定金」（不是已收）；實收金額是 `paidAmount`（paid_amount）。
 * paidAmount 缺失／非有限／<=0（例如 mock 資料無此欄位）視為未知，不顯示已收。
 * 待收尾款只在 PARTIAL 且 total − paid > 0 時顯示；已取消的部分付款訂單仍顯示已收金額（退款脈絡），但不顯示待收尾款；應收定金（列表與詳情共用 `isDepositDue`）只在未付款（UNPAID）、未取消且 depositAmount > 0 時顯示；PARTIAL／PAID 已有實收，不再顯示應收定金。
 */
import type { TourOrder } from '@/lib/types';
import { partialPaymentBreakdown } from '@/lib/public-partial-payment';

type PaymentFields = Pick<TourOrder, 'status' | 'paymentStatus' | 'totalAmount' | 'depositAmount' | 'paidAmount'>;

export function validPaidAmount(order: Pick<TourOrder, 'paidAmount'>): number | null {
  const p = order.paidAmount;
  return p != null && Number.isFinite(p) && p > 0 ? p : null;
}

/** 應收定金的唯一判斷：列表與詳情共用，避免兩處規則分歧。 */
export function isDepositDue(order: Pick<TourOrder, 'status' | 'paymentStatus' | 'depositAmount'>): boolean {
  return order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED' && order.depositAmount > 0;
}

export type ListPaymentLine =
  | { kind: 'paid'; amount: number }
  | { kind: 'depositDue'; amount: number }
  | null;

export function listPaymentLine(order: PaymentFields): ListPaymentLine {
  const paid = validPaidAmount(order);
  if (order.paymentStatus === 'PARTIAL' && paid != null) return { kind: 'paid', amount: paid };
  if (isDepositDue(order)) return { kind: 'depositDue', amount: order.depositAmount };
  return null;
}

export type DetailPaymentRows = { depositDue: number | null; paid: number | null; balanceDue: number | null };

export function detailPaymentRows(order: PaymentFields): DetailPaymentRows {
  return {
    depositDue: isDepositDue(order) ? order.depositAmount : null,
    paid: validPaidAmount(order),
    balanceDue: partialPaymentBreakdown(order)?.balanceDue ?? null,
  };
}
