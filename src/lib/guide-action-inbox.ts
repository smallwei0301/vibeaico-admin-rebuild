import type { GuideActionInboxItem, GuideActionInboxPriority } from '@/lib/types';

export type { GuideActionInboxItem, GuideActionInboxPriority } from '@/lib/types';

export const DEFAULT_GUIDE_TIME_ZONE = 'Asia/Taipei';

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

/**
 * tenant_settings.basic.timezone 是可選的歷史 JSON 欄位。
 * 缺值或無效 IANA 時區時使用 GUIDE 預設 Asia/Taipei，避免 Intl 在請求中拋錯。
 */
export function normalizeGuideTimeZone(value: unknown): string {
  const candidate = typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_GUIDE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return DEFAULT_GUIDE_TIME_ZONE;
  }
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

/**
 * PENDING 預約的處理優先級：已過預約時間最急，其次是租戶今天，最後是未來。
 * GUIDE 沒有自訂時區時才回退 Asia/Taipei；前端不再自行猜測日期邊界。
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
