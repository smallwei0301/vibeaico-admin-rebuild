/**
 * #43 GUIDE 行動收件匣的純整理邊界。
 *
 * 這裡不保存待辦，也不改寫訂單狀態；呼叫端只把 #37/#40/#41 的真實資料
 * 正規化後交進來。本函式只負責首頁分區與排序，方便在不碰共用 TEST DB 的情況下驗證。
 */

export type GuideActionReason =
  | 'REQUEST_PENDING'
  | 'PAYMENT_DUE'
  | 'FORMATION_COLLECTING'
  | 'REVIEW_REQUIRED'
  | 'AT_RISK'
  | 'REFUND_PENDING'
  | 'DEPARTURE_UPCOMING'
  | 'GUIDE_UNASSIGNED'
  | 'SCHEDULE_CONFLICT'
  | 'DELIVERY_DEAD';

export type GuideActionUrgency = 'IMMEDIATE' | 'TODAY' | 'UPCOMING';

export type GuideActionSource = {
  id: string;
  reason: GuideActionReason;
  subject: string;
  detail: string;
  dueAt: string | null;
  href: string;
};

export type GuideActionItem = GuideActionSource & {
  urgency: GuideActionUrgency;
  overdue: boolean;
};

export type GuideActionInbox = {
  immediate: GuideActionItem[];
  today: GuideActionItem[];
  upcoming: GuideActionItem[];
};

type InboxWindow = {
  now: Date;
  todayEndsAt: Date;
  upcomingEndsAt: Date;
};

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

/** 依租戶時區計算首頁今天與未來七天；支援跨日與日光節約時間。 */
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
    toDate: dateKey(new Date(localToday.getTime() + 7 * 86_400_000)),
  };
}

const ALWAYS_IMMEDIATE = new Set<GuideActionReason>([
  'REQUEST_PENDING',
  'REVIEW_REQUIRED',
  'AT_RISK',
  'REFUND_PENDING',
  'GUIDE_UNASSIGNED',
  'SCHEDULE_CONFLICT',
  'DELIVERY_DEAD',
]);

const dueTime = (item: GuideActionSource) => item.dueAt
  ? new Date(item.dueAt).getTime()
  : Number.POSITIVE_INFINITY;

const byDue = (a: GuideActionItem, b: GuideActionItem) => {
  const left = dueTime(a);
  const right = dueTime(b);
  if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
  return left - right;
};

export function buildGuideActionInbox(
  sources: readonly GuideActionSource[],
  window: InboxWindow,
): GuideActionInbox {
  const inbox: GuideActionInbox = { immediate: [], today: [], upcoming: [] };
  const now = window.now.getTime();
  const todayEndsAt = window.todayEndsAt.getTime();
  const upcomingEndsAt = window.upcomingEndsAt.getTime();

  for (const source of sources) {
    const due = dueTime(source);
    const overdue = due < now;
    let urgency: GuideActionUrgency;

    if (overdue || ALWAYS_IMMEDIATE.has(source.reason)) urgency = 'IMMEDIATE';
    else if (due <= todayEndsAt) urgency = 'TODAY';
    else if (due <= upcomingEndsAt) urgency = 'UPCOMING';
    else continue;

    inbox[urgency.toLowerCase() as Lowercase<GuideActionUrgency>].push({
      ...source,
      urgency,
      overdue,
    });
  }

  inbox.immediate.sort(byDue);
  inbox.today.sort(byDue);
  inbox.upcoming.sort(byDue);
  return inbox;
}

type GuideInboxRows = {
  orders: any[];
  departures: any[];
  assignments: any[];
  deadDeliveries: any[];
};

const relation = (value: unknown): any => Array.isArray(value) ? value[0] : value;

/**
 * 從依賴 Issue 的表讀取事實。欄位由 #37（指派）、#40（派送帳本）、#41
 *（成團／付款）提供；本函式沒有 fallback，也不吞 schema 錯誤。
 */
