/** 預約詳情視窗與金額操作的純函式（#933）。 */

/** 金額變更成功後，把詳情視窗快照的 finalPrice 同步為 API 回傳的新金額（id 不符則原樣回傳）。 */
export function syncDetailFinalPrice<T extends { id: string; finalPrice: number }>(
  prev: T | null, bookingId: string, finalPrice: number,
): T | null {
  return prev && prev.id === bookingId ? { ...prev, finalPrice } : prev;
}

/** 已取消或未到店的預約不可標記現場已收款（與 server mark-paid-offline 一致）。 */
export function canMarkPaidOffline(status: string): boolean {
  return status !== 'CANCELLED' && status !== 'NO_SHOW';
}
