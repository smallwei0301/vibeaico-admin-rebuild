import type { PaymentStatus } from '@/lib/types';

/** 與 API（BOOKING_PAYMENT_STATUS）接受的付款狀態一致。 */
export const BOOKING_PAYMENT_FILTER_VALUES: readonly PaymentStatus[] = [
  'UNPAID', 'PAID_ONLINE', 'PAID_OFFLINE', 'REFUNDED',
];

/** 解析網址 paymentStatus 參數；非法或空值回傳空字串（不篩選）。 */
export function parsePaymentStatusParam(value: string | null | undefined): PaymentStatus | '' {
  return BOOKING_PAYMENT_FILTER_VALUES.find((v) => v === value) ?? '';
}

/** #1020：列表查詢序號檢查——只有最新一次請求的回應可以寫入畫面狀態。 */
export function isLatestRequest(seq: number, current: number): boolean {
  return seq === current;
}
