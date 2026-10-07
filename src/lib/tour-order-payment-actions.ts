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
 * - 其餘未取消的 UNPAID（含 PENDING）：確認收款（全額）
 * - 未接受的 REQUEST（PENDING）、已付清、已取消等：無
 */
export function tourPaymentActions(order: PaymentActionOrder): TourPaymentActionKind[] {
  if (isPendingTourRequest(order)) return [];
  if (order.status !== 'CANCELLED' && order.paymentStatus === 'UNPAID' && order.status === 'CONFIRMED' && hasPartialDeposit(order)) {
    return ['confirmDeposit', 'confirmFull'];
  }
  if (order.status === 'CONFIRMED' && order.paymentStatus === 'PARTIAL') return ['confirmBalance'];
  if (order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED') return ['confirmPayment'];
  return [];
}
