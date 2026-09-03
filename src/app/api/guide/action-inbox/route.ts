import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  getGuideActionInboxDateWindow,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';

type RelatedName = { name?: string | null; title?: string | null } | { name?: string | null; title?: string | null }[] | null;

function relatedValue(value: RelatedName): { name?: string | null; title?: string | null } | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * GUIDE 首頁目前可出貨的 action inbox 類別：待確認預約與今日／明日出發團次。
 * 只讀既有 bookings_view 與 tenant timezone，不建立新狀態，也不觸發通知、付款或其他外部副作用。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const settingsResult = await t.supabase
    .from('tenant_settings')
    .select('basic')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (settingsResult.error) throw settingsResult.error;

  const basic = settingsResult.data?.basic;
  const rawTimeZone = basic && typeof basic === 'object' && !Array.isArray(basic)
    ? (basic as Record<string, unknown>).timezone
    : undefined;
  const timeZone = normalizeGuideTimeZone(rawTimeZone);
  const now = new Date();
  const { today, tomorrow } = getGuideActionInboxDateWindow(now, timeZone);

  const [bookingResult, departureResult] = await Promise.all([
    t.supabase
      .from('bookings_view')
      .select('id, booking_no, customer_name, service_name, start_at, created_at')
      .eq('tenant_id', t.tenantId)
      .eq('status', 'PENDING')
      .order('start_at', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(20),
    t.supabase
      .from('trip_departures')
      .select('id, trip_id, plan_id, departs_on, start_time, status, capacity, seats_booked, created_at, trips(title), trip_plans(name)')
      .eq('tenant_id', t.tenantId)
      .in('status', ['OPEN', 'CLOSED'])
      .gte('departs_on', today)
      .lte('departs_on', tomorrow)
      .order('departs_on', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(20),
  ]);

  if (bookingResult.error) throw bookingResult.error;
  if (departureResult.error) throw departureResult.error;

  const bookingItems: GuideActionInboxItem[] = (bookingResult.data ?? []).map((row) => ({
    id: row.id,
    kind: 'BOOKING_REQUEST',
    bookingNo: row.booking_no,
    customerName: row.customer_name ?? '',
    serviceName: row.service_name ?? '',
    priority: getGuideActionInboxPriority(row.start_at, now, timeZone),
    dueAt: row.start_at,
    createdAt: row.created_at,
    href: '/tenant/bookings?status=PENDING',
  }));

  const departureItems: GuideActionInboxItem[] = (departureResult.data ?? [])
    .map((row: any): GuideActionInboxItem | null => {
      const departureDay = getGuideDepartureDay(row.departs_on, now, timeZone);
      if (!departureDay) return null;
      const startTime = row.start_time ? String(row.start_time).slice(0, 5) : '';
      const trip = relatedValue(row.trips as RelatedName);
      const plan = relatedValue(row.trip_plans as RelatedName);
      return {
        id: row.id,
        kind: 'DEPARTURE' as const,
        tripId: row.trip_id,
        tripName: trip?.title ?? '',
        planName: plan?.name ?? '',
        departureDate: String(row.departs_on).slice(0, 10),
        startTime,
        capacity: row.capacity,
        seatsBooked: row.seats_booked,
        departureDay,
        priority: departureDay === 'TODAY' ? 'TODAY' : 'UPCOMING',
        dueAt: `${String(row.departs_on).slice(0, 10)}T${startTime || '00:00'}:00.000Z`,
        createdAt: row.created_at,
        href: `/tenant/trips/${row.trip_id}`,
      } satisfies GuideActionInboxItem;
    })
    .filter((item): item is GuideActionInboxItem => item !== null);

  return ok(sortGuideActionInboxItems([...bookingItems, ...departureItems]));
});
