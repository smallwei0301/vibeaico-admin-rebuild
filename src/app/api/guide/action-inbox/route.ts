import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  buildGuideActionInboxFormationItem,
  buildGuideActionInboxRefundPendingItem,
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
 *   - #43 類別 5：REFUND_PENDING（退款尚未完成）— tour_orders.payment_status
 *     （`supabase/migrations/0108_issue_41_payment_state_model.sql`，#41
 *     canonical）。這是 `tour_orders` 表，不是上面兩類 BOOKING_* 讀的
 *     `bookings_view`；兩者天生不相交——`bookings_view` 是 `public.bookings` 的
 *     view，它的 `payment_status` 欄位型別是 0002 建立的 `payment_status` enum
 *     （UNPAID/PAID_ONLINE/PAID_OFFLINE/REFUNDED），這個值域裡根本沒有
 *     `REFUND_PENDING` 這個標籤；`tour_orders.payment_status` 用的是完全不同的
 *     `tour_payment_status` enum（0087 + 0108）。BOOKING_PAYMENT 的查詢條件是
 *     `.eq('payment_status', 'UNPAID')`，REFUND_PENDING 的查詢條件是
 *     `.eq('payment_status', 'REFUND_PENDING')`，兩個過濾器落在不同的表、不同的
 *     enum 值域上，不需要也不能用事後去重排除重疊——沒有重疊可排除。
 *
 * 只讀既有 bookings_view、trip_departures、tour_orders 與 tenant timezone，不建立
 * 新狀態、不重新推算成團與否，也不觸發通知、付款或其他外部副作用。預約卡片帶
 * bookingId deep link，讓操作人直接開啟該筆詳情而不是重新搜尋列表；formation 卡片
 * 沿用既有團次深連結（`/tenant/trips/:id`），因為成團決定發生在團次詳情頁；
 * REFUND_PENDING 卡片帶 orderId deep link 到 `/tenant/tour-orders`——該頁已消費
 * `paymentStatus`／`orderId` query string（`src/app/tenant/tour-orders/page.tsx`：
 * `paymentStatus` 只接受 `TourPaymentStatus` 值域內的值，值域外忽略；`orderId` 比照
 * `/tenant/bookings` 的 `bookingId` 作法，目標列不在目前頁面時用既有 tenant-scoped
 * `/api/tour-orders?orderId=` 精準撈一筆再開啟該筆詳情 modal），所以這個 deep link
 * 現在真的會套用篩選並自動開啟詳情，不只是帶著查詢字串。
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

  const [
    bookingResult, paymentBookingResult, departureResult, formationResult, refundPendingResult,
  ] = await Promise.all([
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
      // 一個團次不能同時是「今日／明日出發」卡片又是「成團決定」卡片：兩者的深連結
      // 完全相同（/tenant/trips/:tripId），guide 只需要被問一次。formation query 是
      // 這兩個 formation_status 值的唯一權威來源，這裡直接在來源排除，而不是把兩組
      // 結果都抓回來後在 JS 裡事後去重——排除條件在這裡是可證的（誰是權威一望即知），
      // 事後去重只會讓人猜哪一個 query 才是準的。
      .not('formation_status', 'in', '(REVIEW_REQUIRED,AT_RISK)')
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
      // 0107 還沒有 #41 §6 的自動轉態 transaction，REVIEW_REQUIRED／AT_RISK 不會在
      // 出發後自動被清掉。沒有下限的話，已經出發過的舊團次會跟現在的團次一起用
      // `.order('departs_on' asc).limit(20)` 排序，陳舊列可能擠掉還活著的列，而且
      // 永遠顯示「立即處理」。這裡只加下限，不去猜測／改寫它們的 formation_status——
      // 那是 #41 §6 要做的事，不是這個唯讀收件匣端點的責任。
      .gte('departs_on', today)
      .order('departs_on', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(20),
    // #43 類別 5：REFUND_PENDING。獨立表（tour_orders）、獨立 enum
    // （tour_payment_status），與上面兩個 BOOKING_* query 天生不相交，見上方
    // 檔案頂端註解——這裡不需要、也沒有可排除的重疊。
    t.supabase
      .from('tour_orders')
      .select('id, order_no, contact, paid_amount, refunded_amount, updated_at, created_at')
      .eq('tenant_id', t.tenantId)
      .eq('payment_status', 'REFUND_PENDING')
      .order('updated_at', { ascending: true })
      .limit(20),
  ]);

  if (bookingResult.error) throw bookingResult.error;
  if (paymentBookingResult.error) throw paymentBookingResult.error;
  if (departureResult.error) throw departureResult.error;
  if (formationResult.error) throw formationResult.error;
  if (refundPendingResult.error) throw refundPendingResult.error;

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
        // `min_to_depart_snapshot` 是 `not null default 1`，且有 `>= 1 AND <= capacity`
        // 的 CHECK（0107），不會是 null——這裡直接讀欄位，不再用 `?? 1` 假裝它可能缺值。
        minToDepart: row.min_to_depart_snapshot,
        formationStatus: row.formation_status,
        formationDeadlineAt: row.formation_deadline_at ?? null,
        formedParticipants: row.formed_participants ?? null,
        createdAt: row.created_at,
      }, now, timeZone);
    })
    .filter((item): item is GuideActionInboxItem => item !== null);

  const refundPendingItems: GuideActionInboxItem[] = (refundPendingResult.data ?? []).map((row: any) => {
    const contact = (row.contact ?? {}) as Record<string, unknown>;
    const paidAmount = Number(row.paid_amount ?? 0);
    const refundedAmount = Number(row.refunded_amount ?? 0);
    return buildGuideActionInboxRefundPendingItem({
      id: row.id,
      orderNo: row.order_no,
      customerName: String(contact.name ?? ''),
      // CHECK tour_orders_refunded_amount_ck（0108）保證 refunded_amount <= paid_amount，
      // 所以理論上不會是負的；Math.max 只是不讓一個未知的資料異常直接冒出負金額卡片。
      refundOutstandingAmount: Math.max(paidAmount - refundedAmount, 0),
      dueAt: row.updated_at,
      createdAt: row.created_at,
      href: `/tenant/tour-orders?paymentStatus=REFUND_PENDING&orderId=${encodeURIComponent(row.id)}`,
    });
  });

  return ok(sortGuideActionInboxItems([
    ...bookingItems,
    ...bookingPaymentItems,
    ...departureItems,
    ...formationItems,
    ...refundPendingItems,
  ]));
});
