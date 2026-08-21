/**
 * Mock 資料 — 骨架模式（NEXT_PUBLIC_USE_MOCK=true）下所有頁面的資料來源。
 * 只有這一層知道假資料；service 層透過 adapt(mock, real) 決定要不要用它。
 * 換真實後端時，這個資料夾整包可以刪掉。
 */
import type {
  Booking, Customer, Service, Staff, Product, ProductOrder, Coupon,
  MembershipLevel, DashboardStats, DashboardAlerts, StaffPerformance,
  PointTransaction, TenantSummary, SetupStatus,
} from '@/lib/types';
import type { FeatureSubscription } from '@/config/features';

export const MOCK_USER = { id: 'u_1', name: '小威', email: 'owner@example.com' };

export const MOCK_TENANTS: TenantSummary[] = [
  { id: 't_1', shopCode: 'demo-guide', name: '祕島嚮導工作室', role: 'OWNER', current: true,
    businessType: 'GUIDE' },
  { id: 't_2', shopCode: 'demo-salon', name: '示範美髮沙龍', role: 'OWNER', current: false,
    businessType: 'LOCAL_SHOP' },
  { id: 't_3', shopCode: 'demo-clinic', name: '示範診所', role: 'MANAGER', current: false,
    businessType: 'CLINIC' },
];

export const MOCK_SIDEBAR_COUNTS: Record<string, number> = {
  pendingBookingBadge: 3,
  pendingOrderBadge: 2,
  unreadChatBadge: 5,
  pendingTourOrderBadge: 1,
};

export const MOCK_SETUP_STATUS: SetupStatus = {
  percent: 60,
  steps: [
    { key: 'SHOP_INFO', done: true },
    { key: 'STAFF', done: true },
    { key: 'SERVICE', done: true },
    { key: 'BUSINESS_HOURS', done: false },
    { key: 'LINE_BOT', done: false },
  ],
};

export const MOCK_DASHBOARD_STATS: DashboardStats = {
  todayBookings: 8,
  pendingBookings: 3,
  monthRevenue: 128400,
  totalCustomers: 246,
  pushQuotaUsed: 132,
  pushQuotaTotal: 200,
  linePlatformStatus: 'CONNECTED',
};

export const MOCK_DASHBOARD_ALERTS: DashboardAlerts = {
  unprocessedBookings: 2,
  lowStockProducts: 1,
  atRiskCustomers: 12,
  bookingCutoffPassed: false,
  bookingCutoffDate: null,
  pushQuotaExhausted: false,
  expiredFeatures: [],
  expiringFeatures: [{ code: 'COUPON_SYSTEM', expiresAt: '2026-08-28' }],
};

const iso = (dayOffset: number, h: number, m = 0) => {
  const d = new Date('2026-08-20T00:00:00+08:00');
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const MOCK_STAFF: Staff[] = [
  { id: 's_1', name: 'Amy', phone: '0912-345-678', email: 'amy@example.com', title: '資深設計師', avatarUrl: '', serviceIds: ['sv_1', 'sv_2'], bookable: true, active: true, sortOrder: 1 },
  { id: 's_2', name: 'Ben', phone: '0922-111-222', email: 'ben@example.com', title: '設計師', avatarUrl: '', serviceIds: ['sv_1', 'sv_3'], bookable: true, active: true, sortOrder: 2 },
  { id: 's_3', name: 'Cindy', phone: '0933-444-555', email: '', title: '助理', avatarUrl: '', serviceIds: ['sv_3'], bookable: false, active: true, sortOrder: 3 },
];

export const MOCK_SERVICES: Service[] = [
  { id: 'sv_1', categoryId: 'sc_1', categoryName: '剪髮', name: '精緻剪髮', description: '洗＋剪＋吹整', durationMinutes: 60, price: 600, imageUrl: '', active: true, lineFeatured: true, sortOrder: 1 },
  { id: 'sv_2', categoryId: 'sc_2', categoryName: '染燙', name: '全頭染髮', description: '含護髮', durationMinutes: 150, price: 2800, imageUrl: '', active: true, lineFeatured: true, sortOrder: 2 },
  { id: 'sv_3', categoryId: 'sc_3', categoryName: '護理', name: '深層護髮', description: '', durationMinutes: 45, price: 1200, imageUrl: '', active: true, lineFeatured: false, sortOrder: 3 },
  { id: 'sv_4', categoryId: 'sc_1', categoryName: '剪髮', name: '瀏海修剪', description: '', durationMinutes: 15, price: 150, imageUrl: '', active: false, lineFeatured: false, sortOrder: 4 },
];

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c_1', name: '王小明', phone: '0912-000-111', email: 'ming@example.com', gender: 'MALE', birthday: '1992-03-14', note: '偏好短髮', lineUserId: 'U123', lineDisplayName: 'Ming', membershipLevelId: 'ml_2', membershipLevelName: '金卡', tags: ['熟客'], bookingCount: 24, totalSpent: 38600, points: 386, lastVisitAt: iso(-6, 14), atRisk: false, active: true, createdAt: iso(-400, 10) },
  { id: 'c_2', name: '李美華', phone: '0922-333-444', email: '', gender: 'FEMALE', birthday: '1988-11-02', note: '', lineUserId: 'U456', lineDisplayName: '美華', membershipLevelId: 'ml_1', membershipLevelName: '一般會員', tags: [], bookingCount: 6, totalSpent: 9200, points: 92, lastVisitAt: iso(-45, 11), atRisk: true, active: true, createdAt: iso(-300, 9) },
  { id: 'c_3', name: '張大偉', phone: '0933-555-666', email: 'wei@example.com', gender: 'MALE', birthday: '', note: '對染劑過敏', lineUserId: null, lineDisplayName: null, membershipLevelId: 'ml_1', membershipLevelName: '一般會員', tags: ['過敏'], bookingCount: 2, totalSpent: 1800, points: 18, lastVisitAt: iso(-90, 16), atRisk: true, active: true, createdAt: iso(-120, 15) },
  { id: 'c_4', name: '陳雅婷', phone: '0955-777-888', email: '', gender: 'FEMALE', birthday: '1995-06-20', note: '', lineUserId: 'U789', lineDisplayName: 'Ting', membershipLevelId: 'ml_3', membershipLevelName: '鑽石卡', tags: ['VIP'], bookingCount: 52, totalSpent: 96400, points: 964, lastVisitAt: iso(-2, 13), atRisk: false, active: true, createdAt: iso(-700, 12) },
];

