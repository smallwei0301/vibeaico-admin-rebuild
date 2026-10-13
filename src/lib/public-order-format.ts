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
