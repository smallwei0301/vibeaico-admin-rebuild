import type {
  DepartureStatus,
  GuideActionInbox,
  GuideActionItem,
  GuideActionPrimaryAction,
  GuideActionReason,
  GuideActionSource,
  GuideActionUrgency,
  TourOrderStatus,
  TourPaymentStatus,
  TripBookingType,
} from '@/lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type InboxWindow = {
  now: Date;
  todayEndsAt: Date;
  upcomingEndsAt: Date;
  todayDate?: string;
};

type EmbeddedTrip = { title?: string };
type EmbeddedPlan = {
  name?: string;
  booking_type?: TripBookingType;
  trips?: EmbeddedTrip | EmbeddedTrip[] | null;
};
type OrderRow = {
  id: string;
  order_no: string;
  contact?: Record<string, unknown> | null;
  status: TourOrderStatus;
  payment_status: TourPaymentStatus;
  hold_expires_at?: string | null;
  departure_id?: string | null;
  created_at?: string | null;
  trip_plans?: EmbeddedPlan | EmbeddedPlan[] | null;
};
type DepartureRow = {
  id: string;
  trip_id: string;
  departs_on: string;
  start_time?: string | null;
  status: DepartureStatus;
  created_at?: string | null;
  trips?: EmbeddedTrip | EmbeddedTrip[] | null;
  trip_plans?: EmbeddedPlan | EmbeddedPlan[] | null;
};

export type GuideInboxRows = {
  orders: OrderRow[];
  departures: DepartureRow[];
  assignments: Array<{ departure_id: string }>;
};

const DEFAULT_TIME_ZONE = 'Asia/Taipei';
const ALWAYS_IMMEDIATE = new Set<GuideActionReason>([
  'REQUEST_PENDING',
  'GUIDE_UNASSIGNED',
]);
const PRIMARY_ACTION: Record<GuideActionReason, GuideActionPrimaryAction> = {
  REQUEST_PENDING: 'REVIEW_REQUEST',
  PAYMENT_DUE: 'REVIEW_PAYMENT',
  BALANCE_DUE: 'REVIEW_PAYMENT',
  FORMATION_REVIEW_REQUIRED: 'REVIEW_FORMATION',
  FORMATION_AT_RISK: 'REVIEW_FORMATION',
  REFUND_PENDING: 'REVIEW_REFUND',
  DEPARTURE_UPCOMING: 'VIEW_DEPARTURE',
  GUIDE_UNASSIGNED: 'ASSIGN_GUIDE',
  DEPARTURE_CONFLICT: 'RESOLVE_CONFLICT',
  NOTIFICATION_DELIVERY_FAILED: 'RETRY_NOTIFICATION',
};

const relation = <T>(value: T | T[] | null | undefined): T | undefined => (
  Array.isArray(value) ? value[0] : value ?? undefined
);

/** Tenant settings are user-controlled; a bad IANA value must not make the inbox 500. */
export function normalizeGuideTimeZone(timeZone: string | null | undefined) {
  const candidate = timeZone?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

const dateParts = (value: Date, timeZone: string) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]),
) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

const localDateTimeUtc = (
  date: string,
  time: string | null | undefined,
  timeZone: string,
) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = String(time ?? '00:00:00').split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wanted;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateParts(new Date(guess), timeZone);
    const represented = Date.UTC(
      parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
    );
    guess += wanted - represented;
  }
  return new Date(guess).toISOString();
};

const localMidnightUtc = (year: number, month: number, day: number, timeZone: string) => (
  new Date(localDateTimeUtc(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    '00:00:00',
    timeZone,
  )).getTime()
);

/**
 * Derive the tenant's local today + next seven calendar days as UTC boundaries.
 * This deliberately does not use the process timezone or UTC date shortcuts.
 */
