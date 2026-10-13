/**
 * 旅客訂單狀態頁的「付款方式」顯示規則與公開欄位型別（issue #938）。
 * 純函式，不依賴 server；loader 在 `src/server/public-payment-methods.ts`。
 */
import type { TourOrder } from '@/lib/types';

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

/** 僅「尚未付款且訂單未取消」時才向旅客展示收款方式。 */
export function shouldShowPaymentMethods(order: Pick<TourOrder, 'status' | 'paymentStatus'>): boolean {
  if (order.status === 'CANCELLED' || order.status === 'COMPLETED') return false;
  return order.paymentStatus === 'UNPAID';
}
