/** 首頁「今日預約」與預約頁「未處理」查詢用的時間範圍純函式（#908）。 */
import { PUBLIC_DEFAULT_TIME_ZONE, resolvePublicTimeZone } from '@/lib/public-time-zone';


/** 指定時區在某個時間點的 UTC 偏移（毫秒；東區為正）。 */
function zoneOffsetMs(zone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(atMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

/** 店家時區的「現在」日期（YYYY-MM-DD）。 */
export function tenantDateString(
  now: Date = new Date(), timeZone: string = PUBLIC_DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvePublicTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** 店家時區當地 `ymd` 的 hh:mm:ss.ms 對應的 UTC 毫秒（對有夏令時的時區也正確）。 */
function zonedWallToUtcMs(zone: string, ymd: string, h: number, mi: number, s: number, ms: number): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi, s, ms);
  let utc = wall - zoneOffsetMs(zone, wall);
  utc = wall - zoneOffsetMs(zone, utc);
  return utc;
}

/** 店家時區某個 YYYY-MM-DD 當天 00:00:00.000 ~ 23:59:59.999，轉成 UTC ISO（含當天，#933）。 */
export function zonedDayRange(
  ymd: string, timeZone: string = PUBLIC_DEFAULT_TIME_ZONE,
): { from: string; to: string } {
  const zone = resolvePublicTimeZone(timeZone);
  return {
    from: new Date(zonedWallToUtcMs(zone, ymd, 0, 0, 0, 0)).toISOString(),
    to: new Date(zonedWallToUtcMs(zone, ymd, 23, 59, 59, 999)).toISOString(),
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
