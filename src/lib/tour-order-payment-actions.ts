import { hasPartialDeposit } from '@/server/tour-domain';

/** 訂單可登記的收款動作；列表列與詳情 Modal 共用同一份規則，避免兩處條件分歧。 */
export type TourPaymentActionKind = 'confirmPayment' | 'confirmDeposit' | 'confirmFull' | 'confirmBalance';

type PaymentActionOrder = {
  status: string;
  salesMode?: string | null;
  paymentStatus: string | null | undefined;
  depositAmount: number | null | undefined;
  totalAmount: number | null | undefined;
};

/**
 * 「還在等導遊決定的 REQUEST 申請」：名額尚未鎖定（seats_reserved=false），confirm-payment 必回 409。
 * 詳情頁的接受／拒絕區塊與收款動作共用此判斷，兩者互斥、同一來源。
 */
export function isPendingTourRequest(order: { salesMode?: string | null; status: string }): boolean {
  return order.salesMode === 'REQUEST' && order.status === 'PENDING';
}

/**
 * 依訂單狀態回傳可顯示的收款動作（順序即顯示順序）：
 * - CONFIRMED／UNPAID 且 0<訂金<總額：確認收到訂金＋確認收到全額
 * - CONFIRMED／PARTIAL：確認收到尾款
 * - 其餘 PENDING／CONFIRMED 的 UNPAID：確認收款（全額）
 * - 未接受的 REQUEST（PENDING）、已付清、COMPLETED／CANCELLED 終態（route 會回 409）等：無
 */
export function tourPaymentActions(order: PaymentActionOrder): TourPaymentActionKind[] {
  // confirm-payment 只接受 PENDING／CONFIRMED（COMPLETED、CANCELLED 是終態，canTransitionTourOrder 為 false，route 回 409）。
  if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') return [];
  if (isPendingTourRequest(order)) return [];
  if (order.paymentStatus === 'UNPAID' && order.status === 'CONFIRMED' && hasPartialDeposit(order)) {
    return ['confirmDeposit', 'confirmFull'];
  }
  if (order.status === 'CONFIRMED' && order.paymentStatus === 'PARTIAL') return ['confirmBalance'];
  if (order.paymentStatus === 'UNPAID') return ['confirmPayment'];
  return [];
}
