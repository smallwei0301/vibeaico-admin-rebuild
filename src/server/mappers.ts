/**
 * src/server/mappers.ts — snake_case（DB）→ camelCase（前端契約 src/lib/types.ts）
 * 規格：01-ARCHITECTURE.md §5.5、02-SUPABASE-SCHEMA.md、鐵則 3。
 *
 * 每個資源一個顯式 mapper 函式（不用泛型自動轉換）。null 規則見各函式內註解，
 * 原則：
 *   - types.ts 宣告為 `xxx | null` → 直接傳遞，保留 null。
 *   - types.ts 宣告為非 null 的 `string`，但底層欄位可能是 null 或本質為
 *     「可留白」的自由文字/計數（note、description、phone、email、頭像網址、
 *     birthday、即時 count…）→ `?? ''` / `?? 0` / `?? []`，與 01 分冊範例
 *     `mapBooking` 的 `note: r.note ?? ''` 一致。
 *   - id、單號、外鍵 id、enum 狀態欄位等一律「必然存在」的欄位不做 `?? ''`
 *     防呆（空字串不是合法的 fallback 語意），直接傳遞。
 */

import type {
  Booking,
  Customer,
  Service,
  Staff,
  Product,
  ProductOrder,
  Coupon,
  MembershipLevel,
  PointTransaction,
  StaffPerformance,
  TenantSummary,
  TourOrder,
  Trip,
  TripAddon,
  TripBookingType,
  TripDeparture,
  TripPlan,
  TripPlanSeason,
} from '@/lib/types';