export function guideInboxWindow(now: Date, timeZone?: string | null) {
  const normalizedTimeZone = normalizeGuideTimeZone(timeZone);
  const current = dateParts(now, normalizedTimeZone);
  const localToday = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const tomorrow = new Date(localToday.getTime() + 86_400_000);
  const eighthDay = new Date(localToday.getTime() + 8 * 86_400_000);
  const tomorrowUtc = localMidnightUtc(
    tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), normalizedTimeZone,
  );
  const eighthDayUtc = localMidnightUtc(
    eighthDay.getUTCFullYear(), eighthDay.getUTCMonth() + 1, eighthDay.getUTCDate(), normalizedTimeZone,
  );
  const dateKey = (date: Date) => date.toISOString().slice(0, 10);

  return {
    now,
    timeZone: normalizedTimeZone,
    todayEndsAt: new Date(tomorrowUtc - 1),
    upcomingEndsAt: new Date(eighthDayUtc - 1),
    todayDate: dateKey(localToday),
    fromDate: dateKey(localToday),
    // Query uses inclusive lte, so include the seventh local calendar day after today.
    departureToDate: dateKey(new Date(localToday.getTime() + 7 * 86_400_000)),
  };
}

const timestamp = (value: string | null) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

/** Deadline ascending, then creation time ascending, then id for deterministic ties. */
const byDeadlineThenCreated = (left: GuideActionItem, right: GuideActionItem) => (
  timestamp(left.dueAt) - timestamp(right.dueAt)
  || timestamp(left.createdAt) - timestamp(right.createdAt)
  || left.id.localeCompare(right.id)
);

/** Classify only known facts; no deadline is invented for sources that do not supply one. */
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
    else if (due <= window.todayEndsAt.getTime() || source.actionDate === window.todayDate) urgency = 'TODAY';
    else if (!Number.isFinite(due) || due <= window.upcomingEndsAt.getTime()) urgency = 'UPCOMING';
    else continue;

    inbox[urgency.toLowerCase() as 'immediate' | 'today' | 'upcoming'].push({
      ...source,
      urgency,
      overdue,
    });
  }

  inbox.immediate.sort(byDeadlineThenCreated);
  inbox.today.sort(byDeadlineThenCreated);
  inbox.upcoming.sort(byDeadlineThenCreated);
  return inbox;
}

/** Map existing order/departure/assignment facts to a read-only action contract. */
export function sourcesFromRows(
  rows: GuideInboxRows,
  timeZone = DEFAULT_TIME_ZONE,
  now = new Date(),
): GuideActionSource[] {
  const normalizedTimeZone = normalizeGuideTimeZone(timeZone);
  const departures = new Map(rows.departures.map((row) => [row.id, row]));
  const assigned = new Set(rows.assignments.map((row) => row.departure_id));
  const sources: GuideActionSource[] = [];

  for (const order of rows.orders) {
    const departure = departures.get(order.departure_id ?? '');
    const orderPlan = relation(order.trip_plans);
    const plan = orderPlan ?? relation(departure?.trip_plans);
    const trip = relation(orderPlan?.trips) ?? relation(departure?.trips);
    const subject = trip?.title ?? plan?.name ?? order.order_no;
    const contactName = typeof order.contact?.name === 'string' ? order.contact.name : undefined;
    const detail = [contactName, order.order_no].filter(Boolean).join('・');
    const href = `/tenant/tour-orders?keyword=${encodeURIComponent(order.order_no)}`;
    const createdAt = order.created_at ?? null;

    if (order.status === 'PENDING' && plan?.booking_type === 'REQUEST') {
      sources.push({
        id: `request:${order.id}`,
        reason: 'REQUEST_PENDING',
        primaryAction: PRIMARY_ACTION.REQUEST_PENDING,
        subject,
        detail,
        dueAt: null,
        actionDate: null,
        createdAt,
        href,
      });
    } else if (
      (order.status === 'PENDING' || order.status === 'CONFIRMED')
      && order.payment_status === 'UNPAID'
    ) {
      sources.push({
        id: `payment:${order.id}`,
        reason: 'PAYMENT_DUE',
        primaryAction: PRIMARY_ACTION.PAYMENT_DUE,
        subject,
        detail,
        dueAt: order.hold_expires_at ?? null,
        actionDate: null,
        createdAt,
        href,
      });
    }
  }

  for (const departure of rows.departures) {
    if (departure.status === 'CANCELLED') continue;
    const trip = relation(departure.trips);
    const plan = relation(departure.trip_plans);
    const subject = trip?.title ?? plan?.name ?? departure.id;
    const detail = `${departure.departs_on} ${String(departure.start_time ?? '').slice(0, 5)}`.trim();
    const href = `/tenant/trips/${departure.trip_id}?tab=departures`;
    const dueAt = departure.start_time
      ? localDateTimeUtc(departure.departs_on, departure.start_time, normalizedTimeZone)
      : null;
    const createdAt = departure.created_at ?? null;

    // A departure with a known past start time cannot truthfully be presented as upcoming.
    if (dueAt && new Date(dueAt).getTime() < now.getTime()) continue;

    if (!assigned.has(departure.id)) {
      sources.push({
        id: `unassigned:${departure.id}`,
        reason: 'GUIDE_UNASSIGNED',
        primaryAction: PRIMARY_ACTION.GUIDE_UNASSIGNED,
        subject,
        detail,
        dueAt,
        actionDate: departure.start_time ? null : departure.departs_on,
        createdAt,
        href,
      });
      continue;
    }

    sources.push({
      id: `departure:${departure.id}`,
      reason: 'DEPARTURE_UPCOMING',
      primaryAction: PRIMARY_ACTION.DEPARTURE_UPCOMING,
      subject,
      detail,
      dueAt,
      actionDate: departure.start_time ? null : departure.departs_on,
      createdAt,
      href,
    });
  }
  return sources;
}

