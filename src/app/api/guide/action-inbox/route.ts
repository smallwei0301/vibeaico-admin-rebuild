import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  buildGuideActionInboxFormationItem,
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  isGuideActionInboxFormationStatus,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';

type RelatedName = { name?: string | null; title?: string | null } | { name?: string | null; title?: string | null }[] | null;

function relatedValue(value: RelatedName): { name?: string | null; title?: string | null } | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * GUIDE 首頁單一聚合 action inbox 端點（#43 §4：不可把不同資料表全抓到前端後自行
 * 拼湊，改由 server 端用相同 tenant 邊界彙整成一份已排序清單）：
 *   - 待確認預約（BOOKING_REQUEST）、待收款預約（BOOKING_PAYMENT）— bookings_view。
 *   - 今日／明日出發團次（DEPARTURE）— trip_departures。
 *   - #43 類別 3／4：REVIEW_REQUIRED（成團截止不足）／AT_RISK（已成團後人數跌破
 *     門檻）— trip_departures.formation_status（`supabase/migrations/0107_issue_41_
 *     formation_state_model.sql`，#41 canonical）與其 snapshot 欄位。
 *
 * 只讀既有 bookings_view、trip_departures 與 tenant timezone，不建立新狀態、不重新
 * 推算成團與否，也不觸發通知、付款或其他外部副作用。預約卡片帶 bookingId deep
 * link，讓操作人直接開啟該筆詳情而不是重新搜尋列表；formation 卡片沿用既有團次
 * 深連結（`/tenant/trips/:id`），因為成團決定發生在團次詳情頁。
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

  const [bookingResult, paymentBookingResult, departureResult, formationResult] = await Promise.all([
    t.supabase
      .from('bookings_view')
      .select('id, booking_no, customer_name, service_name, start_at, created_at')
      .eq('tenant_id', t.tenantId)
      .eq('status', 'PENDING')
      .order('start_at', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(20),
    t.supabase
      .from('bookings_view')
      .select('id, booking_no, customer_name, service_name, start_at, final_price, created_at')
      .eq('tenant_id', t.tenantId)
      .eq('status', 'CONFIRMED')
      .eq('payment_status', 'UNPAID')
      .gt('final_price', 0)
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
    t.supabase
      .from('trip_departures')
      .select('id, trip_id, plan_id, departs_on, start_time, status, capacity, seats_booked, formation_status, formation_deadline_at, min_to_depart_snapshot, formed_participants, created_at, trips(title), trip_plans(name)')
      .eq('tenant_id', t.tenantId)
      .neq('status', 'CANCELLED')
      .in('formation_status', ['REVIEW_REQUIRED', 'AT_RISK'])
      .order('departs_on', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(20),
  ]);

  if (bookingResult.error) throw bookingResult.error;
  if (paymentBookingResult.error) throw paymentBookingResult.error;
  if (departureResult.error) throw departureResult.error;
  if (formationResult.error) throw formationResult.error;

  const bookingItems: GuideActionInboxItem[] = (bookingResult.data ?? []).map((row) => ({
    id: row.id,
    kind: 'BOOKING_REQUEST',
    bookingNo: row.booking_no,
    customerName: row.customer_name ?? '',
    serviceName: row.service_name ?? '',
    priority: getGuideActionInboxPriority(row.start_at, now, timeZone),
    dueAt: row.start_at,
    createdAt: row.created_at,
    href: `/tenant/bookings?status=PENDING&bookingId=${encodeURIComponent(row.id)}`,
  }));

  const bookingPaymentItems: GuideActionInboxItem[] = (paymentBookingResult.data ?? []).map((row) => ({
    id: row.id,
    kind: 'BOOKING_PAYMENT',
    bookingNo: row.booking_no,
    customerName: row.customer_name ?? '',
    serviceName: row.service_name ?? '',
    amount: Number(row.final_price ?? 0),
    priority: getGuideActionInboxPriority(row.start_at, now, timeZone),
    dueAt: row.start_at,
    createdAt: row.created_at,
    href: `/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID&bookingId=${encodeURIComponent(row.id)}`,
  }));

  const departureItems: GuideActionInboxItem[] = (departureResult.data ?? [])
    .map((row: any): GuideActionInboxItem | null => {
      const departureDay = getGuideDepartureDay(row.departs_on, now, timeZone);
      if (!departureDay) return null;
      const startTime = row.start_time ? String(row.start_time).slice(0, 5) : '';
      const departureDate = String(row.departs_on).slice(0, 10);
      const trip = relatedValue(row.trips as RelatedName);
      const plan = relatedValue(row.trip_plans as RelatedName);
      return {
        id: row.id,
        kind: 'DEPARTURE' as const,
        tripId: row.trip_id,
        tripName: trip?.title ?? '',
        planName: plan?.name ?? '',
        departureDate,
        startTime,
        capacity: row.capacity,
        seatsBooked: row.seats_booked,
        departureDay,
        priority: departureDay === 'TODAY' ? 'TODAY' : 'UPCOMING',
        dueAt: getGuideDepartureDueAt(departureDate, startTime || '00:00', timeZone),
        createdAt: row.created_at,
        href: `/tenant/trips/${row.trip_id}`,
      } satisfies GuideActionInboxItem;
    })
    .filter((item): item is GuideActionInboxItem => item !== null);

  const formationItems: GuideActionInboxItem[] = (formationResult.data ?? [])
    .map((row: any): GuideActionInboxItem | null => {
      // 防禦性守衛：query 已用 `.in('formation_status', [...])` 篩過，這裡再擋一次是為了
      // 不讓型別不明的資料庫值悄悄變成一張假卡片；不符合就誠實地不顯示，不猜測分類。
      if (!isGuideActionInboxFormationStatus(row.formation_status)) return null;
      const trip = relatedValue(row.trips as RelatedName);
      const plan = relatedValue(row.trip_plans as RelatedName);
      const departureDate = String(row.departs_on).slice(0, 10);
      const startTime = row.start_time ? String(row.start_time).slice(0, 5) : '';
      return buildGuideActionInboxFormationItem({
        id: row.id,
        tripId: row.trip_id,
        tripName: trip?.title ?? '',
        planName: plan?.name ?? '',
        departureDate,
        startTime,
        capacity: row.capacity,
        seatsBooked: row.seats_booked,
        minToDepart: row.min_to_depart_snapshot ?? 1,
        formationStatus: row.formation_status,
        formationDeadlineAt: row.formation_deadline_at ?? null,
        formedParticipants: row.formed_participants ?? null,
        createdAt: row.created_at,
      }, now, timeZone);
    })
    .filter((item): item is GuideActionInboxItem => item !== null);

  return ok(sortGuideActionInboxItems([
    ...bookingItems,
    ...bookingPaymentItems,
    ...departureItems,
    ...formationItems,
  ]));
});
