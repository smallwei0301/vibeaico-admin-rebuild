import { TOUR_ORDER_AUTO_EXPIRE_REASON } from '@/lib/tour-reject-reason';
import { PUBLIC_DEFAULT_TIME_ZONE, resolvePublicTimeZone } from '@/lib/public-time-zone';

/**
 * 旅客訂單狀態頁（#917）的純函式格式化。
 * - 出發日期是 YYYY-MM-DD 純日期字串：直接解析年月日，不可用 `new Date('YYYY-MM-DD')`
 *   （UTC 零點，西半球會退一天）。
 * - 時間點（付款期限、申請時間）以店家時區顯示，與執行環境所在時區無關。
 */

/** 2026-11-02 -> 2026/11/02（一）；格式不符回傳 null，由呼叫端決定如何顯示原值。 */
export function formatPlainDateWithWeekday(value: string, weekdays: readonly string[]): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ts = Date.UTC(y, mo - 1, d);
  const probe = new Date(ts);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const label = weekdays[probe.getUTCDay()];
  const base = `${m[1]}/${m[2]}/${m[3]}`;
  return label ? `${base}（${label.replace(/^週/, '')}）` : base;
}

/** ISO 時間點 -> `YYYY/MM/DD HH:mm`（店家時區，缺值／無效回退 Asia/Taipei）；無法解析回傳 null。 */
export function formatInstantInTimeZone(iso: string, timeZone?: unknown): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const zone = timeZone === undefined ? PUBLIC_DEFAULT_TIME_ZONE : resolvePublicTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

/** CANCELLED 的說明分流：UNPAID 沿用婉拒／逾期說明，已付款相關狀態改走退款指引。 */
export type CancelledCopyKind = 'UNPAID' | 'PAID' | 'REFUNDED';

export function cancelledCopyKind(paymentStatus: string | null | undefined): CancelledCopyKind {
  if (paymentStatus === 'REFUNDED') return 'REFUNDED';
  if (paymentStatus === 'PAID' || paymentStatus === 'PARTIAL' || paymentStatus === 'REFUND_PENDING') return 'PAID';
  return 'UNPAID';
}

/** 已鎖位的非申請制訂單（FIXED_DEPARTURE／INSTANT）；salesMode 未知時視同申請制，與 PENDING 分支一致。 */
export function isLockedBooking(order: { salesMode?: string | null }): boolean {
  return order.salesMode !== undefined && order.salesMode !== null && order.salesMode !== 'REQUEST';
}

/**
 * #944：旅客狀態頁可見的「店家說明」。`cancel_reason` 是自由文字欄位、沒有寫入者欄位，
 * 所以用最保守的組合判斷（缺一不顯示）：
 *   - 已取消、方案為 REQUEST（拒絕申請只存在於 REQUEST 單）、且非手動建單；
 *     殘餘風險：tour_orders 無不可變的 sales_mode 快照，公開 FIXED／INSTANT 單（source=LINE）
 *     若方案日後改為 REQUEST 且店家取消時寫了備註，仍無法與申請單區分（需另案 migration 加快照欄位）；
 *   - 未付款（已付款／退款流程的取消單理由可能含退款備註，不對外）；
 *   - 理由非空，且不是 `expire_tour_order` 的系統逾期標記（唯一已知的系統寫入者，見 cron）。
 * 其餘一律回 null。回傳為純文字，呼叫端以 React 文字節點渲染（自動跳脫）。
 */
export function travelerVisibleRejectReason(order: {
  status: string;
  paymentStatus: string;
  salesMode?: string | null;
  source?: string | null;
  cancelReason?: string | null;
}): string | null {
  if (order.status !== 'CANCELLED') return null;
  if (order.salesMode !== 'REQUEST') return null;
  // 手動建單（source=MANUAL）一律不是旅客申請；方案 sales_mode 可事後被店家改成 REQUEST，
  // 不能單靠它判斷來源。hold_expires_at 無法區分（公開 FIXED／INSTANT 與手動單建立時也是 null），故不採用。
  if (order.source === 'MANUAL') return null;
  if (order.paymentStatus !== 'UNPAID') return null;
  const reason = (order.cancelReason ?? '').trim();
  if (!reason || reason === TOUR_ORDER_AUTO_EXPIRE_REASON) return null;
  return reason;
}
