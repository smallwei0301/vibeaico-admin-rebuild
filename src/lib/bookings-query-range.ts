/** 首頁「今日預約」與預約頁「未處理」查詢用的時間範圍純函式（#908）。 */
import { PUBLIC_DEFAULT_TIME_ZONE, resolvePublicTimeZone } from '@/lib/public-time-zone';


/** 店家時區的「現在」日期（YYYY-MM-DD）。 */
export function tenantDateString(
  now: Date = new Date(), timeZone: string = PUBLIC_DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvePublicTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** 店家時區在某個 UTC 毫秒的當地日期（YYYY-MM-DD）。 */
function zonedDateAt(zone: string, atMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(atMs));
}

/**
 * 店家時區當地日期 `ymd` 的第一個有效瞬間（UTC 毫秒）。
 * 午夜發生 DST 跳時（如 America/Havana、America/Santiago，00:00 直接跳到 01:00）時當地 00:00 不存在，
 * 取當天第一個真實存在的瞬間；以「當地日期 >= ymd」的最小分鐘做二分搜尋，對非 DST 日等同 00:00。
 */
function zonedDayStartMs(zone: string, ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const HOUR = 3600_000;
  // 偏移範圍 UTC-12 ~ UTC+14：wall-15h 當地必早於 ymd，wall+27h 當地必不早於 ymd。
  let lo = Math.floor((wall - 15 * HOUR) / 60_000);
  let hi = Math.floor((wall + 27 * HOUR) / 60_000);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (zonedDateAt(zone, mid * 60_000) >= ymd) hi = mid; else lo = mid + 1;
  }
  return lo * 60_000;
}

/** 店家時區某個 YYYY-MM-DD 當天第一個有效瞬間 ~ 當天最後一毫秒，轉成 UTC ISO（含當天，#933）。 */
export function zonedDayRange(
  ymd: string, timeZone: string = PUBLIC_DEFAULT_TIME_ZONE,
): { from: string; to: string } {
  const zone = resolvePublicTimeZone(timeZone);
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return {
    from: new Date(zonedDayStartMs(zone, ymd)).toISOString(),
    to: new Date(zonedDayStartMs(zone, next) - 1).toISOString(),
  };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 預約列表 from/to 篩選值轉成 UTC ISO（#933）：純日期 YYYY-MM-DD 依店家時區日界線，
 * from＝當天 00:00、to＝當天結束（含當天）；完整 ISO 時間字串（首頁/未處理既有呼叫端）原樣通過。
 */
export function bookingFilterBound(
  value: string, edge: 'from' | 'to', timeZone: string = PUBLIC_DEFAULT_TIME_ZONE,
): string {
  if (!YMD_RE.test(value)) return value;
  return zonedDayRange(value, timeZone)[edge];
}

/** 店家時區（預設 Asia/Taipei）`now` 當天 00:00:00.000 ~ 23:59:59.999，轉成 UTC ISO。 */
export function tenantDayRange(
  now: Date = new Date(), timeZone: string = PUBLIC_DEFAULT_TIME_ZONE,
): { from: string; to: string } {
  const zone = resolvePublicTimeZone(timeZone);
  return zonedDayRange(tenantDateString(now, zone), zone);
}

/** 合併「待確認」與「已確認」兩次查詢的結果，依 startAt 由新到舊排序。 */
export function mergeUnprocessedBookings<T extends { id: string; startAt: string }>(
  pending: T[], confirmed: T[],
): T[] {
  const seen = new Set<string>();
  return [...pending, ...confirmed]
    .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)))
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
}

/**
 * 「未處理」預約的 API 時間上限：僅在使用者未設結束日期時帶現在時間；
 * 有 endDate 則維持原行為（回傳 undefined）。
 */
export function unprocessedUpperBound(
  status: string, endDate: string | undefined | null, now: Date = new Date(),
): string | undefined {
  if (status !== 'UNPROCESSED' || endDate) return undefined;
  return now.toISOString();
}