/* ------------------------------------------------------------------ 預約 */
// 01 分冊 §5.5 範例，照抄。來源：bookings_view（join customers/services/staff）。
export function mapBooking(r: any): Booking {
  return {
    id: r.id, bookingNo: r.booking_no,
    customerId: r.customer_id, customerName: r.customer_name, customerPhone: r.customer_phone,
    serviceId: r.service_id, serviceName: r.service_name,
    staffId: r.staff_id, staffName: r.staff_name,
    startAt: r.start_at, endAt: r.end_at, durationMinutes: r.duration_minutes,
    price: r.price, finalPrice: r.final_price,
    status: r.status, paymentStatus: r.payment_status, source: r.source,
    note: r.note ?? '', createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ 顧客 */
// 來源：customers_view（join membership_levels + bookings 聚合出的
// membership_level_name / booking_count / total_spent / last_visit_at / at_risk）。
export function mapCustomer(r: any): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    // gender_type enum 空值以 null 表示（02 §0002 註解），mapper 轉 ''
    gender: r.gender ?? '',
    birthday: r.birthday ?? '',
    note: r.note ?? '',
    lineUserId: r.line_user_id,
    lineDisplayName: r.line_display_name,
    membershipLevelId: r.membership_level_id,
    membershipLevelName: r.membership_level_name ?? null,
    tags: r.tags ?? [],
    bookingCount: r.booking_count,
    totalSpent: r.total_spent,
    points: r.points,
    lastVisitAt: r.last_visit_at,
    atRisk: r.at_risk,
    active: r.active,
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------ 服務 / 員工 */
// 來源：services join service_categories（category_name 為 join 欄位，
// 02 分冊未寫明確 view，比照 bookings_view 同套命名慣例：<表>_name）。
export function mapService(r: any): Service {
  return {
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_name ?? null,
    name: r.name,
    description: r.description ?? '',
    durationMinutes: r.duration_minutes,
    price: r.price,
    imageUrl: r.image_url ?? '',
    active: r.active,
    lineFeatured: r.line_featured,
    sortOrder: r.sort_order,
  };
}

// 來源：staff join staff_services 聚合出的 service_ids（多對多，查詢層需自行
// array_agg，02 分冊未提供 view，比照命名慣例：<欄位>s → <欄位>_ids）。
export function mapStaff(r: any): Staff {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    title: r.title ?? '',
    avatarUrl: r.avatar_url ?? '',
    serviceIds: r.service_ids ?? [],
    bookable: r.bookable,
    active: r.active,
    sortOrder: r.sort_order,
    scheduleMode: r.schedule_mode ?? 'ROTATING',
    // 0082 的四個欄位都有 NOT NULL DEFAULT，所以正常情況下不會是 null；
    // 這裡的 ?? 只是保護「migration 尚未套用」的環境，讓它退回與 DB 預設值
    // 相同的解讀，而不是 undefined 到畫面上變成空白。
    displayName: r.display_name ?? '',
    bio: r.bio ?? '',
    maxConcurrentBookings: Number(r.max_concurrent_bookings ?? 1),
    visible: r.visible ?? true,
  };
}

/* ------------------------------------------------------------ 商品 / 訂單 */
// 來源：products join product_categories（category_name 同 mapService 的假設）。
export function mapProduct(r: any): Product {
  return {
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_name ?? null,
    name: r.name,
    description: r.description ?? '',
    price: r.price,
    stock: r.stock,
    safetyStock: r.safety_stock,
    imageUrl: r.image_url ?? '',
    active: r.active,
    lineFeatured: r.line_featured,
    sortOrder: r.sort_order,
  };
}

// 來源：product_orders join customers（customer_name）+ product_order_items
// （逐項 snapshot 欄位，query 層需把明細一併查出並附掛在 r.items）。
export function mapProductOrder(r: any): ProductOrder {
  return {
    id: r.id,
    orderNo: r.order_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    items: (r.items ?? []).map((it: any) => ({
      productId: it.product_id,
      productName: it.product_name,
      quantity: it.quantity,
      price: it.price,
    })),
    totalAmount: r.total_amount,
    status: r.status,
    paymentStatus: r.payment_status,
    createdAt: r.created_at,
    // coupon_discount 可為 NULL（沒套用票券）。這裡收斂成 0：折抵「真的是零」，
    // 不是「不知道」——0081 migration 檔頭有同一段說明。
    couponDiscount: Number(r.coupon_discount ?? 0),
  };
}

/* ------------------------------------------------------------------ 票券 */
// 來源：coupons；issued_quantity / redeemed_quantity 為即時 count（02 §0004
// 註解「用 count 即時算」），query 層需以 coupon_instances 聚合後附掛在同一列。
export function mapCoupon(r: any): Coupon {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    discountType: r.discount_type,
    discountValue: r.discount_value,
    totalQuantity: r.total_quantity,
    issuedQuantity: r.issued_quantity ?? 0,
    redeemedQuantity: r.redeemed_quantity ?? 0,
    // start_at / end_at 在 DB 沒有 not null 限制，types.ts 為非 null string → ?? ''
    startAt: r.start_at ?? '',
    endAt: r.end_at ?? '',
    status: r.status,
    minOrderAmount: r.min_order_amount == null ? null : Number(r.min_order_amount),
    maxDiscountAmount: r.max_discount_amount == null ? null : Number(r.max_discount_amount),
    giftItem: r.gift_item ?? '',
    limitPerCustomer: r.limit_per_customer == null ? null : Number(r.limit_per_customer),
    privateMode: r.private_mode ?? false,
    // 由 GET /api/coupons 依 coupon_instances 即時附掛，不是 coupons 的欄位。
    lastRedeemedCode: r.last_redeemed_code ?? null,
  };
}

/* -------------------------------------------------------------- 會員等級 */
// 來源：membership_levels；customer_count 為即時 count（依 membership_level_id
// 聚合 customers），02 分冊未提供 view，query 層需自行聚合附掛。
export function mapMembershipLevel(r: any): MembershipLevel {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    thresholdSpent: r.threshold_spent,
    discountPercent: r.discount_percent,
    pointRateMultiplier: r.point_rate_multiplier,
    customerCount: r.customer_count ?? 0,
    sortOrder: r.sort_order,
    description: r.description ?? '',
    active: r.active ?? true,
    isDefault: r.is_default ?? false,
  };
}