export async function loadGuideActionSources(params: {
  supabase: any;
  tenantId: string;
  fromDate: string;
  toDate: string;
}): Promise<GuideActionSource[]> {
  const { supabase, tenantId, fromDate, toDate } = params;
  const [ordersResult, departuresResult, assignmentsResult, deliveriesResult] = await Promise.all([
    supabase.from('tour_orders')
      .select('id,order_no,customer_name,status,payment_status,hold_expires_at,total_amount,paid_amount,departure_id,plan_id,trip_plans(name,booking_type,trips(title))')
      .eq('tenant_id', tenantId),
    supabase.from('trip_departures')
      .select('id,trip_id,plan_id,departs_on,start_time,status,formation_status,formation_deadline_at,trips(title),trip_plans(name,booking_type)')
      .eq('tenant_id', tenantId).eq('status', 'OPEN')
      .gte('departs_on', fromDate).lte('departs_on', toDate),
    supabase.from('trip_departure_staff').select('departure_id').eq('tenant_id', tenantId),
    supabase.from('notification_deliveries')
      .select('id,last_error_code,notification_outbox!inner(aggregate_type,aggregate_id,event_name)')
      .eq('tenant_id', tenantId).eq('status', 'DEAD'),
  ]);

  for (const result of [ordersResult, departuresResult, assignmentsResult, deliveriesResult]) {
    if (result.error) throw result.error;
  }

  return sourcesFromRows({
    orders: ordersResult.data ?? [],
    departures: departuresResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    deadDeliveries: deliveriesResult.data ?? [],
  });
}

export function sourcesFromRows(rows: GuideInboxRows): GuideActionSource[] {
  const departures = new Map(rows.departures.map((row) => [row.id as string, row]));
  const assigned = new Set(rows.assignments.map((row) => row.departure_id as string));
  const sources: GuideActionSource[] = [];

  for (const order of rows.orders) {
    const departure = departures.get(order.departure_id);
    const orderPlan = relation(order.trip_plans);
    const plan = orderPlan ?? relation(departure?.trip_plans);
    const trip = relation(orderPlan?.trips) ?? relation(departure?.trips);
    const subject = trip?.title ?? plan?.name ?? order.order_no;
    const detail = `${order.customer_name}・${order.order_no}`;
    const href = `/tenant/tour-orders?keyword=${encodeURIComponent(order.order_no)}`;

    if (order.status === 'PENDING' && plan?.booking_type === 'REQUEST') {
      sources.push({ id: `request:${order.id}`, reason: 'REQUEST_PENDING', subject, detail, dueAt: null, href });
    } else if (order.status === 'CONFIRMED' && order.payment_status === 'PARTIAL'
      && departure?.formation_status === 'COLLECTING') {
      sources.push({
        id: `formation-wait:${order.id}`, reason: 'FORMATION_COLLECTING', subject, detail,
        dueAt: departure.formation_deadline_at ?? null, href,
      });
    } else if ((order.status === 'PENDING' || order.status === 'CONFIRMED')
      && (order.payment_status === 'UNPAID' || order.payment_status === 'PARTIAL')) {
      sources.push({
        id: `payment:${order.id}`, reason: 'PAYMENT_DUE', subject, detail,
        dueAt: order.hold_expires_at ?? departure?.formation_deadline_at ?? null, href,
      });
    }
    if (order.payment_status === 'REFUND_PENDING') {
      sources.push({ id: `refund:${order.id}`, reason: 'REFUND_PENDING', subject, detail, dueAt: null, href });
    }
  }

  for (const departure of rows.departures) {
    const trip = relation(departure.trips);
    const plan = relation(departure.trip_plans);
    const subject = trip?.title ?? plan?.name ?? departure.id;
    const detail = `${departure.departs_on} ${String(departure.start_time ?? '').slice(0, 5)}`.trim();
    const href = `/tenant/trips/${departure.trip_id}?departure=${departure.id}`;
    const departureAt = `${departure.departs_on}T${departure.start_time ?? '00:00:00'}+08:00`;

    if (departure.formation_status === 'REVIEW_REQUIRED' || departure.formation_status === 'AT_RISK') {
      sources.push({
        id: `formation:${departure.id}`, reason: departure.formation_status,
        subject, detail, dueAt: departure.formation_deadline_at ?? null, href,
      });
    }
    if (!assigned.has(departure.id)) {
      sources.push({ id: `unassigned:${departure.id}`, reason: 'GUIDE_UNASSIGNED', subject, detail, dueAt: departureAt, href });
    }
    sources.push({ id: `departure:${departure.id}`, reason: 'DEPARTURE_UPCOMING', subject, detail, dueAt: departureAt, href });
  }

  for (const delivery of rows.deadDeliveries) {
    const event = relation(delivery.notification_outbox);
    if (!event || !String(event.aggregate_type).startsWith('TOUR_')) continue;
    sources.push({
      id: `delivery:${delivery.id}`, reason: 'DELIVERY_DEAD',
      subject: event.event_name, detail: delivery.last_error_code ?? '', dueAt: null,
      href: event.aggregate_type === 'TOUR_ORDER'
        ? `/tenant/tour-orders?focus=${encodeURIComponent(event.aggregate_id)}`
        : `/tenant/dashboard?departure=${encodeURIComponent(event.aggregate_id)}`,
    });
  }

  return sources;
}
