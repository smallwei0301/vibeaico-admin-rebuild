import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  buildGuideActionInboxFormationItem,
  buildGuideActionInboxRefundPendingItem,
  buildGuideActionInboxStaffConflictItem,
  buildGuideActionInboxStaffUnassignedItem,
  buildGuideActionInboxTourPaymentDueItem,
  buildGuideActionInboxTourRequestItem,
  dropGuideActionInboxOrderCardsAlreadyCovered,
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  isGuideActionInboxFormationStatus,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
  type GuideActionInboxStaffConflictDetail,
} from '@/lib/guide-action-inbox';
import {
  departureInterval, findStaffConflicts, loadStaffLoad,
} from '@/server/staff-availability';

type RelatedName = { name?: string | null; title?: string | null } | { name?: string | null; title?: string | null }[] | null;

function relatedValue(value: RelatedName): { name?: string | null; title?: string | null } | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** 通用版：PostgREST 內嵌關聯可能回單一物件或陣列，這裡只取第一筆（或 null）。 */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * GUIDE 首頁單一聚合 action inbox 端點（#43 §4：不可把不同資料表全抓到前端後自行
 * 拼湊，改由 server 端用相同 tenant 邊界彙整成一份已排序清單）：
 *   - 待確認預約（BOOKING_REQUEST）、待收款預約（BOOKING_PAYMENT）— bookings_view。
 *     這是 LOCAL_SHOP 的服務預約流程，跟下面的 TOUR_REQUEST 是不同資料表、不同
 *     業務流程，天生不相交。
 *   - #43 類別 1（GUIDE 旅遊側）：待導遊接受／拒絕的 REQUEST（TOUR_REQUEST）—
 *     `tour_orders.status = 'PENDING'` 且其 `trip_plans.sales_mode = 'REQUEST'`
 *     （0107，#41 canonical）。19 分冊 §1.6／§2.3「先申請再確認」：旅客送出申請
 *     時不鎖導遊時間，這裡只誠實呈現既有的 PENDING + REQUEST 訂單，不新建狀態、
 *     不代替導遊決定要不要接受。
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
 *   - #43 類別 7：人員指派或時間衝突（不可履約風險）— 讀同一次
 *     `trip_departures(...trip_departure_staff(...))` 查詢，依「這團有沒有
 *     `role = 'PRIMARY'` 的指派」把候選團次分成兩組，兩組天生不相交：
 *       - 有 PRIMARY：可能「已指派人員、但該指派實際撞期」（STAFF_CONFLICT）。
 *         判斷本身**不在這裡重新實作**，直接呼叫既有的 `loadStaffLoad()` /
 *         `findStaffConflicts()`（`src/server/staff-availability.ts`，issue #37
 *         §5.3 canonical，團次建立／編輯／batch 三處共用的唯一撞班引擎）。
 *       - 沒有 PRIMARY：無論完全未指派還是只指派了 ASSISTANT，都是「還沒滿足
 *         `10-TOUR-DOMAIN.md` §1.3 最低可履約門檻」（STAFF_UNASSIGNED）。
 *     人員指派讀 `trip_departure_staff`（0092，issue #37 canonical）；不新增第
 *     二套撞班規則，也不改 `staff-availability.ts` 的行為。STAFF_UNASSIGNED 這
 *     半先前（#448）刻意留給 Owner 另外裁示，本輪依 Sol TRIAGE 明確授權的範圍
 *     補上，見 `src/lib/guide-action-inbox.ts` 對應型別上的說明。
 *     這個候選查詢跟 DEPARTURE 查詢一樣，必須排除 formation query 已經涵蓋的
 *     REVIEW_REQUIRED／AT_RISK 團次（#479 修復）——STAFF_CONFLICT／
 *     STAFF_UNASSIGNED 卡片的深連結跟 formation 卡片相同，都是
 *     `/tenant/trips/:tripId`，沒有這條排除的話，一個尚未成團、也沒有 PRIMARY
 *     指派的團次會同時冒出 STAFF_UNASSIGNED 與 REVIEW_REQUIRED／AT_RISK 兩張卡。
 */