/* ------------------------------------------------------------------ 點數 */
// 來源：tenant_point_transactions（店家平台點數錢包，非顧客個人點數
// customer_point_logs——兩張表欄位形狀不同，PointTransaction 對應前者）。
export function mapPointTransaction(r: any): PointTransaction {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    balanceAfter: r.balance_after,
    description: r.description ?? '',
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ 報表 */
// StaffPerformance 是報表彙總列，不對應單一資料表；由 staff join bookings
// 統計查詢產生，query 層需輸出 staff_id/staff_name/booking_count/
// completion_rate/revenue 別名欄位。
export function mapStaffPerformance(r: any): StaffPerformance {
  return {
    staffId: r.staff_id,
    staffName: r.staff_name,
    bookingCount: r.booking_count,
    completionRate: r.completion_rate,
    revenue: r.revenue,
  };
}

/* ------------------------------------------------------------------ 租戶 */
/**
 * 來源：tenant_users join tenants（形狀比照 01 分冊 §5.3 requireTenant() 的
 * `.select('tenant_id, role, tenants(shop_code, name)')`）。
 *
 * `current` 不是資料庫欄位，是「這筆是不是目前作用中的租戶」的請求層級狀態
 * （由 vibeai_active_tenant cookie 或使用者第一個成員資格決定，見 01 §5.3），
 * 因此本 mapper 多帶一個 activeTenantId 參數，而非單純 snake→camel 轉換。
 *
 * `business_type` 欄位由 13-BUSINESS-MODES.md 的 migration 0014 新增
 * （tenants.business_type，not null default 'LOCAL_SHOP'）。
 * `extra_modules`（對應 types.ts 的 extraModules，斜槓店家加開的其他模組）
 * 目前在 02 分冊與 13 分冊都**沒有**對應的資料表欄位定義；此處以
 * `r.tenants.extra_modules` 防呆讀取，欄位不存在時安全地回傳 undefined。
 */
export function mapTenantSummary(r: any, activeTenantId?: string): TenantSummary {
  return {
    id: r.tenant_id,
    shopCode: r.tenants.shop_code,
    name: r.tenants.name,
    role: r.role,
    current: r.tenant_id === activeTenantId,
    businessType: r.tenants.business_type ?? undefined,
    extraModules: r.tenants.extra_modules ?? undefined,
  };
}

/* ------------------------------------------------------------ 行程核心 */
/**
 * Canonical #8-A rows deliberately stay smaller than the legacy mock/UI shape.
 * These mappers provide the existing frontend contract with explicit, honest
 * defaults; they never invent persisted fields that are not in the four-table
 * schema from 10-TOUR-DOMAIN.md §1.
 */
export function mapTrip(r: any, derived: {
  planCount?: number;
  minPrice?: number;
  upcomingDepartureCount?: number;
} = {}): Trip {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    tagline: r.tagline ?? '',
    summary: r.summary ?? '',
    description: r.description ?? '',
    region: r.location ?? '',
    category: '',
    coverImageUrl: r.cover_image_url ?? '',
    galleryUrls: Array.isArray(r.gallery) ? r.gallery.map(String) : [],
    meetingPoint: r.meeting_point ?? '',
    meetingPointMapUrl: r.meeting_point_map_url ?? '',
    inclusions: typeof r.includes === 'string'
      ? r.includes.split('\n').map((v: string) => v.trim()).filter(Boolean)
      : [],
    exclusions: Array.isArray(r.exclusions) ? r.exclusions.map(String) : [],
    notices: Array.isArray(r.notices) ? r.notices.map(String) : [],
    safetyNotice: r.notes ?? r.safety_notice ?? '',
    refundPolicyType: (r.refund_policy_type ?? 'STANDARD') as Trip['refundPolicyType'],
    status: r.status,
    midaoListing: r.midao_listing,
    midaoListingNote: r.midao_listing_note ?? '',
    planCount: derived.planCount ?? 0,
    upcomingDepartureCount: derived.upcomingDepartureCount ?? 0,
    minPrice: derived.minPrice ?? 0,
    updatedAt: r.updated_at,
  };
}

