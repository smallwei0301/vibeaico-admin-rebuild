import type {
  GuideActionInbox, GuideActionItem, GuideActionReason, GuideActionSource, GuideActionUrgency,
} from '@/lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type InboxWindow = {
  now: Date;
  todayEndsAt: Date;
  upcomingEndsAt: Date;
};

type EmbeddedTrip = { title?: string };
type EmbeddedPlan = { name?: string; booking_type?: string; trips?: EmbeddedTrip | EmbeddedTrip[] | null };
type OrderRow = {
  id: string; order_no: string; customer_name?: string; status: string; payment_status: string;
  hold_expires_at?: string | null; departure_id?: string | null; created_at?: string | null;
  trip_plans?: EmbeddedPlan | EmbeddedPlan[] | null;
};
type DepartureRow = {
  id: string; trip_id: string; departs_on: string; start_time?: string | null; created_at?: string | null;
  trips?: EmbeddedTrip | EmbeddedTrip[] | null; trip_plans?: EmbeddedPlan | EmbeddedPlan[] | null;
};
type GuideInboxRows = { orders: OrderRow[]; departures: DepartureRow[]; assignments: Array<{ departure_id: string }> };

const ALWAYS_IMMEDIATE = new Set<GuideActionReason>([
  'REQUEST_PENDING', 'GUIDE_UNASSIGNED',
]);

const relation = <T>(value: T | T[] | null | undefined): T | undefined => Array.isArray(value) ? value[0] : value ?? undefined;

const dateParts = (value: Date, timeZone: string) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]),
) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

const localMidnightUtc = (year: number, month: number, day: number, timeZone: string) => {
  const wanted = Date.UTC(year, month - 1, day);
  let guess = wanted;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateParts(new Date(guess), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess = wanted - (represented - guess);
  }
  return guess;
};

const localDateTimeUtc = (date: string, time: string | null | undefined, timeZone: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = String(time ?? '00:00:00').split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wanted;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateParts(new Date(guess), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += wanted - represented;
  }
  return new Date(guess).toISOString();
};

/** 將 tenant 今天和接下來七天轉成 UTC 邊界，避免直接以伺服器日期分區。 */
export function guideInboxWindow(now: Date, timeZone: string) {
  const current = dateParts(now, timeZone);
  const localToday = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const tomorrow = new Date(localToday.getTime() + 86_400_000);
  const eighthDay = new Date(localToday.getTime() + 8 * 86_400_000);
  const tomorrowUtc = localMidnightUtc(
    tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), timeZone,
  );
  const eighthDayUtc = localMidnightUtc(
    eighthDay.getUTCFullYear(), eighthDay.getUTCMonth() + 1, eighthDay.getUTCDate(), timeZone,
  );
  const dateKey = (date: Date) => date.toISOString().slice(0, 10);
  return {
    now,
    todayEndsAt: new Date(tomorrowUtc - 1),
    upcomingEndsAt: new Date(eighthDayUtc - 1),
    fromDate: dateKey(localToday),
    // `lte` is inclusive: include the seventh local calendar day after today,
    // which is the same end boundary used by the UPCOMING classifier.
    departureToDate: dateKey(new Date(localToday.getTime() + 7 * 86_400_000)),
  };
}

const timestamp = (value: string | null) => value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;

const byDeadlineThenCreated = (left: GuideActionItem, right: GuideActionItem) => (
  timestamp(left.dueAt) - timestamp(right.dueAt)
  || timestamp(left.createdAt) - timestamp(right.createdAt)
  || left.id.localeCompare(right.id)
);

/** 將來源事實依緊急度分區；沒有期限的待付款仍列為接下來，絕不補造日期。 */
export function buildGuideActionInbox(
  sources: readonly GuideActionSource[],
  window: InboxWindow,
): GuideActionInbox {
  const inbox: GuideActionInbox = { immediate: [], today: [], upcoming: [] };
  const now = window.now.getTime();

  for (const source of sources) {
    const due = timestamp(source.dueAt);
    const overdue = Number.isFinite(due) && due < now;
    let urgency: GuideActionUrgency;
    if (overdue || ALWAYS_IMMEDIATE.has(source.reason)) urgency = 'IMMEDIATE';
    else if (due <= window.todayEndsAt.getTime()) urgency = 'TODAY';
    else if (!Number.isFinite(due) || due <= window.upcomingEndsAt.getTime()) urgency = 'UPCOMING';
    else continue;

    inbox[urgency.toLowerCase() as 'immediate' | 'today' | 'upcoming'].push({ ...source, urgency, overdue });
  }

  inbox.immediate.sort(byDeadlineThenCreated);
  inbox.today.sort(byDeadlineThenCreated);
  inbox.upcoming.sort(byDeadlineThenCreated);
  return inbox;
}

