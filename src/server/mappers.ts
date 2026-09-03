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
  Trip,
  TripAddon,
  TripDeparture,
  TripPlan,
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
    tagline: '',
    summary: r.summary ?? '',
    description: r.description ?? '',
    region: r.location ?? '',
    category: '',
    coverImageUrl: r.cover_image_url ?? '',
    galleryUrls: Array.isArray(r.gallery) ? r.gallery.map(String) : [],
    meetingPoint: r.meeting_point ?? '',
    meetingPointMapUrl: '',
    inclusions: typeof r.includes === 'string'
      ? r.includes.split('\n').map((v: string) => v.trim()).filter(Boolean)
      : [],
    exclusions: [],
    notices: [],
    safetyNotice: r.notes ?? r.safety_notice ?? '',
    refundPolicyType: 'STANDARD',
    status: r.status,
    midaoListing: r.midao_listing,
    midaoListingNote: r.midao_listing_note ?? '',
    planCount: derived.planCount ?? 0,
    upcomingDepartureCount: derived.upcomingDepartureCount ?? 0,
    minPrice: derived.minPrice ?? 0,
    updatedAt: r.updated_at,
  };
}

export function mapTripPlan(r: any): TripPlan {
  return {
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    description: r.description ?? '',
    durationMinutes: 60,
    priceType: 'PER_PERSON',
    basePrice: Number(r.price_per_person ?? 0),
    childPrice: r.child_price == null ? null : Number(r.child_price),
    minParticipants: r.min_party ?? 1,
    maxParticipants: r.max_party ?? 10,
    bookingType: 'SCHEDULED',
    depositMode: r.deposit_mode,
    depositValue: Number(r.deposit_value ?? 0),
    active: r.active ?? true,
    yearRound: true,
    seasons: [],
    reviewState: 'NONE',
    reviewNote: '',
    sortOrder: r.sort_order ?? 0,
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
  };
}

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
