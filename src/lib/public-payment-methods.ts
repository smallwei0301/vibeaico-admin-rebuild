/**
 * 旅客訂單狀態頁的「付款方式」顯示規則與公開欄位型別（issue #938）。
 * 純函式，不依賴 server；loader 在 `src/server/public-payment-methods.ts`。
 */
import type { TourOrder } from '@/lib/types';
import { isLockedBooking } from '@/lib/public-order-format';

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
 * 僅「尚未付款且訂單未取消／未完成」時才向旅客展示收款方式。
 * PENDING 時只有已鎖位（isLockedBooking：INSTANT／FIXED_DEPARTURE）才顯示；
 * 申請制（REQUEST 或 salesMode 未知）導遊尚未接受、名額未鎖，不鼓勵旅客先付款。
 */
export function shouldShowPaymentMethods(
  order: Pick<TourOrder, 'status' | 'paymentStatus' | 'salesMode'>,
): boolean {
  if (order.status === 'CANCELLED' || order.status === 'COMPLETED') return false;
  if (order.status === 'PENDING' && !isLockedBooking(order)) return false;
  return order.paymentStatus === 'UNPAID';
}