type QueryError = { code?: string; message?: string } | null;

/**
 * Main does not yet include the tour migrations. Treat only a missing source relation as a
 * truthful empty inbox; permission, network, and query-shape failures still surface normally.
 */
const isMissingTourSource = (error: QueryError) => (
  error?.code === '42P01'
  || error?.code === 'PGRST205'
  || /(?:relation|table).*(?:does not exist|not found)/i.test(error?.message ?? '')
);

/**
 * Aggregates state using the tenant-scoped RLS client. This never writes, and never queries a
 * row without tenant_id, so it remains a view over the existing sources rather than a task DB.
 */
export async function loadGuideActionSources(params: {
  supabase: SupabaseClient;
  tenantId: string;
  fromDate: string;
  departureToDate: string;
  timeZone?: string;
  now?: Date;
}): Promise<GuideActionSource[]> {
  const { supabase, tenantId, fromDate, departureToDate, timeZone, now } = params;
  const [ordersResult, departuresResult, assignmentsResult] = await Promise.all([
    supabase.from('tour_orders')
      // `booking_type` is the current real-state field for the canonical sales-mode concept.
      .select('id,order_no,contact,status,payment_status,hold_expires_at,departure_id,created_at,trip_plans(name,booking_type,trips(title))')
      .eq('tenant_id', tenantId)
      .in('status', ['PENDING', 'CONFIRMED']),
    supabase.from('trip_departures')
      .select('id,trip_id,departs_on,start_time,status,created_at,trips(title),trip_plans(name,booking_type)')
      .eq('tenant_id', tenantId)
      .in('status', ['OPEN', 'CLOSED'])
      .gte('departs_on', fromDate)
      .lte('departs_on', departureToDate),
    supabase.from('trip_departure_staff')
      .select('departure_id')
      .eq('tenant_id', tenantId),
  ]);

  const errors = [ordersResult.error, departuresResult.error, assignmentsResult.error];
  if (errors.some(Boolean)) {
    if (errors.every(isMissingTourSource)) return [];
    throw errors.find((error) => error !== null);
  }

  return sourcesFromRows({
    orders: (ordersResult.data ?? []) as OrderRow[],
    departures: (departuresResult.data ?? []) as DepartureRow[],
    assignments: (assignmentsResult.data ?? []) as Array<{ departure_id: string }>,
  }, timeZone, now);
}
