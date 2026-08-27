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
  BookingAddon,
  BookingAddonNotifyOutcome,
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
  Trip,
  TripPlan,
  TripPlanSeason,
  TripFaqItem,
  TripSocialProofQuote,
  TripPlanItineraryStep,
  TripDeparture,
  TripAddon,
  TourOrder,
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
    /*
     * issue #35：三個欄位以前是 bookings 頁的頁內常數（BOOKING_EXTRAS_*）。
     * `?? null` 而**不是** `?? 0`：`null` 是「沒有紀錄」，0 是「折抵了 0 元」，
     * 兩者在畫面上是不同的答案（CLAUDE.md「Never fabricate a known」）。
     */
    couponDiscount: r.coupon_discount == null ? null : Number(r.coupon_discount),
    pointsRedeemed: r.points_redeemed == null ? null : Number(r.points_redeemed),
    customerPoints: r.customer_points == null ? null : Number(r.customer_points),
  };
}

/**
 * 預約加購明細（`booking_addons`，migration 0020；04 分冊 §B-1.1）。
 * 來源：booking_addons + 巢狀 join `staff(name)`。巢狀 join 在無 Database 型別
 * 時被靜態推成陣列、實際為多對一物件（同 apply-coupon/route.ts 的說明），
 * 這裡收 `any` 直接取用。
 *
 * 放在 mappers.ts 而不是 route 檔內：Next.js route 檔只能 export HTTP method
 * （build 會驗證匯出形狀），而 GET/POST 與 DELETE 兩支路由都要用同一個 mapper。
 */
