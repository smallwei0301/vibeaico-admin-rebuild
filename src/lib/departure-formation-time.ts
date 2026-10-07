import { DEFAULT_TENANT_TIME_ZONE, isValidTenantTimeZone } from '@/config/tenant-settings';
import { getGuideDepartureDueAt, normalizeGuideTimeZone } from '@/lib/guide-action-inbox';

/** Missing legacy settings use the canonical default; corrupt settings fail closed. */
export function formationTimeZone(value: unknown): string {
  if (value === undefined) return DEFAULT_TENANT_TIME_ZONE;
  if (typeof value !== 'string' || !value.trim() || !isValidTenantTimeZone(value.trim())) {
    throw new Error('店家時區設定無效，請先確認基本設定');
  }
  return normalizeGuideTimeZone(value);
}

export function formationLocalDateTime(instant: string, zone: string): string {
  const timeZone = formationTimeZone(zone);
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error('成團截止時間無效');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Reuse the canonical GUIDE wall-clock conversion, rejecting DST gaps/folds. */
export function formationWallTimeToIso(date: string, time: string | null | undefined, zone: string): string {
  const timeZone = formationTimeZone(zone);
  const localTime = time || '00:00';
  const expected = `${date}T${localTime.length === 5 ? `${localTime}:00` : localTime}`;
  const instant = getGuideDepartureDueAt(date, localTime, timeZone);
  if (!instant || formationLocalDateTime(instant, timeZone) !== expected) {
    throw new Error('此時區的日期或時間不存在，請選擇有效的出發或截止時間');
  }
  // Modern DST folds may repeat an hour (or 30 minutes). Never silently choose
  // one offset for an ambiguous admin wall-time input.
  for (const minutes of [-120, -90, -60, -30, 30, 60, 90, 120]) {
    if (formationLocalDateTime(new Date(Date.parse(instant) + minutes * 60000).toISOString(), timeZone) === expected) {
      throw new Error('此時區因夏令時間有重複時段，請選擇其他出發或截止時間');
    }
  }
  return instant;
}

/** Calendar-day subtraction preserves the tenant wall clock across DST. */
export function formationDefaultDeadline(date: string, time: string | null | undefined, days: number, zone: string): string {
  const calendar = new Date(`${date}T12:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() - days);
  return formationWallTimeToIso(calendar.toISOString().slice(0, 10), time, zone);
}

/** 表單 datetime-local 值（YYYY-MM-DDTHH:mm）換算為 UTC ISO；空值、格式錯或 DST 不存在／重複時段回傳 null，不丟例外。 */
export function tryFormationLocalToIso(local: string, zone: string): string | null {
  if (!local) return null;
  const [date, time] = local.split('T');
  try {
    return formationWallTimeToIso(date, time, zone);
  } catch {
    return null;
  }
}