/* #41：值域收斂用的集合。與 0107 的 CHECK 是同一組值，兩邊不得各自漂移。 */
const SALES_MODE = new Set(['FIXED_DEPARTURE', 'INSTANT', 'REQUEST']);
const FORMATION_STATUS = new Set(['COLLECTING', 'FORMED', 'REVIEW_REQUIRED', 'AT_RISK', 'FAILED']);
/* #41：與 0108 的 deposit_mode_snapshot CHECK、0066 的 trip_plans.deposit_mode 是同一組值。 */
const DEPOSIT_MODE_SNAPSHOT = new Set(['NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL']);
/*
 * #41：與 0108 的 tour_payment_status 值域是同一組值。
 *
 * 「canonical 端這一欄是 enum，資料庫已經保證值域，直接透傳即可」這個假設在真實
 * 環境裡不成立：2026-09-14 實查 shared TEST 時，trip_departures.formation_status
 * 是 **text**——那是歷史 #41 overlay 的殘留，canonical 0107 的
 * `add column if not exists` 對它是 no-op。同一個工作的另一半欄位既然能以 text
 * 的形式存在於某個環境，payment_status 沒有理由被當成「必然是 enum」。
 *
 * 收斂方向取「最不會讓 UI 誤宣稱已收到錢」的那一個：未知值一律當成 UNPAID，
 * 而不是保留原字串讓下游的窮舉 Record 查表落空。
 */
const TOUR_PAYMENT_STATUS = new Set(['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED']);

/**
 * issue #42：`trip_plan_seasons`（`0127`）子表列 → `TripPlanSeason`。
 * `price_override` 是 `number | null`——null 代表沿用方案基本價，不是 0。
 */
export function mapTripPlanSeason(r: any): TripPlanSeason {
  return {
    id: r.id,
    name: r.name ?? '',
    startMonth: Number(r.start_month),
    startDay: Number(r.start_day),
    endMonth: Number(r.end_month),
    endDay: Number(r.end_day),
    priceOverride: r.price_override == null ? null : Number(r.price_override),
    active: r.active ?? true,
  };
}

/**
 * issue #42：`sales_mode`（canonical，見 SALES_MODE）與 legacy `bookingType`
 * 語意重疊，Owner 已裁示不新增第二個 DB 欄位，改由前者 derive 後者，而不是
 * 讓 `bookingType` 繼續寫死成一個固定值。
 *
 * ⚠️ 這不只是顯示問題：`src/server/traveler-booking-policy.ts` 的
 * `resolveTravelerBookingPolicy()` 直接把 `plan.bookingType` 當成
 * `checkoutMode` 回傳（REQUEST_ONLY 政策除外）。寫死成 SCHEDULED 時，一個
 * 實際設定成 REQUEST 或 INSTANT 的方案，會在 GUIDE 後台「預約型態」欄位
 * 顯示錯誤的「固定團次」，未來接上 traveler checkout 後也會拿到錯的
 * checkoutMode。
 */
function deriveBookingType(salesMode: TripPlan['salesMode']): TripBookingType {
  if (salesMode === 'INSTANT') return 'INSTANT';
  if (salesMode === 'REQUEST') return 'REQUEST';
  return 'SCHEDULED';
}

