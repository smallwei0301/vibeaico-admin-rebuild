import {
  DEFAULT_TENANT_TIME_ZONE,
  isValidTenantTimeZone,
} from '@/config/tenant-settings';
import type {
  DepartureFormationStatus,
  GuideActionInboxDepartureDay,
  GuideActionInboxItem as GuideActionInboxBaseItem,
  GuideActionInboxPriority,
} from '@/lib/types';

export type {
  GuideActionInboxDepartureDay,
  GuideActionInboxPriority,
} from '@/lib/types';

export const DEFAULT_GUIDE_TIME_ZONE = DEFAULT_TENANT_TIME_ZONE;

/*
 * #43 類別 3／4：REVIEW_REQUIRED（成團截止不足）與 AT_RISK（已成團後人數跌破門檻）。
 * `trip_departures.formation_status`（0107, #41 canonical）是這兩個狀態的唯一真相；
 * 這裡只挑出「需要租戶決定」的兩個值，COLLECTING/FORMED/FAILED 不進收件匣，也不在這裡
 * 重新推算成團與否——那是 0107 註記明確保留給日後 transaction 切片的工作。
 *
 * `GuideActionInboxItem` 是 `src/lib/types.ts` 既有聯集再加上這個新變體。新變體寫在這裡
 * 而不是 `src/lib/types.ts`（那個檔案屬另一條 Terra lane，#43 不可碰）；呼叫端一律從這個
 * 檔案 import `GuideActionInboxItem`，不要再直接從 `@/lib/types` 取用這個型別名稱——
 * `src/app/tenant/dashboard/page.tsx` 本來就是這樣 import 的，所以這個聯集一變寬，
 * dashboard 對 kind 的窮舉判斷會被 TS 逼著跟上（這正是要的效果，見該檔案的
 * exhaustive check）。
 */
export type GuideActionInboxFormationKind = Extract<DepartureFormationStatus, 'REVIEW_REQUIRED' | 'AT_RISK'>;

export type GuideActionInboxFormationItem = {
  id: string;
  kind: GuideActionInboxFormationKind;
  tripId: string;
  tripName: string;
  planName: string;
  departureDate: string;
  startTime: string;
  capacity: number;
  seatsBooked: number;
  minToDepart: number;
  formationDeadlineAt: string | null;
  formedParticipants: number | null;
  priority: GuideActionInboxPriority;
  dueAt: string;
  createdAt: string;
  href: string;
};

export type GuideActionInboxItem = GuideActionInboxBaseItem | GuideActionInboxFormationItem;

const FORMATION_INBOX_KINDS: readonly GuideActionInboxFormationKind[] = ['REVIEW_REQUIRED', 'AT_RISK'];

/** 型別守衛：只有這兩個 formation_status 值代表收件匣需要出現的決定。 */
export function isGuideActionInboxFormationStatus(
  status: DepartureFormationStatus | string | null | undefined,
): status is GuideActionInboxFormationKind {
  return status != null && (FORMATION_INBOX_KINDS as readonly string[]).includes(status);
}

const PRIORITY_ORDER: Record<GuideActionInboxPriority, number> = {
  IMMEDIATE: 0,
  TODAY: 1,
  UPCOMING: 2,
};

function comparableTime(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

type SortableGuideActionInboxItem = {
  id: string;
  priority: GuideActionInboxPriority;
  dueAt: string;
  createdAt: string;
};

/**
 * 先按處理優先級，再按出發時間、建立時間與 id，保持列表穩定可測試。
 * 用結構型別泛型而不是固定 `GuideActionInboxItem[]`，讓 #43 類別 3／4 的
 * `GuideActionInboxFormationItem[]`（已併進上方 `GuideActionInboxItem` 聯集，見該處
 * 說明）能共用同一套排序，不必為了排序而複製一份邏輯或把兩種陣列型別攪在一起。
 */
export function sortGuideActionInboxItems<T extends SortableGuideActionInboxItem>(items: T[]): T[] {
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

export type GuideActionInboxFormationInput = {
  id: string;
  tripId: string;
  tripName: string;
  planName: string;
  departureDate: string;
  startTime: string;
  capacity: number;
  seatsBooked: number;
  minToDepart: number;
  formationStatus: GuideActionInboxFormationKind;
  formationDeadlineAt: string | null;
  formedParticipants: number | null;
  createdAt: string;
};

/**
 * 把一筆 REVIEW_REQUIRED／AT_RISK 團次轉成收件匣卡片，mock 與真實 API 共用同一套規則：
 * - REVIEW_REQUIRED：截止時間就是 `formation_deadline_at`；舊資料沒有這個欄位時，
 *   誠實地退回出發時刻本身（那是最後還能做決定的時間點），不得虛構一個截止時間。
 * - AT_RISK：這團已經成團過，`formation_deadline_at` 不再是下一個真正的期限——
 *   出發時刻才是。
 */
export function buildGuideActionInboxFormationItem(
  input: GuideActionInboxFormationInput,
  now: Date = new Date(),
  timeZone: string = DEFAULT_GUIDE_TIME_ZONE,
): GuideActionInboxFormationItem {
  const startTime = input.startTime || '00:00';
  const departureDueAt = getGuideDepartureDueAt(input.departureDate, startTime, timeZone);
  const dueAt = input.formationStatus === 'REVIEW_REQUIRED' && input.formationDeadlineAt
    ? input.formationDeadlineAt
    : departureDueAt;
  return {
    id: input.id,
    kind: input.formationStatus,
    tripId: input.tripId,
    tripName: input.tripName,
    planName: input.planName,
    departureDate: input.departureDate,
    startTime,
    capacity: input.capacity,
    seatsBooked: input.seatsBooked,
    minToDepart: input.minToDepart,
    formationDeadlineAt: input.formationDeadlineAt,
    formedParticipants: input.formedParticipants,
    priority: getGuideActionInboxPriority(dueAt, now, timeZone),
    dueAt,
    createdAt: input.createdAt,
    href: `/tenant/trips/${input.tripId}`,
  };
}