export const MOCK_BOOKINGS: Booking[] = [
  { id: 'b_1', bookingNo: 'BK20260820001', customerId: 'c_1', customerName: '王小明', customerPhone: '0912-000-111', serviceId: 'sv_1', serviceName: '精緻剪髮', staffId: 's_1', staffName: 'Amy', startAt: iso(0, 10), endAt: iso(0, 11), durationMinutes: 60, price: 600, finalPrice: 600, status: 'CONFIRMED', paymentStatus: 'UNPAID', source: 'LINE', note: '', createdAt: iso(-2, 9) },
  { id: 'b_2', bookingNo: 'BK20260820002', customerId: 'c_2', customerName: '李美華', customerPhone: '0922-333-444', serviceId: 'sv_2', serviceName: '全頭染髮', staffId: 's_1', staffName: 'Amy', startAt: iso(0, 13, 30), endAt: iso(0, 16), durationMinutes: 150, price: 2800, finalPrice: 2520, status: 'PENDING', paymentStatus: 'UNPAID', source: 'PUBLIC_PAGE', note: '想染霧棕色', createdAt: iso(-1, 20) },
  { id: 'b_3', bookingNo: 'BK20260819007', customerId: 'c_4', customerName: '陳雅婷', customerPhone: '0955-777-888', serviceId: 'sv_3', serviceName: '深層護髮', staffId: 's_2', staffName: 'Ben', startAt: iso(-1, 15), endAt: iso(-1, 15, 45), durationMinutes: 45, price: 1200, finalPrice: 1080, status: 'COMPLETED', paymentStatus: 'PAID_OFFLINE', source: 'MANUAL', note: '', createdAt: iso(-3, 11) },
  { id: 'b_4', bookingNo: 'BK20260821001', customerId: 'c_3', customerName: '張大偉', customerPhone: '0933-555-666', serviceId: 'sv_1', serviceName: '精緻剪髮', staffId: null, staffName: null, startAt: iso(1, 11), endAt: iso(1, 12), durationMinutes: 60, price: 600, finalPrice: 600, status: 'PENDING', paymentStatus: 'UNPAID', source: 'LINE', note: '', createdAt: iso(0, 8) },
  { id: 'b_5', bookingNo: 'BK20260818003', customerId: 'c_1', customerName: '王小明', customerPhone: '0912-000-111', serviceId: 'sv_1', serviceName: '精緻剪髮', staffId: 's_2', staffName: 'Ben', startAt: iso(-2, 17), endAt: iso(-2, 18), durationMinutes: 60, price: 600, finalPrice: 600, status: 'NO_SHOW', paymentStatus: 'UNPAID', source: 'LINE', note: '', createdAt: iso(-5, 14) },
  { id: 'b_6', bookingNo: 'BK20260817002', customerId: 'c_4', customerName: '陳雅婷', customerPhone: '0955-777-888', serviceId: 'sv_2', serviceName: '全頭染髮', staffId: 's_1', staffName: 'Amy', startAt: iso(-3, 9), endAt: iso(-3, 11, 30), durationMinutes: 150, price: 2800, finalPrice: 2800, status: 'CANCELLED', paymentStatus: 'UNPAID', source: 'PUBLIC_PAGE', note: '臨時有事', createdAt: iso(-6, 10) },
];

export const MOCK_MEMBERSHIP_LEVELS: MembershipLevel[] = [
  { id: 'ml_1', name: '一般會員', color: '#86868b', thresholdSpent: 0, discountPercent: 0, pointRateMultiplier: 1, customerCount: 180, sortOrder: 1 },
  { id: 'ml_2', name: '金卡', color: '#ff9f0a', thresholdSpent: 20000, discountPercent: 5, pointRateMultiplier: 1.5, customerCount: 48, sortOrder: 2 },
  { id: 'ml_3', name: '鑽石卡', color: '#4361ee', thresholdSpent: 60000, discountPercent: 10, pointRateMultiplier: 2, customerCount: 18, sortOrder: 3 },
];