export function mapTripPlan(r: any): TripPlan {
  const salesMode: TripPlan['salesMode'] = SALES_MODE.has(r.sales_mode) ? r.sales_mode : 'FIXED_DEPARTURE';
  return {
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    description: r.description ?? '',
    // issue #42：這三個欄位在 0110 之前是寫死的假值。現在讀真實欄位，未知
    // priceType 一律 fail-closed 成 PER_PERSON，與 salesMode/source 既有的
    // 收斂模式一致。
    durationMinutes: Number(r.duration_minutes ?? 60),
    priceType: r.price_type === 'PER_GROUP' ? 'PER_GROUP' : 'PER_PERSON',
    basePrice: Number(r.price_per_person ?? 0),
    childPrice: r.child_price == null ? null : Number(r.child_price),
    minParticipants: r.min_party ?? 1,
    maxParticipants: r.max_party ?? 10,
    bookingType: deriveBookingType(salesMode),
    depositMode: r.deposit_mode,
    depositValue: Number(r.deposit_value ?? 0),
    active: r.active ?? true,
    yearRound: r.year_round ?? true,
    // issue #42：`trip_plan_seasons`（0127）之前不存在，這裡永遠寫死 []。
    // 呼叫端用 `.select('*, trip_plan_seasons(*))` 帶出子表列時才會有資料；
    // PostgREST embed 不保證回傳順序，所以在這裡依 sort_order 排序一次。
    seasons: Array.isArray(r.trip_plan_seasons)
      ? [...r.trip_plan_seasons]
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(mapTripPlanSeason)
      : [],
    reviewState: 'NONE',
    reviewNote: '',
    sortOrder: r.sort_order ?? 0,
    // 0095 起 trip_plans.source 是真實欄位；未知值一律收斂成 GUIDE，
    // 寧可少顯示一個 badge，也不要把不認識的來源當成 Midao 代建。
    source: r.source === 'PLATFORM_ASSISTED' || r.source === 'IMPORTED' ? r.source : 'GUIDE',
    /*
     * #41（18 分冊 §1–§2）：販售規則與成團門檻。未知值收斂成 18 分冊寫明的
     * 預設組合（FIXED_DEPARTURE + SHARED、門檻 1、截止 7 天前），而不是
     * undefined——這幾個欄位的預設在 SQL 與這裡必須是同一組，否則同一筆資料
     * 在有無後端兩條路徑下會顯示成不同的規則。
     */
    salesMode,
    participationMode: r.participation_mode === 'PRIVATE' ? 'PRIVATE' : 'SHARED',
    minToDepart: Number.isFinite(Number(r.min_to_depart)) ? Number(r.min_to_depart) : 1,
    formationDeadlineDaysBefore: Number.isFinite(Number(r.formation_deadline_days_before))
      ? Number(r.formation_deadline_days_before) : 7,
  };
}

export function mapTripDeparture(r: any): TripDeparture {
  const plan = Array.isArray(r.trip_plans) ? r.trip_plans[0] : r.trip_plans;
  const rawTime = r.start_time == null ? '' : String(r.start_time).slice(0, 5);
  return {
    id: r.id,
    tripId: r.trip_id,
    planId: r.plan_id,
    planName: plan?.name ?? '',
    departsOn: r.departs_on,
    startTime: rawTime,
    capacity: r.capacity,
    seatsBooked: r.seats_booked ?? 0,
    status: r.status,
    note: r.note ?? '',
    /*
     * #41（18 分冊 §3）：成團狀態是**另一條軸**，不是 status 的別名。
     * 未知值一律收斂成 COLLECTING——「還在募集」是最保守的解讀，
     * 不會讓 UI 誤宣稱一團已經成立。
     */
    formationStatus: FORMATION_STATUS.has(r.formation_status) ? r.formation_status : 'COLLECTING',
    formationDeadlineAt: r.formation_deadline_at ?? null,
    minToDepartSnapshot: Number.isFinite(Number(r.min_to_depart_snapshot))
      ? Number(r.min_to_depart_snapshot) : 1,
    formedAt: r.formed_at ?? null,
    formedBy: r.formed_by === 'SYSTEM' || r.formed_by === 'GUIDE_OVERRIDE' ? r.formed_by : null,
    formedParticipants: r.formed_participants == null ? null : Number(r.formed_participants),
  };
}

/**
 * tour_orders 列 → `TourOrder`（#8-B）。
 *
 * 刻意**不**做 PostgREST embed：0067 為 tenant-aware 完整性加了複合 FK，
 * 於是 `tour_orders → trips` / `→ trip_plans` / `→ trip_departures` 的關聯在
 * canonical 與 historical overlay 兩種安裝路徑下解出來的 constraint 名稱不同，
 * embed hint 會在其中一邊解不開（PB-024）。呼叫端自己查再組，慢一點但兩邊都對。
 *
 * `derived` 的四個欄位都由呼叫端明確傳入而非 `?? ''` 猜——查不到就傳空字串，
 * 但那是呼叫端知道自己查不到，不是這裡假裝有值。
 */