/** 將 PR49 已有的訂單／團次／指派事實轉成行動契約，不建立另一張待辦表。 */
export function sourcesFromRows(rows: GuideInboxRows, timeZone = 'Asia/Taipei'): GuideActionSource[] {
  const departures = new Map(rows.departures.map((row) => [row.id as string, row]));
  const assigned = new Set(rows.assignments.map((row) => row.departure_id as string));
  const sources: GuideActionSource[] = [];

  for (const order of rows.orders) {
    const departure = departures.get(order.departure_id ?? '');
    const orderPlan = relation(order.trip_plans);
    const plan = orderPlan ?? relation(departure?.trip_plans);
    const trip = relation(orderPlan?.trips) ?? relation(departure?.trips);
    const subject = trip?.title ?? plan?.name ?? order.order_no;
    const detail = [order.customer_name, order.order_no].filter(Boolean).join('・');
    const href = `/tenant/tour-orders?keyword=${encodeURIComponent(order.order_no)}`;
    const createdAt = order.created_at ?? null;

    if (order.status === 'PENDING' && plan?.booking_type === 'REQUEST') {
      sources.push({ id: `request:${order.id}`, reason: 'REQUEST_PENDING', subject, detail, dueAt: null, createdAt, href });
    } else if ((order.status === 'PENDING' || order.status === 'CONFIRMED') && order.payment_status === 'UNPAID') {
      sources.push({ id: `payment:${order.id}`, reason: 'PAYMENT_DUE', subject, detail, dueAt: order.hold_expires_at ?? null, createdAt, href });
    }
  }

  for (const departure of rows.departures) {
    const trip = relation(departure.trips);
    const plan = relation(departure.trip_plans);
    const subject = trip?.title ?? plan?.name ?? departure.id;
    const detail = `${departure.departs_on} ${String(departure.start_time ?? '').slice(0, 5)}`.trim();
    const href = `/tenant/trips/${departure.trip_id}?tab=departures`;
    const dueAt = localDateTimeUtc(departure.departs_on, departure.start_time, timeZone);
    const createdAt = departure.created_at ?? null;

    if (!assigned.has(departure.id)) {
      sources.push({ id: `unassigned:${departure.id}`, reason: 'GUIDE_UNASSIGNED', subject, detail, dueAt, createdAt, href });
    }
    sources.push({ id: `departure:${departure.id}`, reason: 'DEPARTURE_UPCOMING', subject, detail, dueAt, createdAt, href });
  }
  return sources;
}

/** Current PR49 schema supplies the initial orders, departures and staff-assignment sources. */
export async function loadGuideActionSources(params: {
  supabase: SupabaseClient;
  tenantId: string;
  fromDate: string;
  departureToDate: string;
  timeZone?: string;
}): Promise<GuideActionSource[]> {
  const { supabase, tenantId, fromDate, departureToDate, timeZone } = params;
  const [ordersResult, departuresResult, assignmentsResult] = await Promise.all([
    supabase.from('tour_orders')
      .select('id,order_no,customer_name,status,payment_status,hold_expires_at,departure_id,created_at,trip_plans(name,booking_type,trips(title))')
      .eq('tenant_id', tenantId).in('status', ['PENDING', 'CONFIRMED']),
    supabase.from('trip_departures')
      .select('id,trip_id,departs_on,start_time,status,created_at,trips(title),trip_plans(name,booking_type)')
      .eq('tenant_id', tenantId).neq('status', 'CANCELLED')
      .gte('departs_on', fromDate).lte('departs_on', departureToDate),
    supabase.from('trip_departure_staff').select('departure_id').eq('tenant_id', tenantId),
  ]);
  for (const result of [ordersResult, departuresResult, assignmentsResult]) if (result.error) throw result.error;
  return sourcesFromRows({
    orders: ordersResult.data ?? [], departures: departuresResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
  }, timeZone);
}
