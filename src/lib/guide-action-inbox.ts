import type { GuideActionInboxItem, GuideActionInboxPriority } from '@/lib/types';

export type { GuideActionInboxItem, GuideActionInboxPriority } from '@/lib/types';

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

function taipeiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * PENDING 預約的處理優先級：已過預約時間最急，其次是台北今天，最後是未來。
 * 讓 mock 與真實 API 共用同一套顯示語意，避免前端自行猜測資料狀態。
 */
export function getGuideActionInboxPriority(
  startAt: string,
  now: Date = new Date(),
): GuideActionInboxPriority {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return 'UPCOMING';
  if (start.getTime() <= now.getTime()) return 'IMMEDIATE';
  return taipeiDateKey(start) === taipeiDateKey(now) ? 'TODAY' : 'UPCOMING';
}