export function mapTourOrder(r: any, derived: {
  tripTitle: string;
  planName: string;
  departsOn: string;
  startTime: string;
  paymentMethodLabel: string;
  /** #46：所屬方案的販售方式；查不到就是 undefined，不得猜一個值。 */
  salesMode?: 'FIXED_DEPARTURE' | 'INSTANT' | 'REQUEST';
}): TourOrder {
  const contact = (r.contact ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    orderNo: r.order_no,
    tripId: r.trip_id,
    tripTitle: derived.tripTitle,
    planName: derived.planName,
    departsOn: derived.departsOn,
    startTime: derived.startTime,
    customerName: String(contact.name ?? ''),
    customerPhone: String(contact.phone ?? ''),
    partySize: Number(r.party_size ?? 0),
    unitPrice: Number(r.unit_price ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
    depositAmount: Number(r.deposit_amount ?? 0),
    status: r.status,
    paymentStatus: TOUR_PAYMENT_STATUS.has(r.payment_status) ? r.payment_status : 'UNPAID',
    paymentMethodLabel: derived.paymentMethodLabel,
    paymentRef: r.payment_ref ?? '',
    source: r.source,
    holdExpiresAt: r.hold_expires_at ?? null,
    note: r.note ?? '',
    createdAt: r.created_at,
    /*
     * #41（18 分冊 §4）：新欄位的窄化一律取「最不會讓 UI 誤宣稱已收到錢／已退
     * 款」的那個值——寧可少顯示，不製造假的收款證據（同 9.3 的平台固定底線）。
     *   - upfrontRequiredAmount：查不到／不是有限數字時視為 0（沒有要求頭期款），
     *     不是想像一個數字出來。
     *   - refundedAmount：同理收斂成 0（沒有退款紀錄），不得因為欄位缺失就猜。
     *   - depositModeSnapshot：不在值域內（含 undefined/null/空字串/大小寫錯誤/
     *     未知值/數字）一律收斂成 null，代表「當時尚未補這個欄位」，不得亂猜成
     *     某個具體收款政策。
     */
    upfrontRequiredAmount: Number.isFinite(Number(r.upfront_required_amount))
      ? Number(r.upfront_required_amount) : 0,
    refundedAmount: Number.isFinite(Number(r.refunded_amount)) ? Number(r.refunded_amount) : 0,
    depositModeSnapshot: DEPOSIT_MODE_SNAPSHOT.has(r.deposit_mode_snapshot)
      ? r.deposit_mode_snapshot : null,
    salesMode: derived.salesMode,
    /**
     * #46：`refund_policy_snapshot` 由一支獨立的 migration PR 加在
     * `tour_orders` 上（本 PR 刻意不含任何 `supabase/migrations/**` 檔案，
     * 見 commit 說明——避免與同期並行的 migration PR 撞號，也避開
     * `schema-staged-release-policy.mjs` 對「migration + Product runtime
     * 同一 PR」的 default-off gate 要求）、`create_tour_order` 建單當下寫入。
     * 在該欄位真的存在之前，`r.refund_policy_snapshot` 永遠是 undefined，
     * 下面這行收斂成 null 是刻意的：值域外（含 null／undefined／未知字串）
     * 一律收斂成 null——同 `depositModeSnapshot` 的既有慣例，不得替一筆
     * 查不到 snapshot 的舊訂單（或欄位還沒上線）假造一個政策。畫面上顯示
     * 「政策未提供」，等 migration 合併並套用後自動補上真實值。
     */
    refundPolicySnapshot: REFUND_POLICY_VALUES.has(r.refund_policy_snapshot)
      ? r.refund_policy_snapshot : null,
  };
}

const REFUND_POLICY_VALUES = new Set(['STANDARD', 'FLEXIBLE', 'STRICT']);

export function mapTripAddon(r: any): TripAddon {
  return {
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    price: Number(r.price ?? 0),
    unit: r.unit,
    stock: r.stock == null ? null : Number(r.stock),
    active: r.active ?? true,
    sortOrder: r.sort_order ?? 0,
  };
}
