/**
 * Mock 資料 — 骨架模式（NEXT_PUBLIC_USE_MOCK=true）下所有頁面的資料來源。
 * 只有這一層知道假資料；service 層透過 adapt(mock, real) 決定要不要用它。
 * 換真實後端時，這個資料夾整包可以刪掉。
 *
 * ★ 業態模式（13 分冊）：同一份骨架要能展示三種店家，因此資料依
 *   businessType 分成三套。AppShell 在切換店家時呼叫 applyMockMode()，
 *   下面的 `export let` 是 ES module live binding —— 呼叫端（services / 頁面）
 *   在函式內讀取時就會拿到當前模式的資料，**不需要改任何呼叫端**。
 */
import type {
  Booking, Customer, Service, Staff, Product, ProductOrder, Coupon,
  MembershipLevel, DashboardStats, DashboardAlerts, StaffPerformance,
  PointTransaction, TenantSummary, SetupStatus,
} from '@/lib/types';
import type { FeatureSubscription } from '@/config/features';
import type { BusinessType } from '@/config/modes';

export const MOCK_USER = { id: 'u_1', name: '小威', email: 'owner@example.com' };

export const MOCK_TENANTS: TenantSummary[] = [
  { id: 't_1', shopCode: 'demo-guide', name: '祕島嚮導工作室', role: 'OWNER', current: true,
    businessType: 'GUIDE' },
  { id: 't_2', shopCode: 'demo-salon', name: '示範美髮沙龍', role: 'OWNER', current: false,
    businessType: 'LOCAL_SHOP' },
  { id: 't_3', shopCode: 'demo-clinic', name: '示範診所', role: 'MANAGER', current: false,
    businessType: 'CLINIC' },
];

