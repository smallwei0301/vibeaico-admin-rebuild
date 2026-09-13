import {
  DEFAULT_TENANT_TIME_ZONE,
  isValidTenantTimeZone,
} from '@/config/tenant-settings';
import type {
  GuideActionInboxDepartureDay,
  GuideActionInboxItem,
  GuideActionInboxPriority,
} from '@/lib/types';

export type {
  GuideActionInboxDepartureDay,
  GuideActionInboxItem,
  GuideActionInboxPriority,
} from '@/lib/types';

export const DEFAULT_GUIDE_TIME_ZONE = DEFAULT_TENANT_TIME_ZONE;

const PRIORITY_ORDER: Record<GuideActionInboxPriority, number> = {
  IMMEDIATE: 0,
  TODAY: 1,
  UPCOMING: 2,
};

function comparableTime(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

/** 先按處理優先級，再按出發時間、建立時間與 id，保持列表穩定可測試。 */
export function sortGuideActionInboxItems(items: GuideActionInboxItem[]): GuideActionInboxItem[] {
  return [...items].sort((a, b) =>
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      || comparableTime(a.dueAt) - comparableTime(b.dueAt)
      || comparableTime(a.createdAt) - comparableTime(b.createdAt)
      || a.id.localeCompare(b.id),
  );
}

/** 缺值或舊資料含無效 IANA 時區時，安全回退租戶預設時區。 */
export function normalizeGuideTimeZone(value: unknown): string {
  const candidate = typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_GUIDE_TIME_ZONE;
  return isValidTenantTimeZone(candidate) ? candidate : DEFAULT_GUIDE_TIME_ZONE;
}

function dateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeGuideTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeGuideTimeZone(timeZone),
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return zonedAsUtc - instant.getTime();
}

/** 將資料庫的 tenant-local date/time 轉成真正 instant，供跨類型排序使用。 */
export function getGuideDepartureDueAt(
  departsOn: string,
  startTime: string,
  timeZone: string = DEFAULT_GUIDE_TIME_ZONE,
): string {
  const dateMatch = String(departsOn).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(startTime || '00:00').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return '';

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  if (
    month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59
  ) return '';

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const localDate = new Date(localAsUtc);
  if (
    localDate.getUTCFullYear() !== year
    || localDate.getUTCMonth() !== month - 1
    || localDate.getUTCDate() !== day
  ) return '';

  // Two iterations are enough for normal IANA offset/DST transitions; the
  // extra pass keeps the result stable when the first estimate crosses one.
  let instantMs = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instantMs = localAsUtc - timeZoneOffsetMs(new Date(instantMs), timeZone);
  }
  return new Date(instantMs).toISOString();
}

export function getGuideActionInboxDateWindow(
  now: Date = new Date(),
  timeZone: string = DEFAULT_GUIDE_TIME_ZONE,
): { today: string; tomorrow: string } {
  const today = dateKey(now, timeZone);
  return { today, tomorrow: addCalendarDays(today, 1) };
}

/** 僅把今天與明天的非取消團次放進 GUIDE 首頁，日期邊界由租戶時區決定。 */
export function getGuideDepartureDay(
  departsOn: string,
  now: Date = new Date(),
  timeZone: string = DEFAULT_GUIDE_TIME_ZONE,
): GuideActionInboxDepartureDay | null {
  const target = String(departsOn).slice(0, 10);
  const { today, tomorrow } = getGuideActionInboxDateWindow(now, timeZone);
  if (target === today) return 'TODAY';
  if (target === tomorrow) return 'TOMORROW';
  return null;
}

/**
 * PENDING 預約的處理優先級：已過預約時間最急，其次是租戶今天，最後是未來。
 * 舊租戶沒有自訂時區時回退 Asia/Taipei；前端不自行猜測日期邊界。
 */
export function getGuideActionInboxPriority(
  startAt: string,
  now: Date = new Date(),
  timeZone: string = DEFAULT_GUIDE_TIME_ZONE,
): GuideActionInboxPriority {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return 'UPCOMING';
  if (start.getTime() <= now.getTime()) return 'IMMEDIATE';
  return dateKey(start, timeZone) === dateKey(now, timeZone) ? 'TODAY' : 'UPCOMING';
}