export const MOCK_PRODUCTS: Product[] = [
  { id: 'p_1', categoryId: 'pc_1', categoryName: '洗護', name: '修護洗髮精 500ml', description: '受損髮專用', price: 880, stock: 24, safetyStock: 10, imageUrl: '', active: true, lineFeatured: true, sortOrder: 1 },
  { id: 'p_2', categoryId: 'pc_1', categoryName: '洗護', name: '護髮油 100ml', description: '', price: 1200, stock: 4, safetyStock: 8, imageUrl: '', active: true, lineFeatured: false, sortOrder: 2 },
  { id: 'p_3', categoryId: 'pc_2', categoryName: '造型', name: '定型噴霧', description: '', price: 520, stock: 40, safetyStock: 10, imageUrl: '', active: false, lineFeatured: false, sortOrder: 3 },
];

export const MOCK_PRODUCT_ORDERS: ProductOrder[] = [
  { id: 'po_1', orderNo: 'PO20260820001', customerId: 'c_1', customerName: '王小明', items: [{ productId: 'p_1', productName: '修護洗髮精 500ml', quantity: 1, price: 880 }], totalAmount: 880, status: 'PENDING', paymentStatus: 'UNPAID', createdAt: iso(0, 9) },
  { id: 'po_2', orderNo: 'PO20260819004', customerId: 'c_4', customerName: '陳雅婷', items: [{ productId: 'p_2', productName: '護髮油 100ml', quantity: 2, price: 1200 }], totalAmount: 2400, status: 'COMPLETED', paymentStatus: 'PAID_ONLINE', createdAt: iso(-1, 16) },
];

export const MOCK_COUPONS: Coupon[] = [
  { id: 'cp_1', name: '新客體驗 8 折', description: '首次到店適用', discountType: 'PERCENT', discountValue: 20, totalQuantity: 100, issuedQuantity: 62, redeemedQuantity: 31, startAt: iso(-30, 0), endAt: iso(30, 23), status: 'PUBLISHED' },
  { id: 'cp_2', name: '護髮折 200', description: '', discountType: 'AMOUNT', discountValue: 200, totalQuantity: 50, issuedQuantity: 50, redeemedQuantity: 44, startAt: iso(-60, 0), endAt: iso(-1, 23), status: 'EXPIRED' },
  { id: 'cp_3', name: '生日禮：免費瀏海修剪', description: '', discountType: 'GIFT', discountValue: 0, totalQuantity: 0, issuedQuantity: 12, redeemedQuantity: 5, startAt: iso(-10, 0), endAt: iso(90, 23), status: 'DRAFT' },
];

export const MOCK_STAFF_PERFORMANCE: StaffPerformance[] = [
  { staffId: 's_1', staffName: 'Amy', bookingCount: 62, completionRate: 94.2, revenue: 78600 },
  { staffId: 's_2', staffName: 'Ben', bookingCount: 41, completionRate: 90.1, revenue: 42300 },
  { staffId: 's_3', staffName: 'Cindy', bookingCount: 9, completionRate: 100, revenue: 7500 },
];

export const MOCK_POINT_BALANCE = 4820;

export const MOCK_POINT_TRANSACTIONS: PointTransaction[] = [
  { id: 'pt_1', type: 'CONSUME', amount: -30, balanceAfter: 4820, description: 'LINE 推播 30 則', createdAt: iso(0, 9) },
  { id: 'pt_2', type: 'TOPUP', amount: 5000, balanceAfter: 4850, description: '線上儲值', createdAt: iso(-5, 14) },
  { id: 'pt_3', type: 'TRANSFER_IN', amount: 500, balanceAfter: -150, description: '好友推薦獎勵', createdAt: iso(-20, 10) },
];

export const MOCK_FEATURES: FeatureSubscription[] = [
  { code: 'BASIC_REPORT', active: true, expiresAt: null },
  { code: 'MEMBERSHIP_SYSTEM', active: true, expiresAt: '2026-12-31' },
  { code: 'COUPON_SYSTEM', active: true, expiresAt: '2026-08-28' },
  { code: 'PRODUCT_SALES', active: true, expiresAt: '2026-12-31' },
  { code: 'INVENTORY', active: false, expiresAt: null },
  { code: 'KEYWORD_REPLY', active: true, expiresAt: '2026-12-31' },
  { code: 'AI_ASSISTANT', active: false, expiresAt: null },
  { code: 'PORTFOLIO_SHOWCASE', active: false, expiresAt: null },
  { code: 'CUSTOM_RICH_MENU', active: true, expiresAt: '2026-12-31' },
  { code: 'EXTRA_PUSH', active: false, expiresAt: null },
  { code: 'TOUR_MODULE', active: true, expiresAt: null },
];
