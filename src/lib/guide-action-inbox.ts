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

/*
 * #43 類別 5：REFUND_PENDING（退款尚未完成）。來源是 `tour_orders`
 * （`supabase/migrations/0108_issue_41_payment_state_model.sql`，#41 canonical），
 * 不是 `trip_departures`——跟上面的 formation 兩類是不同資料表、不同 enum
 * （`tour_payment_status` vs `bookings.payment_status`），因此與下面
 * BOOKING_PAYMENT（讀 `bookings_view`）天生不相交，見 route.ts 對應查詢旁的說明。
 *
 * 18 分冊 §9.3 平台固定底線：「REFUND_PENDING 不可顯示成 REFUNDED」。這個型別與其
 * i18n copy（`src/i18n/zh-TW/pages/dashboard.ts` 的 `refundPending` / `openRefund` /
 * `refundOutstanding`）刻意不沿用「已退款」字樣，一律使用「待退款／退款處理中」。
 */
export type GuideActionInboxRefundPendingItem = {
  id: string;
  kind: 'REFUND_PENDING';
  orderNo: string;
  customerName: string;
  /** 已收但尚未退回旅客的金額（paid_amount - refunded_amount），不得為負。 */
  refundOutstandingAmount: number;
  priority: GuideActionInboxPriority;
  dueAt: string;
  createdAt: string;
  href: string;
};

/*
 * #43 類別 7：人員指派或時間衝突等不可履約風險。
 *
 * 撞班判斷**不在這裡重新實作**——`src/server/staff-availability.ts` 的
 * `loadStaffLoad()` / `findStaffConflicts()`（issue #37 §5.3 canonical）已經是
 * 團次建立／編輯／batch 三處共用的唯一撞班引擎；`trip_departure_staff`（0092）是
 * 團次人員指派的唯一真相。這裡只定義「把引擎回傳的 `StaffConflict[]` 轉成一張
 * 收件匣卡片」需要的形狀，實際查詢與判斷都在 route.ts 呼叫既有引擎完成。
 *
 * 只涵蓋「已指派人員、但該指派實際撞期」——不含「尚未指派人員」。後者
 * （`10-TOUR-DOMAIN.md` §1.3 相容策略允許的既有「未指派」團次）是否也該進收件匣、
 * 用什麼優先級判斷，屬於需要 Owner 另外裁示的獨立範圍，本切片不擅自涵蓋，見
 * route.ts 檔案頂端與本輪 PR 說明。
 */
export type GuideActionInboxStaffConflictReason = 'SHIFT' | 'BOOKING' | 'BLOCK' | 'DEPARTURE';

export type GuideActionInboxStaffConflictDetail = {
  staffId: string;
  staffName: string;
  reason: GuideActionInboxStaffConflictReason;
};

export type GuideActionInboxStaffConflictItem = {
  id: string;
  kind: 'STAFF_CONFLICT';
  tripId: string;
  tripName: string;
  planName: string;
  departureDate: string;
  startTime: string;
  /** 這團所有「已指派但撞期」的人員，可能不只一位。 */
  conflicts: GuideActionInboxStaffConflictDetail[];
  priority: GuideActionInboxPriority;
  dueAt: string;
  createdAt: string;
  href: string;
};

export type GuideActionInboxItem =
  | GuideActionInboxBaseItem
  | GuideActionInboxFormationItem
  | GuideActionInboxRefundPendingItem
  | GuideActionInboxStaffConflictItem;

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

/**
 * #43 defect review: `dueAt`／`formationDeadlineAt` 在真實 API 上不是同一種字面
 * 格式——來自 PostgREST 直讀的 timestamptz（`formation_deadline_at`、
 * `bookings_view.start_at`）是 `...541+00:00`，經過 `getGuideDepartureDueAt()`
 * 算出來的（AT_RISK、DEPARTURE 卡片）則是 `Date.toISOString()` 的 `...541Z`。
 * 兩者是同一個 instant 的不同序列化，不是資料錯誤。
 *
 * 決定：**不在 route.ts 邊界正規化成單一格式**，原因：
 *   1. `Date.parse()` 對兩種格式都正確——這裡的 `comparableTime()` 已經是唯一
 *      依賴它做排序的地方，不受影響。
 *   2. 目前沒有任何呼叫端（dashboard 卡片渲染、`sortGuideActionInboxItems`、
 *      本檔／service 的測試）依賴這兩個欄位的字串字面值相等，只有整合測試曾經
 *      誤用 `toMatchObject` 字串比較——那是測試的錯，已改用 `Date.parse(...)`
 *      比較 instant（見 `tests/integration/api/guide-action-inbox.43.test.ts`，
 *      沿用 `tests/integration/api/bookings-modified.27.test.ts:375` 的既有慣例）。
 *   3. 要正規化就得替整個 API 回應挑一個正典格式並在 `route.ts` 逐欄位轉換，
 *      這會動到 `bookings_view`／`trip_departures` 直接透出的其他 timestamp 欄位
 *      （不只 formation 這兩個新欄位），範圍超出 #43 這一輪、也超出本
 *      FILE_OWNERSHIP（`src/lib/types.ts` 屬另一條 lane）。沒有觀察到的好處，
 *      不做用不到的正規化。
 */
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

