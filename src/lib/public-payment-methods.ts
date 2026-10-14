/**
 * 旅客訂單狀態頁的「付款方式」顯示規則與公開欄位型別（issue #938）。
 * 純函式，不依賴 server；loader 在 `src/server/public-payment-methods.ts`。
 */
import type { TourOrder } from '@/lib/types';
import { isAwaitingPayment } from '@/server/tour-domain';

export type PublicPaymentMethodType =
  'LINE_PAY' | 'JKOPAY' | 'BANK_TRANSFER' | 'CASH' | 'ONLINE_PAYMENT' | 'OTHER';

/** 對旅客公開的欄位白名單；config 內其他 key 一律不外洩。 */
export type PublicPaymentMethod = {
  id: string;
  methodType: PublicPaymentMethodType;
  displayName: string;
  qrImageUrl: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  instructions: string;
};

/**
 * 僅「仍待付款且訂單未取消／未完成／未逾期」時才向旅客展示收款方式。
 * - 待付款沿用 `isAwaitingPayment`（UNPAID 與仍有尾款的 PARTIAL）；PAID／REFUND_* 不顯示。
 * - PENDING 時須訂單本身已占位（`seatsReserved === true`，tour_orders.seats_reserved）；
 *   未占位（申請制尚未被接受、或欄位缺失）不鼓勵旅客先付款。CONFIRMED 照舊。
 * - `holdExpiresAt` 已過（< now）代表保留期限已到，不再顯示。
 */
export function shouldShowPaymentMethods(
  order: Pick<TourOrder, 'status' | 'paymentStatus' | 'seatsReserved' | 'holdExpiresAt'>,
  now: Date = new Date(),
): boolean {
  if (order.status === 'CANCELLED' || order.status === 'COMPLETED') return false;
  if (order.status === 'PENDING' && order.seatsReserved !== true) return false;
  if (order.holdExpiresAt) {
    const t = Date.parse(order.holdExpiresAt);
    if (Number.isFinite(t) && t < now.getTime()) return false;
  }
  return isAwaitingPayment(order);
}