export function mapBookingAddon(r: any): BookingAddon {
  return {
    id: r.id,
    serviceId: r.service_id,
    name: r.name,
    price: Number(r.price),
    quantity: Number(r.quantity),
    durationMinutes: Number(r.duration_minutes),
    staffId: r.staff_id,
    staffName: r.staff?.name ?? null,
    appliedAmount: Number(r.applied_amount),
    appliedMinutes: Number(r.applied_minutes),
    notified: r.notified as BookingAddonNotifyOutcome,
    createdAt: r.created_at,
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
    // 0017 新增；查詢未取這一欄時維持 undefined（不補 0 假裝有排序）
    lineSortOrder: r.line_sort_order,
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
    // 0017 新增；查詢未取這一欄時維持 undefined（不補 0 假裝有排序）
    lineSortOrder: r.line_sort_order,
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
    // migration 0027：null = 沒有折抵紀錄，不轉成 0（0 會被讀成「折抵了 0 元」）
    couponDiscount: r.coupon_discount == null ? null : Number(r.coupon_discount),
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
    /* --- migration 0022（issue #35）--- */
    minOrderAmount: r.min_order_amount == null ? null : Number(r.min_order_amount),
    maxDiscountAmount: r.max_discount_amount == null ? null : Number(r.max_discount_amount),
    giftItem: r.gift_item ?? '',
    limitPerCustomer: r.limit_per_customer == null ? null : Number(r.limit_per_customer),
    privateMode: r.private_mode ?? false,
    /** 由 route 依 coupon_instances 算出後附掛；沒有已核銷實例 → null */
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
    /* --- migration 0022（issue #35）--- */
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

/* -------------------------------------------------------------------------- *
 * 行程領域（Phase 8a，migration 0016）                                        *
 * -------------------------------------------------------------------------- */

/** jsonb 陣列欄位防呆：DB 若存了非陣列（不該發生）也不要讓整頁掛掉。 */
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * trips 列 → Trip。
 *
 * `planCount` / `minPrice` / `upcomingDepartureCount` 是衍生欄位，不在 trips 表上，
 * 一律由查詢端聚合後以第二參數傳進來（planCount/minPrice 走 join trip_plans，
 * upcomingDepartureCount 走 join trip_departures，migration 0026 起可用）。
 *
 * ⚠️ 沒傳第二參數時三者都是 0。這在「剛建立的行程」是正確答案（真的是 0），
 * 但在**列表查詢忘了 join** 時會變成一個看起來合理的假數字。所以
 * `GET /api/trips` 與 `GET /api/trips/[id]` 一定要帶著聚合結果呼叫，
 * 新增其他呼叫端時同理。
 */
export function mapTrip(
  r: any,
  derived: { planCount?: number; minPrice?: number; upcomingDepartureCount?: number } = {},
): Trip {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    tagline: r.tagline ?? '',
    summary: r.summary ?? '',
    description: r.description ?? '',
    region: r.region ?? '',
    category: r.category ?? '',
    coverImageUrl: r.cover_image_url ?? '',
    galleryUrls: arr<string>(r.gallery),
    meetingPoint: r.meeting_point ?? '',
    meetingPointMapUrl: r.meeting_point_map_url ?? '',
    inclusions: arr<string>(r.inclusions),
    exclusions: arr<string>(r.exclusions),
    notices: arr<string>(r.notices),
    safetyNotice: r.safety_notice ?? '',
    refundPolicyType: r.refund_policy_type ?? 'STANDARD',
    status: r.status,
    midaoListing: r.midao_listing ?? 'NONE',
    midaoListingNote: r.midao_listing_note ?? '',
    planCount: derived.planCount ?? 0,
    upcomingDepartureCount: derived.upcomingDepartureCount ?? 0,
    minPrice: derived.minPrice ?? 0,
    updatedAt: r.updated_at,
    goodFor: arr<string>(r.good_for),
    faq: arr<TripFaqItem>(r.faq),
    socialProofQuotes: arr<TripSocialProofQuote>(r.social_proof_quotes),
    durationMinutes: r.duration_minutes ?? undefined,
    refundRules: arr<string>(r.refund_rules),
  };
}

/** trip_plans 列 → TripPlan。 */
export function mapTripPlan(r: any): TripPlan {
  return {
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    description: r.description ?? '',
    durationMinutes: r.duration_minutes ?? 60,
    priceType: r.price_type ?? 'PER_PERSON',
    basePrice: Number(r.base_price ?? 0),
    childPrice: r.child_price === null || r.child_price === undefined ? null : Number(r.child_price),
    minParticipants: r.min_participants ?? 1,
    maxParticipants: r.max_participants ?? 10,
    bookingType: r.booking_type ?? 'SCHEDULED',
    depositMode: r.deposit_mode ?? 'FULL',
    depositValue: Number(r.deposit_value ?? 0),
    active: r.active ?? true,
    yearRound: r.year_round ?? true,
    seasons: arr<TripPlanSeason>(r.seasons),
    reviewState: r.review_state ?? 'NONE',
    reviewNote: r.review_note ?? '',
    sortOrder: r.sort_order ?? 0,
    slug: r.slug || undefined,
    highlights: arr<string>(r.highlights),
    planInclusions: arr<string>(r.plan_inclusions),
    planExclusions: arr<string>(r.plan_exclusions),
    planNotices: arr<string>(r.plan_notices),
    planRefundRules: arr<string>(r.plan_refund_rules),
    planItinerary: arr<TripPlanItineraryStep>(r.plan_itinerary),
    meetingPointName: r.meeting_point_name || undefined,
    meetingAddress: r.meeting_address || undefined,
    experiencePointName: r.experience_point_name || undefined,
    experienceAddress: r.experience_address || undefined,
    language: r.language || undefined,
    earliestDeparture: r.earliest_departure ?? undefined,
    confirmByDays: r.confirm_by_days ?? undefined,
    freeCancelDays: r.free_cancel_days ?? undefined,
    detailsLinkText: r.details_link_text || undefined,
    bookingBtnText: r.booking_btn_text || undefined,
  };
}

/**
 * trip_departures 列 → TripDeparture（migration 0026）。
 *
 * `planName` 不在 trip_departures 表上，靠查詢端 join `trip_plans(name)` 帶回；
 * 沒 join 到就是空字串——**不是**猜一個名字填上去。
 * `startTime` 是 `time` 欄位（可為 null）：Postgres 回 `HH:MM:SS`，前端表單用
 * `HH:MM`，這裡切到 5 碼；null → `''`（TripDeparture.startTime 宣告為非 null
 * string，「未指定時間」在 UI 就是留白，10 分冊 §5.5 稱之為「整日忙碌」）。
 */
export function mapTripDeparture(r: any): TripDeparture {
  const planName = r.trip_plans?.name ?? r.plan_name ?? '';
  return {
    id: r.id,
    tripId: r.trip_id,
    planId: r.plan_id,
    planName,
    departsOn: r.departs_on,
    startTime: typeof r.start_time === 'string' ? r.start_time.slice(0, 5) : '',
    capacity: Number(r.capacity ?? 0),
    seatsBooked: Number(r.seats_booked ?? 0),
    status: r.status,
    note: r.note ?? '',
  };
}

/** trip_addons 列 → TripAddon（migration 0026）。`stock: null` = 不限量，保留 null。 */
export function mapTripAddon(r: any): TripAddon {
  return {
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    price: Number(r.price ?? 0),
    unit: r.unit ?? 'PER_PERSON',
    stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
    active: r.active ?? true,
    sortOrder: r.sort_order ?? 0,
  };
}

/**
 * tour_orders 列 → TourOrder（migration 0026）。
 *
 * ⚠️ `paymentMethodLabel` 恆為空字串，這是**誠實的未知**而不是漏寫：
 * 收款方式的顯示名稱只能來自 `tenant_payment_methods`，那張表屬 10 分冊 §4
 * （Phase 8c / issue #9），現在不存在。編一個名字填進去會讓畫面在真金額旁邊
 * 顯示一個沒有來源的字串（CLAUDE.md「Never fabricate a known」）。
 * #9 建表後，這裡改成 join 該表的 display_name。
 *
 * `tripTitle` / `planName` / `departsOn` / `startTime` 同樣靠查詢端 join 帶回，
 * 沒 join 到就留白。
 */
export function mapTourOrder(r: any): TourOrder {
  const startTime = r.trip_departures?.start_time ?? r.start_time ?? null;
  return {
    id: r.id,
    orderNo: r.order_no,
    tripId: r.trip_id,
    tripTitle: r.trips?.title ?? r.trip_title ?? '',
    planName: r.trip_plans?.name ?? r.plan_name ?? '',
    departsOn: r.trip_departures?.departs_on ?? r.departs_on ?? '',
    startTime: typeof startTime === 'string' ? startTime.slice(0, 5) : '',
    customerName: r.customer_name ?? '',
    customerPhone: r.customer_phone ?? '',
    partySize: Number(r.party_size ?? 0),
    unitPrice: Number(r.unit_price ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
    depositAmount: Number(r.deposit_amount ?? 0),
    status: r.status,
    paymentStatus: r.payment_status,
    paymentMethodLabel: '',
    paymentRef: r.payment_ref ?? '',
    source: r.source,
    holdExpiresAt: r.hold_expires_at ?? null,
    note: r.note ?? '',
    createdAt: r.created_at,
  };
}
