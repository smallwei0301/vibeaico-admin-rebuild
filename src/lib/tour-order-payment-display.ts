/**
 * #1000：店家團體訂單頁的收款顯示。
 *
 * `depositAmount` = 建單時設定的「應收定金」（不是已收）；實收金額是 `paidAmount`（paid_amount）。
 * paidAmount 缺失／非有限／<=0（例如 mock 資料無此欄位）視為未知，不顯示已收。
 * 待收尾款只在 PARTIAL 且 total − paid > 0 時顯示；已取消的部分付款訂單仍顯示已收金額（退款脈絡），但不顯示待收尾款；應收定金（列表與詳情共用 `isDepositDue`）與收款動作同源：只在 `tourPaymentActions` 提供「確認收到訂金」（`confirmDeposit`）時顯示，即 CONFIRMED、UNPAID、非待接受 REQUEST 且 0 < 定金 < 總額；其餘狀態系統只能登記全額，不提示定金，避免顯示與實際記帳不一致。
 */
import type { TourOrder } from '@/lib/types';
import { partialPaymentBreakdown } from '@/lib/public-partial-payment';
import { tourPaymentActions } from '@/lib/tour-order-payment-actions';

type PaymentFields = Pick<TourOrder, 'status' | 'paymentStatus' | 'totalAmount' | 'depositAmount' | 'paidAmount'> &
  Partial<Pick<TourOrder, 'salesMode'>>;

export function validPaidAmount(order: Pick<TourOrder, 'paidAmount'>): number | null {
  const p = order.paidAmount;
  return p != null && Number.isFinite(p) && p > 0 ? p : null;
}

/** 應收定金的唯一判斷：與「確認收到訂金」動作同源，顯示與可登記的收款一致。 */
export function isDepositDue(order: Parameters<typeof tourPaymentActions>[0]): boolean {
  return tourPaymentActions(order).includes('confirmDeposit');
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
