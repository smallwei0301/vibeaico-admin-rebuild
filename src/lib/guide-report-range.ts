import { PUBLIC_DEFAULT_TIME_ZONE, resolvePublicTimeZone } from '@/lib/public-time-zone';

/** 純日曆運算（與時區無關）：YYYY-MM-DD 加減天數 */
export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 指定時區的今天（YYYY-MM-DD） */
export function todayIn(zone: string, nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvePublicTimeZone(zone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs));
}

/**
 * 「近 N 天」預設區間（含今天）。尚未載入過報表、不知道店家時區時，
 * 回退與後端相同的預設時區（Asia/Taipei），讓按鈕在首次載入失敗後仍可用。
 */
export function presetRange(
  days: number, zone: string | undefined, nowMs: number = Date.now(),
): { from: string; to: string } {
  const to = todayIn(zone || PUBLIC_DEFAULT_TIME_ZONE, nowMs);
  return { from: shiftDate(to, -(days - 1)), to };
}

/** 以指定時區顯示一個時間點，並附簡短時區名稱（例：2026/10/07 11:40 [GMT+8]） */
export function formatAsOf(iso: string, zone: string): string {
  const timeZone = resolvePublicTimeZone(zone);
  const base = new Intl.DateTimeFormat('zh-TW', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
  const name = new Intl.DateTimeFormat('zh-TW', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value;
  return name ? `${base} ${name}` : base;
}