export type GuideActionInboxRefundPendingInput = {
  id: string;
  orderNo: string;
  customerName: string;
  refundOutstandingAmount: number;
  dueAt: string;
  createdAt: string;
  href: string;
};

/**
 * #43 類別 5：把一筆 `payment_status = 'REFUND_PENDING'` 的 tour_orders 列轉成
 * 收件匣卡片。
 *
 * priority 固定為 `'IMMEDIATE'`，不像 booking/departure 那樣比較 `dueAt` 才決定：
 * 19 分冊 §3.1 把「退款」明列在「立即處理」的觸發條件之一——欠旅客錢這件事本身
 * 就已經是要立刻處理的事，不需要再用一個時間門檻去判斷「是不是還沒到期」。
 *
 * `dueAt` 誠實地使用呼叫端傳入的「這筆訂單最後一次異動時間」（真實 API 是
 * `tour_orders.updated_at`；mock 是同一筆 fixture 的 `createdAt`）。schema 目前
 * 沒有「何時申請退款」這種專屬欄位（18 分冊 §4／0108 都沒有補這一欄——那屬於
 * §5-§6 之後的退款流程切片），捏造一個不存在的申請時間會比誠實地借用「最後異動
 * 時間」更糟；且因為 priority 固定 IMMEDIATE，`dueAt` 只影響同為 IMMEDIATE 卡片間
 * 的排序，不影響「要不要顯示成立即處理」這件事本身。
 */
export function buildGuideActionInboxRefundPendingItem(
  input: GuideActionInboxRefundPendingInput,
): GuideActionInboxRefundPendingItem {
  return {
    id: input.id,
    kind: 'REFUND_PENDING',
    orderNo: input.orderNo,
    customerName: input.customerName,
    refundOutstandingAmount: input.refundOutstandingAmount,
    priority: 'IMMEDIATE',
    dueAt: input.dueAt,
    createdAt: input.createdAt,
    href: input.href,
  };
}

export type GuideActionInboxStaffConflictInput = {
  id: string;
  tripId: string;
  tripName: string;
  planName: string;
  departureDate: string;
  startTime: string;
  conflicts: GuideActionInboxStaffConflictDetail[];
  createdAt: string;
};

/**
 * #43 類別 7：把一團「已指派人員實際撞期」的判斷結果轉成收件匣卡片。
 *
 * priority 固定 `'IMMEDIATE'`，理由同 REFUND_PENDING：Issue #43 §2 把「排班衝突」
 * 明列在「立即處理」的觸發條件之一，撞班本身已經是阻礙履約的風險，不需要再比
 * `dueAt` 才決定要不要立即處理。`dueAt` 沿用出發時刻，只影響同為 IMMEDIATE
 * 卡片間的排序（與其他出發／成團卡片一致地用同一種「真正 instant」排序）。
 *
 * `conflicts` 不做去重或裁切——一團可能不只一位人員撞期，每一位都要讓店家看到，
 * 不能只顯示第一個就讓其他撞期悄悄消失。
 */
export function buildGuideActionInboxStaffConflictItem(
  input: GuideActionInboxStaffConflictInput,
  timeZone: string = DEFAULT_GUIDE_TIME_ZONE,
): GuideActionInboxStaffConflictItem {
  const startTime = input.startTime || '00:00';
  return {
    id: input.id,
    kind: 'STAFF_CONFLICT',
    tripId: input.tripId,
    tripName: input.tripName,
    planName: input.planName,
    departureDate: input.departureDate,
    startTime,
    conflicts: input.conflicts,
    priority: 'IMMEDIATE',
    dueAt: getGuideDepartureDueAt(input.departureDate, startTime, timeZone),
    createdAt: input.createdAt,
    href: `/tenant/trips/${input.tripId}`,
  };
}
