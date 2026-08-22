/**
 * src/server/tz.ts — Asia/Taipei（固定 +08:00，無日光節約）日期範圍小工具。
 * A-5 報表端點用來把「今天／本月」換算成正確的 UTC ISO 起訖，餵給
 * bookings.start_at 這類 timestamptz 欄位的 gte/lt 查詢。
 *
 * 作法：取目前 UTC 時間 +8 小時視為「台北牆上時鐘」，用 getUTC* 讀出
 * 年/月/日欄位（避免 Node 執行環境時區影響 getFullYear 等本地方法），
 * 再用 Date.UTC 組出「台北當天 00:00」對應的 UTC 瞬間 = UTC(y,m,d,0,0,0) - 8h。
 */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiParts(d: Date = new Date()) {
  const t = new Date(d.getTime() + TAIPEI_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

/** 台北「今天」的起訖 ISO（[fromIso, toIso) 半開區間，today <= x < tomorrow） */
export function taipeiTodayRange(): { fromIso: string; toIso: string } {
  const { y, m, d } = taipeiParts();
  const fromMs = Date.UTC(y, m, d, 0, 0, 0) - TAIPEI_OFFSET_MS;
  const toMs = Date.UTC(y, m, d + 1, 0, 0, 0) - TAIPEI_OFFSET_MS;
  return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
}

/** 台北「本月」的起訖 ISO（[fromIso, toIso) 半開區間） */
export function taipeiMonthRange(): { fromIso: string; toIso: string } {
  const { y, m } = taipeiParts();
  const fromMs = Date.UTC(y, m, 1, 0, 0, 0) - TAIPEI_OFFSET_MS;
  const toMs = Date.UTC(y, m + 1, 1, 0, 0, 0) - TAIPEI_OFFSET_MS;
  return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
}

/** 台北「今天」的 YYYY-MM 月份字串，對應 push_quota_usage.month */
export function taipeiCurrentMonthKey(): string {
  const { y, m } = taipeiParts();
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** 台北「今天」的 YYYY-MM-DD 日期字串，用來跟 bookingCutoffDate 這類純日期欄位比較 */
export function taipeiTodayDateString(): string {
  const { y, m, d } = taipeiParts();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