const iso = (dayOffset: number, h: number, m = 0) => {
  const d = new Date('2026-08-20T00:00:00+08:00');
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/* ==========================================================================
   三套模式資料
   ========================================================================== */

type ModeDataset = {
  sidebarCounts: Record<string, number>;
  setupStatus: SetupStatus;
  dashboardStats: DashboardStats;
  dashboardAlerts: DashboardAlerts;
  staff: Staff[];
  services: Service[];
  customers: Customer[];
  bookings: Booking[];
  membershipLevels: MembershipLevel[];
  products: Product[];
  productOrders: ProductOrder[];
  coupons: Coupon[];
  staffPerformance: StaffPerformance[];
  pointBalance: number;
  pointTransactions: PointTransaction[];
  features: FeatureSubscription[];
};

/* ------------------------------------------------------- 🏪 當地商店（沙龍） */
const LOCAL_SHOP: ModeDataset = {
  sidebarCounts: { pendingBookingBadge: 3, pendingOrderBadge: 2, unreadChatBadge: 5 },
  setupStatus: {
    percent: 60,
    steps: [
      { key: 'SHOP_INFO', done: true }, { key: 'STAFF', done: true },
      { key: 'SERVICE', done: true }, { key: 'BUSINESS_HOURS', done: false },
      { key: 'LINE_BOT', done: false },
    ],
  },
  dashboardStats: {
    todayBookings: 8, pendingBookings: 3, monthRevenue: 128400, totalCustomers: 246,
    pushQuotaUsed: 132, pushQuotaTotal: 200, linePlatformStatus: 'CONNECTED',
  },
  dashboardAlerts: {
    unprocessedBookings: 2, lowStockProducts: 1, atRiskCustomers: 12,
    bookingCutoffPassed: false, bookingCutoffDate: null, pushQuotaExhausted: false,
    expiredFeatures: [], expiringFeatures: [{ code: 'COUPON_SYSTEM', expiresAt: '2026-08-28' }],
  },
  staff: [
    { id: 's_1', name: 'Amy', phone: '0912-345-678', email: 'amy@example.com', title: '資深設計師', avatarUrl: '', serviceIds: ['sv_1', 'sv_2'], bookable: true, active: true, sortOrder: 1 },
    { id: 's_2', name: 'Ben', phone: '0922-111-222', email: 'ben@example.com', title: '設計師', avatarUrl: '', serviceIds: ['sv_1', 'sv_3'], bookable: true, active: true, sortOrder: 2 },
    { id: 's_3', name: 'Cindy', phone: '0933-444-555', email: '', title: '助理', avatarUrl: '', serviceIds: ['sv_3'], bookable: false, active: true, sortOrder: 3 },
  ],
  services: [
    { id: 'sv_1', categoryId: 'sc_1', categoryName: '剪髮', name: '精緻剪髮', description: '洗＋剪＋吹整', durationMinutes: 60, price: 600, imageUrl: '', active: true, lineFeatured: true, sortOrder: 1 },
    { id: 'sv_2', categoryId: 'sc_2', categoryName: '染燙', name: '全頭染髮', description: '含護髮', durationMinutes: 150, price: 2800, imageUrl: '', active: true, lineFeatured: true, sortOrder: 2 },
    { id: 'sv_3', categoryId: 'sc_3', categoryName: '護理', name: '深層護髮', description: '', durationMinutes: 45, price: 1200, imageUrl: '', active: true, lineFeatured: false, sortOrder: 3 },
    { id: 'sv_4', categoryId: 'sc_1', categoryName: '剪髮', name: '瀏海修剪', description: '', durationMinutes: 15, price: 150, imageUrl: '', active: false, lineFeatured: false, sortOrder: 4 },
  ],
  customers: [
    { id: 'c_1', name: '王小明', phone: '0912-000-111', email: 'ming@example.com', gender: 'MALE', birthday: '1992-03-14', note: '偏好短髮', lineUserId: 'U123', lineDisplayName: 'Ming', membershipLevelId: 'ml_2', membershipLevelName: '金卡', tags: ['熟客'], bookingCount: 24, totalSpent: 38600, points: 386, lastVisitAt: iso(-6, 14), atRisk: false, active: true, createdAt: iso(-400, 10) },
    { id: 'c_2', name: '李美華', phone: '0922-333-444', email: '', gender: 'FEMALE', birthday: '1988-11-02', note: '', lineUserId: 'U456', lineDisplayName: '美華', membershipLevelId: 'ml_1', membershipLevelName: '一般會員', tags: [], bookingCount: 6, totalSpent: 9200, points: 92, lastVisitAt: iso(-45, 11), atRisk: true, active: true, createdAt: iso(-300, 9) },
    { id: 'c_3', name: '張大偉', phone: '0933-555-666', email: 'wei@example.com', gender: 'MALE', birthday: '', note: '對染劑過敏', lineUserId: null, lineDisplayName: null, membershipLevelId: 'ml_1', membershipLevelName: '一般會員', tags: ['過敏'], bookingCount: 2, totalSpent: 1800, points: 18, lastVisitAt: iso(-90, 16), atRisk: true, active: true, createdAt: iso(-120, 15) },
    { id: 'c_4', name: '陳雅婷', phone: '0955-777-888', email: '', gender: 'FEMALE', birthday: '1995-06-20', note: '', lineUserId: 'U789', lineDisplayName: 'Ting', membershipLevelId: 'ml_3', membershipLevelName: '鑽石卡', tags: ['VIP'], bookingCount: 52, totalSpent: 96400, points: 964, lastVisitAt: iso(-2, 13), atRisk: false, active: true, createdAt: iso(-700, 12) },
  ],
  bookings: [
    { id: 'b_1', bookingNo: 'BK20260820001', customerId: 'c_1', customerName: '王小明', customerPhone: '0912-000-111', serviceId: 'sv_1', serviceName: '精緻剪髮', staffId: 's_1', staffName: 'Amy', startAt: iso(0, 10), endAt: iso(0, 11), durationMinutes: 60, price: 600, finalPrice: 600, status: 'CONFIRMED', paymentStatus: 'UNPAID', source: 'LINE', note: '', createdAt: iso(-2, 9), customerPoints: 386 },
    { id: 'b_2', bookingNo: 'BK20260820002', customerId: 'c_2', customerName: '李美華', customerPhone: '0922-333-444', serviceId: 'sv_2', serviceName: '全頭染髮', staffId: 's_1', staffName: 'Amy', startAt: iso(0, 13, 30), endAt: iso(0, 16), durationMinutes: 150, price: 2800, finalPrice: 2520, status: 'PENDING', paymentStatus: 'UNPAID', source: 'PUBLIC_PAGE', note: '想染霧棕色', createdAt: iso(-1, 20), customerPoints: 92 },
    { id: 'b_3', bookingNo: 'BK20260819007', customerId: 'c_4', customerName: '陳雅婷', customerPhone: '0955-777-888', serviceId: 'sv_3', serviceName: '深層護髮', staffId: 's_2', staffName: 'Ben', startAt: iso(-1, 15), endAt: iso(-1, 15, 45), durationMinutes: 45, price: 1200, finalPrice: 1080, status: 'COMPLETED', paymentStatus: 'PAID_OFFLINE', source: 'MANUAL', note: '', createdAt: iso(-3, 11), customerPoints: 964 },
    { id: 'b_4', bookingNo: 'BK20260821001', customerId: 'c_3', customerName: '張大偉', customerPhone: '0933-555-666', serviceId: 'sv_1', serviceName: '精緻剪髮', staffId: null, staffName: null, startAt: iso(1, 11), endAt: iso(1, 12), durationMinutes: 60, price: 600, finalPrice: 600, status: 'PENDING', paymentStatus: 'UNPAID', source: 'LINE', note: '', createdAt: iso(0, 8), customerPoints: 18 },
    { id: 'b_5', bookingNo: 'BK20260818003', customerId: 'c_1', customerName: '王小明', customerPhone: '0912-000-111', serviceId: 'sv_1', serviceName: '精緻剪髮', staffId: 's_2', staffName: 'Ben', startAt: iso(-2, 17), endAt: iso(-2, 18), durationMinutes: 60, price: 600, finalPrice: 600, status: 'NO_SHOW', paymentStatus: 'UNPAID', source: 'LINE', note: '', createdAt: iso(-5, 14), customerPoints: 386 },
    { id: 'b_6', bookingNo: 'BK20260817002', customerId: 'c_4', customerName: '陳雅婷', customerPhone: '0955-777-888', serviceId: 'sv_2', serviceName: '全頭染髮', staffId: 's_1', staffName: 'Amy', startAt: iso(-3, 9), endAt: iso(-3, 11, 30), durationMinutes: 150, price: 2800, finalPrice: 2800, status: 'CANCELLED', paymentStatus: 'UNPAID', source: 'PUBLIC_PAGE', note: '臨時有事', createdAt: iso(-6, 10), customerPoints: 964 },
  ],
  membershipLevels: [
    { id: 'ml_1', name: '一般會員', color: '#86868b', thresholdSpent: 0, discountPercent: 0, pointRateMultiplier: 1, customerCount: 180, sortOrder: 1, description: '所有新顧客的預設等級', active: true, isDefault: true },
    { id: 'ml_2', name: '金卡', color: '#ff9f0a', thresholdSpent: 20000, discountPercent: 5, pointRateMultiplier: 1.5, customerCount: 48, sortOrder: 2, description: '生日當月贈送護髮體驗一次', active: true, isDefault: false },
    { id: 'ml_3', name: '鑽石卡', color: '#4361ee', thresholdSpent: 60000, discountPercent: 10, pointRateMultiplier: 2, customerCount: 18, sortOrder: 3, description: '專屬設計師優先排程、免費造型諮詢', active: true, isDefault: false },
  ],
  products: [
    { id: 'p_1', categoryId: 'pc_1', categoryName: '洗護', name: '修護洗髮精 500ml', description: '受損髮專用', price: 880, stock: 24, safetyStock: 10, imageUrl: '', active: true, lineFeatured: true, sortOrder: 1 },
    { id: 'p_2', categoryId: 'pc_1', categoryName: '洗護', name: '護髮油 100ml', description: '', price: 1200, stock: 4, safetyStock: 8, imageUrl: '', active: true, lineFeatured: false, sortOrder: 2 },
    { id: 'p_3', categoryId: 'pc_2', categoryName: '造型', name: '定型噴霧', description: '', price: 520, stock: 40, safetyStock: 10, imageUrl: '', active: false, lineFeatured: false, sortOrder: 3 },
  ],
  productOrders: [
    { id: 'po_1', orderNo: 'PO20260820001', customerId: 'c_1', customerName: '王小明', items: [{ productId: 'p_1', productName: '修護洗髮精 500ml', quantity: 1, price: 880 }], totalAmount: 880, status: 'PENDING', paymentStatus: 'UNPAID', createdAt: iso(0, 9) },
    { id: 'po_2', orderNo: 'PO20260819004', customerId: 'c_4', customerName: '陳雅婷', items: [{ productId: 'p_2', productName: '護髮油 100ml', quantity: 2, price: 1200 }], totalAmount: 2400, status: 'COMPLETED', paymentStatus: 'PAID_ONLINE', createdAt: iso(-1, 16) },
  ],
  coupons: [
    { id: 'cp_1', name: '新客體驗 8 折', description: '首次到店適用', discountType: 'PERCENT', discountValue: 20, totalQuantity: 100, issuedQuantity: 62, redeemedQuantity: 31, startAt: iso(-30, 0), endAt: iso(30, 23), status: 'PUBLISHED', minOrderAmount: null, maxDiscountAmount: 500, giftItem: '', limitPerCustomer: 1, privateMode: false, lastRedeemedCode: 'ABC12345' },
    { id: 'cp_2', name: '護髮折 200', description: '', discountType: 'AMOUNT', discountValue: 200, totalQuantity: 50, issuedQuantity: 50, redeemedQuantity: 44, startAt: iso(-60, 0), endAt: iso(-1, 23), status: 'EXPIRED', minOrderAmount: 1000, maxDiscountAmount: null, giftItem: '', limitPerCustomer: 2, privateMode: false, lastRedeemedCode: 'XYZ98765' },
    { id: 'cp_3', name: '生日禮：免費瀏海修剪', description: '', discountType: 'GIFT', discountValue: 0, totalQuantity: 0, issuedQuantity: 12, redeemedQuantity: 5, startAt: iso(-10, 0), endAt: iso(90, 23), status: 'DRAFT', minOrderAmount: null, maxDiscountAmount: null, giftItem: '免費瀏海修剪', limitPerCustomer: null, privateMode: true, lastRedeemedCode: null },
  ],
  staffPerformance: [
    { staffId: 's_1', staffName: 'Amy', bookingCount: 62, completionRate: 94.2, revenue: 78600 },
    { staffId: 's_2', staffName: 'Ben', bookingCount: 41, completionRate: 90.1, revenue: 42300 },
    { staffId: 's_3', staffName: 'Cindy', bookingCount: 9, completionRate: 100, revenue: 7500 },
  ],
  pointBalance: 4820,
  pointTransactions: [
    { id: 'pt_1', type: 'CONSUME', amount: -30, balanceAfter: 4820, description: 'LINE 推播 30 則', createdAt: iso(0, 9) },
    { id: 'pt_2', type: 'TOPUP', amount: 5000, balanceAfter: 4850, description: '線上儲值', createdAt: iso(-5, 14) },
    { id: 'pt_3', type: 'TRANSFER_IN', amount: 500, balanceAfter: -150, description: '好友推薦獎勵', createdAt: iso(-20, 10) },
  ],
  features: [
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
    { code: 'TOUR_MODULE', active: false, expiresAt: null },
  ],
};

/* ------------------------------------------------------------ 🧭 嚮導工作室 */
const GUIDE: ModeDataset = {
  sidebarCounts: { pendingTourOrderBadge: 1, pendingOrderBadge: 2, unreadChatBadge: 5 },
  setupStatus: {
    percent: 80,
    steps: [
      { key: 'SHOP_INFO', done: true }, { key: 'STAFF', done: true },
      { key: 'SERVICE', done: true }, { key: 'BUSINESS_HOURS', done: true },
      { key: 'LINE_BOT', done: false },
    ],
  },
  dashboardStats: {
    todayBookings: 3, pendingBookings: 1, monthRevenue: 268900, totalCustomers: 412,
    pushQuotaUsed: 168, pushQuotaTotal: 200, linePlatformStatus: 'CONNECTED',
  },
  dashboardAlerts: {
    unprocessedBookings: 1, lowStockProducts: 1, atRiskCustomers: 23,
    bookingCutoffPassed: false, bookingCutoffDate: null, pushQuotaExhausted: false,
    expiredFeatures: [], expiringFeatures: [],
  },
  staff: [
    { id: 's_1', name: '阿海', phone: '0911-208-664', email: 'hai@example.com', title: '海域嚮導 · PADI 潛水長', avatarUrl: '', serviceIds: [], bookable: true, active: true, sortOrder: 1 },
    { id: 's_2', name: '小雨', phone: '0922-118-903', email: 'rain@example.com', title: '山域嚮導 · 高山嚮導證', avatarUrl: '', serviceIds: [], bookable: true, active: true, sortOrder: 2 },
    { id: 's_3', name: '老陳', phone: '0933-702-889', email: '', title: '船長', avatarUrl: '', serviceIds: [], bookable: false, active: true, sortOrder: 3 },
    { id: 's_4', name: 'Kai', phone: '0955-620-114', email: 'kai@example.com', title: '攝影嚮導', avatarUrl: '', serviceIds: [], bookable: true, active: true, sortOrder: 4 },
  ],
  // 嚮導模式看不到服務項目（modes.ts 隱藏），保留最小資料以防直接開網址
  services: [
    { id: 'sv_g1', categoryId: null, categoryName: null, name: '客製包團諮詢', description: '一對一討論行程規劃', durationMinutes: 30, price: 0, imageUrl: '', active: true, lineFeatured: false, sortOrder: 1 },
  ],
  customers: [
    { id: 'c_1', name: '陳彥廷', phone: '0912-345-678', email: 'yenting@example.com', gender: 'MALE', birthday: '1990-07-08', note: '會暈船，需提前備藥', lineUserId: 'U901', lineDisplayName: '彥廷', membershipLevelId: 'ml_2', membershipLevelName: '常客旅人', tags: ['賞鯨'], bookingCount: 7, totalSpent: 21400, points: 214, lastVisitAt: iso(-12, 9), atRisk: false, active: true, createdAt: iso(-380, 10) },
    { id: 'c_2', name: '林巧薇', phone: '0922-118-903', email: 'wei@example.com', gender: 'FEMALE', birthday: '1994-02-19', note: '素食', lineUserId: 'U902', lineDisplayName: 'Vivi', membershipLevelId: 'ml_3', membershipLevelName: '祕島之友', tags: ['VIP', '溯溪'], bookingCount: 19, totalSpent: 78600, points: 786, lastVisitAt: iso(-3, 9), atRisk: false, active: true, createdAt: iso(-620, 11) },
    { id: 'c_3', name: '吳孟儒', phone: '0955-620-114', email: '', gender: 'MALE', birthday: '', note: '攝影愛好者，常帶長焦', lineUserId: 'U903', lineDisplayName: '孟儒', membershipLevelId: 'ml_1', membershipLevelName: '一般旅人', tags: ['攝影'], bookingCount: 3, totalSpent: 7440, points: 74, lastVisitAt: iso(-70, 16), atRisk: true, active: true, createdAt: iso(-200, 14) },
    { id: 'c_4', name: '黃思穎', phone: '0987-441-256', email: 'ying@example.com', gender: 'FEMALE', birthday: '1998-10-30', note: '第一次溯溪', lineUserId: null, lineDisplayName: null, membershipLevelId: 'ml_1', membershipLevelName: '一般旅人', tags: ['新客'], bookingCount: 1, totalSpent: 11000, points: 110, lastVisitAt: iso(-1, 8), atRisk: false, active: true, createdAt: iso(-14, 11) },
    { id: 'c_5', name: '張家豪', phone: '0933-702-889', email: 'hao@example.com', gender: 'MALE', birthday: '1985-05-05', note: '公司員工旅遊窗口，需統編', lineUserId: 'U905', lineDisplayName: '家豪', membershipLevelId: 'ml_3', membershipLevelName: '祕島之友', tags: ['團體', '企業'], bookingCount: 11, totalSpent: 132000, points: 1320, lastVisitAt: iso(-2, 9), atRisk: false, active: true, createdAt: iso(-500, 9) },
  ],
  // 嚮導的「預約」是旅遊訂單（見 src/mock/tours.ts）；此處保留少量包團諮詢
  bookings: [
    { id: 'b_g1', bookingNo: 'BK20260821005', customerId: 'c_5', customerName: '張家豪', customerPhone: '0933-702-889', serviceId: 'sv_g1', serviceName: '客製包團諮詢', staffId: 's_2', staffName: '小雨', startAt: iso(1, 15), endAt: iso(1, 15, 30), durationMinutes: 30, price: 0, finalPrice: 0, status: 'PENDING', paymentStatus: 'UNPAID', source: 'LINE', note: '想規劃三天兩夜花東行程', createdAt: iso(0, 10), customerPoints: 1320 },
  ],
  membershipLevels: [
    { id: 'ml_1', name: '一般旅人', color: '#86868b', thresholdSpent: 0, discountPercent: 0, pointRateMultiplier: 1, customerCount: 320, sortOrder: 1, description: '所有新旅客的預設等級', active: true, isDefault: true },
    { id: 'ml_2', name: '常客旅人', color: '#0a84ff', thresholdSpent: 15000, discountPercent: 5, pointRateMultiplier: 1.5, customerCount: 72, sortOrder: 2, description: '生日當月贈送裝備租借券一張', active: true, isDefault: false },
    { id: 'ml_3', name: '祕島之友', color: '#30d158', thresholdSpent: 50000, discountPercent: 12, pointRateMultiplier: 2, customerCount: 20, sortOrder: 3, description: '揪團優先候補、免費裝備升級', active: true, isDefault: false },
  ],
  products: [
    { id: 'p_1', categoryId: 'pc_1', categoryName: '裝備', name: '防水袋 20L', description: '溯溪、獨木舟適用', price: 680, stock: 18, safetyStock: 6, imageUrl: '', active: true, lineFeatured: true, sortOrder: 1 },
    { id: 'p_2', categoryId: 'pc_1', categoryName: '裝備', name: '寬簷防曬帽', description: '', price: 480, stock: 3, safetyStock: 8, imageUrl: '', active: true, lineFeatured: false, sortOrder: 2 },
    { id: 'p_3', categoryId: 'pc_2', categoryName: '紀念品', name: '祕島明信片組（6 入）', description: '在地攝影師作品', price: 250, stock: 60, safetyStock: 15, imageUrl: '', active: true, lineFeatured: true, sortOrder: 3 },
    { id: 'p_4', categoryId: 'pc_2', categoryName: '紀念品', name: '手繪路線地圖', description: '', price: 350, stock: 0, safetyStock: 10, imageUrl: '', active: false, lineFeatured: false, sortOrder: 4 },
  ],
  productOrders: [
    { id: 'po_1', orderNo: 'PO20260820011', customerId: 'c_2', customerName: '林巧薇', items: [{ productId: 'p_1', productName: '防水袋 20L', quantity: 2, price: 680 }], totalAmount: 1360, status: 'PENDING', paymentStatus: 'UNPAID', createdAt: iso(0, 11) },
    { id: 'po_2', orderNo: 'PO20260819008', customerId: 'c_5', customerName: '張家豪', items: [{ productId: 'p_3', productName: '祕島明信片組（6 入）', quantity: 12, price: 250 }], totalAmount: 3000, status: 'COMPLETED', paymentStatus: 'PAID_ONLINE', createdAt: iso(-1, 15) },
  ],
  coupons: [
    { id: 'cp_1', name: '早鳥報名 9 折', description: '出團前 30 天報名適用', discountType: 'PERCENT', discountValue: 10, totalQuantity: 200, issuedQuantity: 88, redeemedQuantity: 41, startAt: iso(-40, 0), endAt: iso(60, 23), status: 'PUBLISHED', minOrderAmount: null, maxDiscountAmount: 800, giftItem: '', limitPerCustomer: 1, privateMode: false, lastRedeemedCode: 'GBR20260' },
    { id: 'cp_2', name: '揪團折 500', description: '4 人以上同行', discountType: 'AMOUNT', discountValue: 500, totalQuantity: 100, issuedQuantity: 34, redeemedQuantity: 12, startAt: iso(-15, 0), endAt: iso(45, 23), status: 'PUBLISHED', minOrderAmount: 4000, maxDiscountAmount: null, giftItem: '', limitPerCustomer: 3, privateMode: false, lastRedeemedCode: 'GRP99213' },
    { id: 'cp_3', name: '回訪禮：免費裝備租借', description: '一年內再次報名', discountType: 'GIFT', discountValue: 0, totalQuantity: 0, issuedQuantity: 26, redeemedQuantity: 9, startAt: iso(-90, 0), endAt: iso(180, 23), status: 'PUBLISHED', minOrderAmount: null, maxDiscountAmount: null, giftItem: '免費裝備租借（防水袋或防曬帽任選）', limitPerCustomer: null, privateMode: true, lastRedeemedCode: null },
    { id: 'cp_4', name: '暑期溯溪季 85 折', description: '', discountType: 'PERCENT', discountValue: 15, totalQuantity: 80, issuedQuantity: 80, redeemedQuantity: 71, startAt: iso(-120, 0), endAt: iso(-5, 23), status: 'EXPIRED', minOrderAmount: null, maxDiscountAmount: 600, giftItem: '', limitPerCustomer: 1, privateMode: false, lastRedeemedCode: null },
  ],
  staffPerformance: [
    { staffId: 's_1', staffName: '阿海', bookingCount: 48, completionRate: 95.8, revenue: 142600 },
    { staffId: 's_2', staffName: '小雨', bookingCount: 31, completionRate: 93.5, revenue: 88400 },
    { staffId: 's_4', staffName: 'Kai', bookingCount: 12, completionRate: 100, revenue: 37900 },
  ],
  pointBalance: 8150,
  pointTransactions: [
    { id: 'pt_1', type: 'CONSUME', amount: -249, balanceAfter: 8150, description: '訂閱功能：AI_ASSISTANT × 1 個月', createdAt: iso(-1, 10) },
    { id: 'pt_2', type: 'CONSUME', amount: -80, balanceAfter: 8399, description: 'LINE 推播 80 則（出團提醒）', createdAt: iso(-4, 9) },
    { id: 'pt_3', type: 'TOPUP', amount: 8000, balanceAfter: 8479, description: '線上儲值', createdAt: iso(-12, 14) },
  ],
  features: [
    { code: 'BASIC_REPORT', active: true, expiresAt: null },
    { code: 'MEMBERSHIP_SYSTEM', active: true, expiresAt: '2026-12-31' },
    { code: 'COUPON_SYSTEM', active: true, expiresAt: '2026-12-31' },
    { code: 'PRODUCT_SALES', active: true, expiresAt: '2026-12-31' },
    { code: 'INVENTORY', active: true, expiresAt: '2026-12-31' },
    { code: 'KEYWORD_REPLY', active: true, expiresAt: '2026-12-31' },
    { code: 'AI_ASSISTANT', active: true, expiresAt: '2026-09-20' },
    { code: 'PORTFOLIO_SHOWCASE', active: true, expiresAt: '2026-12-31' },
    { code: 'CUSTOM_RICH_MENU', active: true, expiresAt: '2026-12-31' },
    { code: 'EXTRA_PUSH', active: false, expiresAt: null },
    // 業態模式贈與（13 分冊 §2：GUIDE 開店自動開通，永久）
    { code: 'TOUR_MODULE', active: true, expiresAt: null },
  ],
};

/* ---------------------------------------------------------------- 🏥 診所 */
const CLINIC: ModeDataset = {
  sidebarCounts: { pendingBookingBadge: 6, unreadChatBadge: 3 },
  setupStatus: {
    percent: 100,
    steps: [
      { key: 'SHOP_INFO', done: true }, { key: 'STAFF', done: true },
      { key: 'SERVICE', done: true }, { key: 'BUSINESS_HOURS', done: true },
      { key: 'LINE_BOT', done: true },
    ],
  },
  dashboardStats: {
    todayBookings: 42, pendingBookings: 6, monthRevenue: 486300, totalCustomers: 1864,
    pushQuotaUsed: 96, pushQuotaTotal: 200, linePlatformStatus: 'CONNECTED',
  },
  dashboardAlerts: {
    unprocessedBookings: 6, lowStockProducts: 2, atRiskCustomers: 41,
    bookingCutoffPassed: false, bookingCutoffDate: null, pushQuotaExhausted: false,
    expiredFeatures: [], expiringFeatures: [],
  },
  staff: [
    { id: 's_1', name: '林醫師', phone: '0912-100-200', email: 'lin@example.com', title: '家庭醫學科 主治醫師', avatarUrl: '', serviceIds: ['sv_1', 'sv_2', 'sv_4'], bookable: true, active: true, sortOrder: 1 },
    { id: 's_2', name: '陳醫師', phone: '0922-300-400', email: 'chen@example.com', title: '健檢中心 主任', avatarUrl: '', serviceIds: ['sv_3', 'sv_5'], bookable: true, active: true, sortOrder: 2 },
    { id: 's_3', name: '王醫師', phone: '0933-500-600', email: '', title: '內科 醫師', avatarUrl: '', serviceIds: ['sv_1', 'sv_2', 'sv_4'], bookable: true, active: true, sortOrder: 3 },
    { id: 's_4', name: '護理師 小美', phone: '0955-700-800', email: '', title: '護理師', avatarUrl: '', serviceIds: ['sv_4'], bookable: false, active: true, sortOrder: 4 },
  ],
  services: [
    { id: 'sv_1', categoryId: 'sc_1', categoryName: '一般門診', name: '初診（含健康評估）', description: '第一次到診，含基本檢查與病史紀錄', durationMinutes: 30, price: 500, imageUrl: '', active: true, lineFeatured: true, sortOrder: 1 },
    { id: 'sv_2', categoryId: 'sc_1', categoryName: '一般門診', name: '複診', description: '追蹤治療進度', durationMinutes: 15, price: 300, imageUrl: '', active: true, lineFeatured: true, sortOrder: 2 },
    { id: 'sv_3', categoryId: 'sc_2', categoryName: '健檢', name: '成人健康檢查', description: '含抽血、心電圖、腹部超音波', durationMinutes: 90, price: 6800, imageUrl: '', active: true, lineFeatured: true, sortOrder: 3 },
    { id: 'sv_4', categoryId: 'sc_3', categoryName: '疫苗', name: '流感疫苗接種', description: '公費/自費皆可', durationMinutes: 15, price: 800, imageUrl: '', active: true, lineFeatured: false, sortOrder: 4 },
    { id: 'sv_5', categoryId: 'sc_2', categoryName: '健檢', name: '勞工體檢', description: '', durationMinutes: 60, price: 1500, imageUrl: '', active: false, lineFeatured: false, sortOrder: 5 },
  ],
  customers: [
    { id: 'c_1', name: '劉建國', phone: '0912-556-201', email: '', gender: 'MALE', birthday: '1958-04-21', note: '高血壓長期追蹤，每三個月回診', lineUserId: 'U801', lineDisplayName: '建國', membershipLevelId: 'ml_2', membershipLevelName: '長期追蹤', tags: ['慢性病'], bookingCount: 34, totalSpent: 41200, points: 412, lastVisitAt: iso(-30, 10), atRisk: false, active: true, createdAt: iso(-1200, 9) },
    { id: 'c_2', name: '周佩琪', phone: '0928-114-330', email: 'pei@example.com', gender: 'FEMALE', birthday: '1979-09-12', note: '對盤尼西林過敏', lineUserId: 'U802', lineDisplayName: 'Peggy', membershipLevelId: 'ml_1', membershipLevelName: '一般病患', tags: ['過敏'], bookingCount: 8, totalSpent: 12600, points: 126, lastVisitAt: iso(-8, 11), atRisk: false, active: true, createdAt: iso(-500, 14) },
    { id: 'c_3', name: '許文彥', phone: '0966-902-447', email: '', gender: 'MALE', birthday: '1996-12-03', note: '', lineUserId: null, lineDisplayName: null, membershipLevelId: 'ml_1', membershipLevelName: '一般病患', tags: [], bookingCount: 2, totalSpent: 1300, points: 13, lastVisitAt: iso(-200, 15), atRisk: true, active: true, createdAt: iso(-260, 15) },
    { id: 'c_4', name: '蔡淑芬', phone: '0919-337-885', email: 'fen@example.com', gender: 'FEMALE', birthday: '1966-01-25', note: '每年健檢常客', lineUserId: 'U804', lineDisplayName: '淑芬', membershipLevelId: 'ml_3', membershipLevelName: 'VIP 健檢', tags: ['健檢', 'VIP'], bookingCount: 22, totalSpent: 98400, points: 984, lastVisitAt: iso(-5, 9), atRisk: false, active: true, createdAt: iso(-1500, 10) },
  ],
  bookings: [
    { id: 'b_1', bookingNo: 'BK20260820101', customerId: 'c_1', customerName: '劉建國', customerPhone: '0912-556-201', serviceId: 'sv_2', serviceName: '複診', staffId: 's_1', staffName: '林醫師', startAt: iso(0, 9, 30), endAt: iso(0, 9, 45), durationMinutes: 15, price: 300, finalPrice: 300, status: 'CONFIRMED', paymentStatus: 'PAID_OFFLINE', source: 'LINE', note: '血壓藥續領', createdAt: iso(-3, 10), customerPoints: 412 },
    { id: 'b_2', bookingNo: 'BK20260820102', customerId: 'c_4', customerName: '蔡淑芬', customerPhone: '0919-337-885', serviceId: 'sv_3', serviceName: '成人健康檢查', staffId: 's_2', staffName: '陳醫師', startAt: iso(0, 8), endAt: iso(0, 9, 30), durationMinutes: 90, price: 6800, finalPrice: 6800, status: 'COMPLETED', paymentStatus: 'PAID_OFFLINE', source: 'PUBLIC_PAGE', note: '需空腹', createdAt: iso(-14, 11), customerPoints: 984 },
    { id: 'b_3', bookingNo: 'BK20260820103', customerId: 'c_2', customerName: '周佩琪', customerPhone: '0928-114-330', serviceId: 'sv_1', serviceName: '初診（含健康評估）', staffId: null, staffName: null, startAt: iso(0, 14), endAt: iso(0, 14, 30), durationMinutes: 30, price: 500, finalPrice: 500, status: 'PENDING', paymentStatus: 'UNPAID', source: 'LINE', note: '喉嚨痛三天', createdAt: iso(0, 8), customerPoints: 126 },
    { id: 'b_4', bookingNo: 'BK20260821101', customerId: 'c_3', customerName: '許文彥', customerPhone: '0966-902-447', serviceId: 'sv_4', serviceName: '流感疫苗接種', staffId: 's_3', staffName: '王醫師', startAt: iso(1, 10), endAt: iso(1, 10, 15), durationMinutes: 15, price: 800, finalPrice: 800, status: 'PENDING', paymentStatus: 'UNPAID', source: 'PUBLIC_PAGE', note: '', createdAt: iso(0, 19), customerPoints: 13 },
    { id: 'b_5', bookingNo: 'BK20260819105', customerId: 'c_1', customerName: '劉建國', customerPhone: '0912-556-201', serviceId: 'sv_2', serviceName: '複診', staffId: 's_1', staffName: '林醫師', startAt: iso(-1, 11), endAt: iso(-1, 11, 15), durationMinutes: 15, price: 300, finalPrice: 300, status: 'NO_SHOW', paymentStatus: 'UNPAID', source: 'LINE', note: '', createdAt: iso(-6, 9), customerPoints: 412 },
  ],
  membershipLevels: [
    { id: 'ml_1', name: '一般病患', color: '#86868b', thresholdSpent: 0, discountPercent: 0, pointRateMultiplier: 1, customerCount: 1620, sortOrder: 1, description: '所有新病患的預設等級', active: true, isDefault: true },
    { id: 'ml_2', name: '長期追蹤', color: '#0a84ff', thresholdSpent: 10000, discountPercent: 0, pointRateMultiplier: 1.5, customerCount: 198, sortOrder: 2, description: '需長期追蹤治療的病患，享回診提醒與優先候補', active: true, isDefault: false },
    { id: 'ml_3', name: 'VIP 健檢', color: '#bf5af2', thresholdSpent: 50000, discountPercent: 5, pointRateMultiplier: 2, customerCount: 46, sortOrder: 3, description: '年度健檢會員，享健檢加項優惠與報告解說預約', active: true, isDefault: false },
  ],
  products: [
    { id: 'p_1', categoryId: 'pc_1', categoryName: '保健品', name: '綜合維他命（90 錠）', description: '', price: 780, stock: 32, safetyStock: 10, imageUrl: '', active: true, lineFeatured: true, sortOrder: 1 },
    { id: 'p_2', categoryId: 'pc_1', categoryName: '保健品', name: '益生菌沖劑（30 包）', description: '', price: 1280, stock: 6, safetyStock: 12, imageUrl: '', active: true, lineFeatured: false, sortOrder: 2 },
    { id: 'p_3', categoryId: 'pc_2', categoryName: '衛材', name: '醫用口罩（50 入）', description: '', price: 180, stock: 4, safetyStock: 20, imageUrl: '', active: true, lineFeatured: false, sortOrder: 3 },
  ],
  productOrders: [
    { id: 'po_1', orderNo: 'PO20260820021', customerId: 'c_4', customerName: '蔡淑芬', items: [{ productId: 'p_1', productName: '綜合維他命（90 錠）', quantity: 2, price: 780 }], totalAmount: 1560, status: 'COMPLETED', paymentStatus: 'PAID_OFFLINE', createdAt: iso(0, 10) },
  ],
  coupons: [
    { id: 'cp_1', name: '健檢早鳥折 800', description: '提前 14 天預約健檢', discountType: 'AMOUNT', discountValue: 800, totalQuantity: 150, issuedQuantity: 96, redeemedQuantity: 58, startAt: iso(-45, 0), endAt: iso(45, 23), status: 'PUBLISHED', minOrderAmount: 3000, maxDiscountAmount: null, giftItem: '', limitPerCustomer: 1, privateMode: false, lastRedeemedCode: 'HC48120' },
    { id: 'cp_2', name: '疫苗季家庭方案', description: '同戶 3 人以上', discountType: 'PERCENT', discountValue: 10, totalQuantity: 100, issuedQuantity: 20, redeemedQuantity: 4, startAt: iso(-5, 0), endAt: iso(90, 23), status: 'PUBLISHED', minOrderAmount: null, maxDiscountAmount: 300, giftItem: '', limitPerCustomer: 4, privateMode: false, lastRedeemedCode: null },
  ],
  staffPerformance: [
    { staffId: 's_1', staffName: '林醫師', bookingCount: 286, completionRate: 96.9, revenue: 186400 },
    { staffId: 's_2', staffName: '陳醫師', bookingCount: 74, completionRate: 98.6, revenue: 214800 },
    { staffId: 's_3', staffName: '王醫師', bookingCount: 152, completionRate: 95.4, revenue: 85100 },
  ],
  pointBalance: 2340,
  pointTransactions: [
    { id: 'pt_1', type: 'CONSUME', amount: -96, balanceAfter: 2340, description: 'LINE 推播 96 則（回診提醒）', createdAt: iso(0, 9) },
    { id: 'pt_2', type: 'TOPUP', amount: 3000, balanceAfter: 2436, description: '線上儲值', createdAt: iso(-8, 11) },
  ],
  features: [
    { code: 'BASIC_REPORT', active: true, expiresAt: null },
    { code: 'MEMBERSHIP_SYSTEM', active: true, expiresAt: '2026-12-31' },
    { code: 'COUPON_SYSTEM', active: true, expiresAt: '2026-12-31' },
    { code: 'PRODUCT_SALES', active: true, expiresAt: '2026-12-31' },
    { code: 'INVENTORY', active: true, expiresAt: '2026-12-31' },
    { code: 'KEYWORD_REPLY', active: true, expiresAt: '2026-12-31' },
    { code: 'AI_ASSISTANT', active: false, expiresAt: null },
    { code: 'PORTFOLIO_SHOWCASE', active: false, expiresAt: null },
    { code: 'CUSTOM_RICH_MENU', active: false, expiresAt: null },
    { code: 'EXTRA_PUSH', active: true, expiresAt: '2026-12-31' },
    { code: 'TOUR_MODULE', active: false, expiresAt: null },
  ],
};

const DATASETS: Record<BusinessType, ModeDataset> = { LOCAL_SHOP, GUIDE, CLINIC };

/* ==========================================================================
   Live bindings —— 呼叫端不需修改；切換模式時由 applyMockMode 重新指派
   ========================================================================== */

let active: ModeDataset = DATASETS.GUIDE;   // 預設 = MOCK_TENANTS[0] 的業態

export let MOCK_SIDEBAR_COUNTS: Record<string, number> = active.sidebarCounts;
export let MOCK_SETUP_STATUS: SetupStatus = active.setupStatus;
export let MOCK_DASHBOARD_STATS: DashboardStats = active.dashboardStats;
export let MOCK_DASHBOARD_ALERTS: DashboardAlerts = active.dashboardAlerts;
export let MOCK_STAFF: Staff[] = active.staff;
export let MOCK_SERVICES: Service[] = active.services;
export let MOCK_CUSTOMERS: Customer[] = active.customers;
export let MOCK_BOOKINGS: Booking[] = active.bookings;
export let MOCK_MEMBERSHIP_LEVELS: MembershipLevel[] = active.membershipLevels;
export let MOCK_PRODUCTS: Product[] = active.products;
export let MOCK_PRODUCT_ORDERS: ProductOrder[] = active.productOrders;
export let MOCK_COUPONS: Coupon[] = active.coupons;
export let MOCK_STAFF_PERFORMANCE: StaffPerformance[] = active.staffPerformance;
export let MOCK_POINT_BALANCE: number = active.pointBalance;
export let MOCK_POINT_TRANSACTIONS: PointTransaction[] = active.pointTransactions;
export let MOCK_FEATURES: FeatureSubscription[] = active.features;

/** 目前的業態模式（頁面自帶 mock 可用它挑對應資料） */
export let MOCK_MODE: BusinessType = 'GUIDE';

/** 由 AppShell 在切換店家時呼叫 */
export function applyMockMode(mode: BusinessType) {
  if (MOCK_MODE === mode) return;
  MOCK_MODE = mode;
  active = DATASETS[mode];
  MOCK_SIDEBAR_COUNTS = active.sidebarCounts;
  MOCK_SETUP_STATUS = active.setupStatus;
  MOCK_DASHBOARD_STATS = active.dashboardStats;
  MOCK_DASHBOARD_ALERTS = active.dashboardAlerts;
  MOCK_STAFF = active.staff;
  MOCK_SERVICES = active.services;
  MOCK_CUSTOMERS = active.customers;
  MOCK_BOOKINGS = active.bookings;
  MOCK_MEMBERSHIP_LEVELS = active.membershipLevels;
  MOCK_PRODUCTS = active.products;
  MOCK_PRODUCT_ORDERS = active.productOrders;
  MOCK_COUPONS = active.coupons;
  MOCK_STAFF_PERFORMANCE = active.staffPerformance;
  MOCK_POINT_BALANCE = active.pointBalance;
  MOCK_POINT_TRANSACTIONS = active.pointTransactions;
  MOCK_FEATURES = active.features;
}

/**
 * 頁面自帶假資料的模式選擇器。
 * 用法：`const ROWS = byMode({ LOCAL_SHOP: [...], GUIDE: [...], CLINIC: [...] })`
 * —— 必須在 render / load 內呼叫（模組載入時 MOCK_MODE 還沒被 AppShell 設定）。
 */
export function byMode<T>(sets: Record<BusinessType, T>): T {
  return sets[MOCK_MODE];
}
