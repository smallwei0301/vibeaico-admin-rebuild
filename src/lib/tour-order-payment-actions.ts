import { hasPartialDeposit } from '@/server/tour-domain';

/** 訂單可登記的收款動作；列表列與詳情 Modal 共用同一份規則，避免兩處條件分歧。 */
export type TourPaymentActionKind = 'confirmPayment' | 'confirmDeposit' | 'confirmFull' | 'confirmBalance';

type PaymentActionOrder = {
  status: string;
  paymentStatus: string | null | undefined;
  depositAmount: number | null | undefined;
  totalAmount: number | null | undefined;
};

/**
 * 依訂單狀態回傳可顯示的收款動作（順序即顯示順序）：
 * - CONFIRMED／UNPAID 且 0<訂金<總額：確認收到訂金＋確認收到全額
 * - CONFIRMED／PARTIAL：確認收到尾款
 * - 其餘未取消的 UNPAID（含 PENDING）：確認收款（全額）
 * - 已付清、已取消等：無
 */
export function tourPaymentActions(order: PaymentActionOrder): TourPaymentActionKind[] {
  if (order.status !== 'CANCELLED' && order.paymentStatus === 'UNPAID' && order.status === 'CONFIRMED' && hasPartialDeposit(order)) {
    return ['confirmDeposit', 'confirmFull'];
  }
  if (order.status === 'CONFIRMED' && order.paymentStatus === 'PARTIAL') return ['confirmBalance'];
  if (order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED') return ['confirmPayment'];
  return [];
}