const MISSING_SCHEMA_CODES = new Set(['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205']);

/** 缺欄位／缺資料表／缺關聯 → 視為空結果；其他錯誤照舊 throw。 */
function tolerateMissingSchema(source: string, result: { data: any[] | null; error: any }): any[] {
  if (result.error) {
    if (MISSING_SCHEMA_CODES.has(String(result.error.code ?? ''))) {
      // 只記來源名稱與錯誤碼（不含訂單／旅客資料）。
      console.warn(`[guide-action-inbox] ${source} degraded to 0 cards: schema error ${String(result.error.code)}`);
      return [];
    }
    throw result.error;
  }
  return result.data ?? [];
}

/** 等待付款兩個查詢的有界視窗；程式內依期限排序後每類最多取 PAYMENT_DUE_CAP 張。 */
const PAYMENT_DUE_WINDOW = 200;
const PAYMENT_DUE_CAP = 20;
/** 尾款／全額待付：依出發時刻分批讀團次（每批筆數、最多批數）與每批訂單上限。 */
const PAYMENT_DUE_DEPARTURE_BATCH = 100;
/** 慢路徑單一分類的掃描時間預算（毫秒）；超過就 warn 並回傳已知最佳集合。測試以 Date.now 注入時鐘。 */
const PAYMENT_DUE_SCAN_BUDGET_MS = 1500;
/** 慢路徑安全上限（100 批 × 100 團次）；撞到時 warn 並回傳已知最佳集合，不回空。 */
const PAYMENT_DUE_MAX_BATCHES = 100;
const PAYMENT_DUE_ORDER_LIMIT = 1000;
/** 快路徑單次查詢上限：回傳筆數低於此值代表已取得全部符合的訂單。 */
const PAYMENT_DUE_FIRST_LIMIT = 200;

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
    staffAssignmentResult, tourRequestResult, paymentDueUnpaidResult,
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
    // #43 類別 7：未來、可履約（OPEN／CLOSED）的團次，連同其人員指派一起內嵌
    // 讀出（`trip_departure_staff(staff_id, role, staff(name))`）。這一批候選同時
    // 餵給 STAFF_CONFLICT（有 PRIMARY，撞不撞班留給下面 loadStaffLoad()/
    // findStaffConflicts() 判斷）與 STAFF_UNASSIGNED（沒有 PRIMARY）兩種卡片。
    //
    // #479 修復：STAFF_CONFLICT／STAFF_UNASSIGNED 卡片的深連結跟 DEPARTURE／
    // formation 卡片完全相同（皆是 `/tenant/trips/:tripId`，見
    // `guide-action-inbox.ts` 對應的 build*Item()），但這裡先前沒有跟 DEPARTURE
    // query（上面）一樣排除 formation query 已經涵蓋的 REVIEW_REQUIRED／AT_RISK
    // 團次——一個尚未成團、且沒有 PRIMARY 指派的團次，會同時被這裡判成
    // STAFF_UNASSIGNED、又被下面的 formation query 判成 REVIEW_REQUIRED／
    // AT_RISK，同一個團次疊出兩張卡（真正的重複根因；不是原本懷疑的 DEPARTURE
    // query 排除失效——那條排除本身其實有效，見 Issue #479 調查記錄）。跟
    // DEPARTURE query 用一樣的排除條件、一樣的理由：formation 卡片是這個團次
    // 唯一權威的「需要決定」入口，人員指派問題留到成團決定之後才有意義追。
    t.supabase
      .from('trip_departures')
      .select('id, trip_id, plan_id, departs_on, start_time, status, created_at, trips(title, duration_hours), trip_plans(name), trip_departure_staff(staff_id, role, staff(name))')
      .eq('tenant_id', t.tenantId)
      .in('status', ['OPEN', 'CLOSED'])
      .gte('departs_on', today)
      .not('formation_status', 'in', '(REVIEW_REQUIRED,AT_RISK)')
      .order('departs_on', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(20),
    // #43 類別 1：待導遊接受／拒絕的 REQUEST。`trip_plans!inner(...)` 讓
    // `.eq('trip_plans.sales_mode', 'REQUEST')` 這條內嵌欄位過濾真的生效（同一
    // 寫法見 `src/app/api/reports/top-products/route.ts`），不是只抓整張
    // tour_orders 表再指望前端自己挑出 REQUEST 方案。
    t.supabase
      .from('tour_orders')
      .select('id, order_no, party_size, total_amount, contact, hold_expires_at, created_at, trip_plans!inner(sales_mode, name), trips(title), trip_departures(departs_on, start_time)')
      .eq('tenant_id', t.tenantId)
      .eq('status', 'PENDING')
      .eq('trip_plans.sales_mode', 'REQUEST')
      .order('created_at', { ascending: true })
      .limit(20),
    // #43 類別 2（INITIAL）：導遊已接受的申請（CONFIRMED + UNPAID + seats_reserved +
    // 有保留期限，訂金或全額），期限是 hold_expires_at。`seats_reserved` 來自 0111，所以這個
    // 來源以 tolerateMissingSchema 包起來。逾期 hold 目前不會被 expiry RPC 取消，所以在來源
    // 就用 `trip_departures!inner` + departs_on >= 租戶今天排除已出發團次；取有界視窗後於程式內
    // 依期限排序取前 20。每個 query 都帶 tenant_id。
    t.supabase
      .from('tour_orders')
      .select('id, order_no, party_size, total_amount, deposit_amount, paid_amount, status, payment_status, seats_reserved, contact, hold_expires_at, created_at, trip_plans(name), trips(title), trip_departures!inner(departs_on, start_time, status)')
      .eq('tenant_id', t.tenantId)
      .eq('status', 'CONFIRMED')
      .eq('payment_status', 'UNPAID')
      .eq('seats_reserved', true)
      .not('hold_expires_at', 'is', null)
      .neq('trip_departures.status', 'CANCELLED')
      .gte('trip_departures.departs_on', today)
      .order('hold_expires_at', { ascending: true })
      .limit(PAYMENT_DUE_WINDOW),
  ]);

  if (bookingResult.error) throw bookingResult.error;
  if (paymentBookingResult.error) throw paymentBookingResult.error;
  if (departureResult.error) throw departureResult.error;
  if (formationResult.error) throw formationResult.error;
  if (refundPendingResult.error) throw refundPendingResult.error;
  if (staffAssignmentResult.error) throw staffAssignmentResult.error;
  if (tourRequestResult.error) throw tourRequestResult.error;
  // `seats_reserved`（0111）在尚未套用該 migration 的環境不存在：這兩個等待付款來源遇到
  // 缺欄位／缺關聯錯誤時只貢獻 0 張卡，不拖垮其他來源；其他錯誤照舊 throw。
  const paymentDueUnpaidRows = tolerateMissingSchema('payment-due:confirmed-unpaid', paymentDueUnpaidResult);

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

  // #43 類別 7：把候選團次依「有沒有 PRIMARY 指派」分成兩組——STAFF_UNASSIGNED
  // （沒有 PRIMARY，含完全未指派與只指派 ASSISTANT 兩種情況）在這裡直接組卡片；
  // 有 PRIMARY 的才進下面的撞班候選名單。兩組天生不相交，見本檔頂端與
  // `guide-action-inbox.ts` 對應型別上的說明。
  const staffUnassignedItems: GuideActionInboxItem[] = [];
  const staffConflictCandidates = (staffAssignmentResult.data ?? [])
    .map((row: any) => {
      const assignments = (Array.isArray(row.trip_departure_staff) ? row.trip_departure_staff : []) as Array<{
        staff_id: string;
        role: string;
        staff: RelatedName;
      }>;
      const hasPrimary = assignments.some((assignment) => assignment.role === 'PRIMARY');
      if (!hasPrimary) {
        const trip = relatedValue(row.trips as RelatedName) as { title?: string | null } | null;
        const plan = relatedValue(row.trip_plans as RelatedName);
        staffUnassignedItems.push(buildGuideActionInboxStaffUnassignedItem({
          id: row.id,
          tripId: row.trip_id,
          tripName: trip?.title ?? '',
          planName: plan?.name ?? '',
          departureDate: String(row.departs_on).slice(0, 10),
          startTime: row.start_time ? String(row.start_time).slice(0, 5) : '',
          createdAt: row.created_at,
        }, now, timeZone));
        return null;
      }
      const departureDate = String(row.departs_on).slice(0, 10);
      const startTime = row.start_time ? String(row.start_time).slice(0, 5) : '';
      const trip = relatedValue(row.trips as RelatedName) as
        { title?: string | null; duration_hours?: number | null } | null;
      const slot = departureInterval({
        departsOn: departureDate,
        startTime: row.start_time ? startTime : null,
        durationHours: trip?.duration_hours ?? null,
      });
      const staffNameById = new Map<string, string>();
      const staffIds: string[] = [];
      for (const assignment of assignments) {
        const staffId = String(assignment.staff_id);
        staffIds.push(staffId);
        staffNameById.set(staffId, relatedValue(assignment.staff)?.name ?? '');
      }
      return { row, slot, shiftDate: departureDate, startTime, staffIds, staffNameById };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  let staffConflictItems: GuideActionInboxItem[] = [];
  if (staffConflictCandidates.length > 0) {
    // 一次讀出涵蓋這批候選團次整段區間的負載（`loadStaffLoad` 是
    // `staff-availability.ts` 內唯一碰 DB 的地方），再對每一團各自判斷——不對每團
    // 各發一次查詢。
    const fromMs = Math.min(...staffConflictCandidates.map((c) => c.slot.start));
    const toMs = Math.max(...staffConflictCandidates.map((c) => c.slot.end));
    const load = await loadStaffLoad(t.supabase, t.tenantId, fromMs, toMs);

    staffConflictItems = staffConflictCandidates
      .map((c): GuideActionInboxItem | null => {
        // 排除這一團自己在 `load.departures` 裡的佔用：同一次 `loadStaffLoad()`
        // 涵蓋了這批候選團次自己的區間，不排除的話「這一團自己佔用了這個時段」
        // 會被 `findStaffConflicts` 誤判成撞到別團。
        const filteredLoad = {
          ...load,
          departures: load.departures.filter((d) => d.departureId !== c.row.id),
        };
        const conflicts = findStaffConflicts(c.staffIds, c.slot, c.shiftDate, filteredLoad);
        if (conflicts.length === 0) return null;
        const details: GuideActionInboxStaffConflictDetail[] = conflicts.map((conflict) => ({
          staffId: conflict.staffId,
          staffName: c.staffNameById.get(conflict.staffId) ?? '',
          reason: conflict.reason,
        }));
        const trip = relatedValue(c.row.trips as RelatedName);
        const plan = relatedValue(c.row.trip_plans as RelatedName);
        return buildGuideActionInboxStaffConflictItem({
          id: c.row.id,
          tripId: c.row.trip_id,
          tripName: trip?.title ?? '',
          planName: plan?.name ?? '',
          departureDate: String(c.row.departs_on).slice(0, 10),
          startTime: c.startTime,
          conflicts: details,
          createdAt: c.row.created_at,
        }, timeZone);
      })
      .filter((item): item is GuideActionInboxItem => item !== null);
  }

  const tourRequestItems: GuideActionInboxItem[] = (tourRequestResult.data ?? []).map((row: any) => {
    const contact = (row.contact ?? {}) as Record<string, unknown>;
    const trip = firstOf<{ title?: string | null }>(row.trips);
    const plan = firstOf<{ name?: string | null }>(row.trip_plans);
    const departure = firstOf<{ departs_on?: string | null; start_time?: string | null }>(row.trip_departures);
    return buildGuideActionInboxTourRequestItem({
      id: row.id,
      orderNo: row.order_no,
      customerName: String(contact.name ?? ''),
      tripName: trip?.title ?? '',
      planName: plan?.name ?? '',
      partySize: row.party_size,
      totalAmount: Number(row.total_amount ?? 0),
      holdExpiresAt: row.hold_expires_at ?? null,
      departureDate: departure?.departs_on ? String(departure.departs_on).slice(0, 10) : null,
      departureStartTime: departure?.start_time ? String(departure.start_time).slice(0, 5) : null,
      createdAt: row.created_at,
      href: `/tenant/tour-orders?orderId=${encodeURIComponent(row.id)}`,
    }, now, timeZone);
  });

  // #43 類別 2：兩個 query 的列用同一個 builder；不符合條件（例如 UNPAID 缺期限、已出發的
  // PARTIAL）回 null 不顯示。同一筆訂單若已有 TOUR_REQUEST／REFUND_PENDING 卡就不再疊一張。
  const buildPaymentDueCards = (rows: any[] | null) => (rows ?? [])
      .map((row: any) => {
        const contact = (row.contact ?? {}) as Record<string, unknown>;
        const trip = firstOf<{ title?: string | null }>(row.trips);
        const plan = firstOf<{ name?: string | null }>(row.trip_plans);
        const departure = firstOf<{ departs_on?: string | null; start_time?: string | null; status?: string | null }>(row.trip_departures);
        return buildGuideActionInboxTourPaymentDueItem({
          id: row.id,
          orderNo: row.order_no,
          customerName: String(contact.name ?? ''),
          tripName: trip?.title ?? '',
          planName: plan?.name ?? '',
          status: row.status,
          paymentStatus: row.payment_status,
          seatsReserved: row.seats_reserved,
          salesMode: firstOf<{ sales_mode?: string | null }>(row.trip_plans)?.sales_mode ?? null,
          holdExpiresAt: row.hold_expires_at ?? null,
          depositAmount: row.deposit_amount == null ? null : Number(row.deposit_amount),
          totalAmount: Number(row.total_amount ?? 0),
          paidAmount: row.paid_amount == null ? null : Number(row.paid_amount),
          departureDate: departure?.departs_on ? String(departure.departs_on).slice(0, 10) : null,
          departureStartTime: departure?.start_time ? String(departure.start_time).slice(0, 5) : null,
          departureStatus: (departure as { status?: string | null } | null)?.status ?? null,
          createdAt: row.created_at,
          href: `/tenant/tour-orders?orderId=${encodeURIComponent(row.id)}`,
        }, now, timeZone);
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      ;
  // 依期限（instant）由近到遠取前 PAYMENT_DUE_CAP；最終跨類型排序仍只在下方 return 處做一次。
  const toPaymentDueCards = (rows: any[] | null) => buildPaymentDueCards(rows)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id))
    .slice(0, PAYMENT_DUE_CAP);
  // #43 類別 2（BALANCE／FULL）：等待尾款（CONFIRMED + PARTIAL，期限＝出發時刻）與一般固定團／
  // 即時預約的 PENDING + UNPAID 全額待付（旅客轉帳、導遊確認收款；現行所有建單路徑都不寫
  // hold_expires_at，期限用出發時刻，有 hold 則用 hold）。兩類各自獨立處理：
  //
  //  1. 快路徑：一次有界查詢（`trip_departures!inner` + departs_on >= 租戶今天，上限
  //     PAYMENT_DUE_FIRST_LIMIT）。回傳筆數 < 上限＝已拿到「全部」符合的訂單，程式內依期限排序取前
  //     20 即完成（一般租戶只花 1 個查詢）。
  //  2. 慢路徑（快路徑被塞滿才走）：期限＝出發時刻，所以用 keyset（departs_on, id）分批讀
  //     trip_departures（tenant、非 CANCELLED、departs_on >= 今天），再 `.in('departure_id', ids)` 讀
  //     該批訂單；當已有 ≥20 張卡、且第 20 張的出發日早於本批最後一個出發日（該日可能還有下一批
  //     的團次）時停止。keyset 不含 start_time，同一天內的先後交給程式內排序；跨批同日的最壞情形
  //     由上面的停止條件涵蓋。慢路徑以快路徑的列為種子，並用高上限（PAYMENT_DUE_MAX_BATCHES）持續掃描，
  //     撞到上限時 warn 並回傳已知最佳集合（種子列此時不一定是全域最早）。不使用未驗證的 PostgREST 內嵌欄位排序語法。
  // PENDING 若帶 hold，hold 理論上早於出發；慢路徑只在已讀到的批次內依有效期限排序——現行資料沒有
  // 這種列，如實記錄。訂單依 id 去重，避免團次中途異動造成重複卡片。
  // 只用 ≤0108 欄位與 0107 的 trip_plans.sales_mode；PARTIAL／PENDING 不碰 seats_reserved（0111），
  // 也不套 tolerateMissingSchema：它們不依賴 0109+ 欄位，錯誤照舊 throw。
  // 未接受的 REQUEST（sales_mode = 'REQUEST'）由 TOUR_REQUEST 處理，這裡排除。
  // TODO：加入線上金流（ECPay）PENDING 流程後，經線上 provider 付款的 PENDING 必須排除（18 §5／§6）。
  const ORDER_SELECT = 'id, order_no, party_size, total_amount, deposit_amount, paid_amount, status, payment_status, contact, hold_expires_at, created_at, trips(title), trip_departures!inner(departs_on, start_time, status)';
  const paymentDueOrderQuery = (kind: 'PARTIAL' | 'PENDING') => {
    const base = t.supabase
      .from('tour_orders')
      .select(kind === 'PARTIAL'
        ? `${ORDER_SELECT}, trip_plans(name)`
        : `${ORDER_SELECT}, trip_plans!inner(name, sales_mode)`)
      .eq('tenant_id', t.tenantId)
      .eq('status', kind === 'PARTIAL' ? 'CONFIRMED' : 'PENDING')
      .eq('payment_status', kind === 'PARTIAL' ? 'PARTIAL' : 'UNPAID');
    // 與慢路徑的團次視窗一致：已取消的團次（trip_departures.status = 'CANCELLED'，0066）不產生卡片。
    return (kind === 'PENDING' ? base.neq('trip_plans.sales_mode', 'REQUEST') : base)
      .neq('trip_departures.status', 'CANCELLED')
      .gte('trip_departures.departs_on', today);
  };

  const scanPaymentDue = async (kind: 'PARTIAL' | 'PENDING'): Promise<any[]> => {
    const first = await paymentDueOrderQuery(kind).limit(PAYMENT_DUE_FIRST_LIMIT);
    if (first.error) throw first.error;
    const firstRows = first.data ?? [];
    if (firstRows.length < PAYMENT_DUE_FIRST_LIMIT) return firstRows;

    // 以快路徑的列當種子（依 id 去重）：它們已證明存在，分類不會因為掃描沒走到而變空。
    // 注意：撞到批次安全上限時，種子列不一定是全域最早的（快路徑沒排序）——此時只是「已知最佳集合」。
    const rowsById = new Map<string, any>(firstRows.map((row: any) => [row.id, row]));
    // 卡片依訂單 id 快取：每批只為新列建卡（種子列不重算），停止條件只需排序現有卡片。
    const cardDueByRowId = new Map<string, { dueAt: string; dueLocalDate: string; id: string }>();
    const addCards = (rows: any[]) => {
      for (const row of rows) {
        if (cardDueByRowId.has(row.id)) continue;
        const [card] = buildPaymentDueCards([row]);
        if (card) cardDueByRowId.set(row.id, card);
      }
    };
    addCards(firstRows);
    let cursor: { departsOn: string; id: string } | null = null;
    let exhausted = false;
    let batchesScanned = 0;
    const scanStartedAt = Date.now();
    for (let batch = 0; batch < PAYMENT_DUE_MAX_BATCHES; batch += 1) {
      // 次要界線：時間預算（主要界線是批次上限）。第一批一定會掃，之後超時就停。
      if (batch > 0 && Date.now() - scanStartedAt > PAYMENT_DUE_SCAN_BUDGET_MS) break;
      batchesScanned += 1;
      let depQuery = t.supabase
        .from('trip_departures')
        .select('id, departs_on, start_time')
        .eq('tenant_id', t.tenantId)
        .neq('status', 'CANCELLED')
        .gte('departs_on', today);
      if (cursor) {
        depQuery = depQuery.or(
          `departs_on.gt.${cursor.departsOn},and(departs_on.eq.${cursor.departsOn},id.gt.${cursor.id})`,
        );
      }
      const departureWindow = await depQuery
        .order('departs_on', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAYMENT_DUE_DEPARTURE_BATCH);
      if (departureWindow.error) throw departureWindow.error;
      const deps = (departureWindow.data ?? []) as Array<{ id: string; departs_on: string }>;
      if (deps.length === 0) { exhausted = true; break; }
      const last = deps[deps.length - 1];
      cursor = { departsOn: String(last.departs_on).slice(0, 10), id: last.id };

      const result = await paymentDueOrderQuery(kind)
        .in('departure_id', deps.map((d) => d.id))
        .limit(PAYMENT_DUE_ORDER_LIMIT);
      if (result.error) throw result.error;
      const rows = result.data ?? [];
      if (rows.length >= PAYMENT_DUE_ORDER_LIMIT) {
        // 這批訂單被上限截斷（未排序）；只記來源與筆數，不含訂單／旅客資料。
        console.warn(`[guide-action-inbox] payment-due:${kind.toLowerCase()} batch hit order limit (${rows.length})`);
      }
      for (const row of rows) rowsById.set(row.id, row);
      addCards(rows);

      if (deps.length < PAYMENT_DUE_DEPARTURE_BATCH) { exhausted = true; break; }
      const cards = [...cardDueByRowId.values()]
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id));
      if (cards.length >= PAYMENT_DUE_CAP
        && cards[PAYMENT_DUE_CAP - 1].dueLocalDate < cursor.departsOn) { exhausted = true; break; }
    }
    if (!exhausted) {
      console.warn(`[guide-action-inbox] payment-due:${kind.toLowerCase()} departure scan stopped early (batches scanned: ${batchesScanned}, cap ${PAYMENT_DUE_MAX_BATCHES}, budget ${PAYMENT_DUE_SCAN_BUDGET_MS}ms); returning best-known set`);
    }
    return [...rowsById.values()];
  };
  const [partialRows, pendingRows] = await Promise.all([
    scanPaymentDue('PARTIAL'),
    scanPaymentDue('PENDING'),
  ]);

  const paymentDueItems: GuideActionInboxItem[] = dropGuideActionInboxOrderCardsAlreadyCovered(
    [...toPaymentDueCards(paymentDueUnpaidRows), ...toPaymentDueCards(partialRows), ...toPaymentDueCards(pendingRows)],
    [...tourRequestItems, ...refundPendingItems],
  );

  return ok(sortGuideActionInboxItems([
    ...bookingItems,
    ...bookingPaymentItems,
    ...departureItems,
    ...formationItems,
    ...refundPendingItems,
    ...staffConflictItems,
    ...staffUnassignedItems,
    ...tourRequestItems,
    ...paymentDueItems,
  ]));
});
