/**
 * 領域型別 — 由原站 API 回傳結構與後台表格欄位反推。
 * 換成真實後端時，這份檔案就是前後端的契約。
 */

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  /** 原站錯誤碼，例如 AUTH_005 */
  code?: string;
};

export type Paged<T> = {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
};

/* ------------------------------------------------------------------ 預約 */
export type BookingStatus =
  | 'PENDING'     // 待確認
  | 'CONFIRMED'   // 已確認
  | 'COMPLETED'   // 已完成
  | 'CANCELLED'   // 已取消
  | 'NO_SHOW';    // 爽約

export type PaymentStatus = 'UNPAID' | 'PAID_ONLINE' | 'PAID_OFFLINE' | 'REFUNDED';

export type Booking = {
  id: string;
  bookingNo: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  staffId: string | null;
  staffName: string | null;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  price: number;
  finalPrice: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  source: 'LINE' | 'PUBLIC_PAGE' | 'MANUAL' | 'RECURRING';
  note: string;
  createdAt: string;
};

/* ------------------------------------------------------------------ 顧客 */
export type Gender = '' | 'MALE' | 'FEMALE' | 'OTHER';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  gender: Gender;
  birthday: string;
  note: string;
  lineUserId: string | null;
  lineDisplayName: string | null;
  membershipLevelId: string | null;
  membershipLevelName: string | null;
  tags: string[];
  bookingCount: number;
  totalSpent: number;
  points: number;
  lastVisitAt: string | null;
  atRisk: boolean;
  active: boolean;
  createdAt: string;
};

/* ------------------------------------------------------------ 服務 / 員工 */
export type Service = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  imageUrl: string;
  active: boolean;
  lineFeatured: boolean;
  sortOrder: number;
};

export type Staff = {
  id: string;
  name: string;
  phone: string;
  email: string;
  title: string;
  avatarUrl: string;
  serviceIds: string[];
  bookable: boolean;
  active: boolean;
  sortOrder: number;
};

/* ------------------------------------------------------------ 商品 / 訂單 */
export type Product = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string;
  price: number;
  stock: number;
  safetyStock: number;
  imageUrl: string;
  active: boolean;
  lineFeatured: boolean;
  sortOrder: number;
};

export type ProductOrderStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

export type ProductOrder = {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  items: { productId: string; productName: string; quantity: number; price: number }[];
  totalAmount: number;
  status: ProductOrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
};

/* ------------------------------------------------------------------ 票券 */
export type CouponStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'EXPIRED';

export type Coupon = {
  id: string;
  name: string;
  description: string;
  discountType: 'AMOUNT' | 'PERCENT' | 'GIFT';
  discountValue: number;
  totalQuantity: number;
  issuedQuantity: number;
  redeemedQuantity: number;
  startAt: string;
  endAt: string;
  status: CouponStatus;
};

/* -------------------------------------------------------------- 會員等級 */
export type MembershipLevel = {
  id: string;
  name: string;
  color: string;
  thresholdSpent: number;
  discountPercent: number;
  pointRateMultiplier: number;
  customerCount: number;
  sortOrder: number;
};

/* ------------------------------------------------------------------ 報表 */
export type DashboardStats = {
  todayBookings: number;
  pendingBookings: number;
  monthRevenue: number;
  totalCustomers: number;
  pushQuotaUsed: number;
  pushQuotaTotal: number;
  linePlatformStatus: 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';
};

export type DashboardAlerts = {
  unprocessedBookings: number;
  lowStockProducts: number;
  atRiskCustomers: number;
  bookingCutoffPassed: boolean;
  bookingCutoffDate: string | null;
  pushQuotaExhausted: boolean;
  expiredFeatures: string[];
  expiringFeatures: { code: string; expiresAt: string }[];
};

export type StaffPerformance = {
  staffId: string;
  staffName: string;
  bookingCount: number;
  completionRate: number;
  revenue: number;
};

/* ------------------------------------------------------------------ 點數 */
export type PointTransaction = {
  id: string;
  type: 'TOPUP' | 'CONSUME' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'REFUND';
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
};

/* ------------------------------------------------------------------ 租戶 */
export type TenantSummary = {
  id: string;
  shopCode: string;
  name: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  current: boolean;
};

export type SetupStatus = {
  /** 0–100 */
  percent: number;
  steps: {
    key: 'SHOP_INFO' | 'STAFF' | 'SERVICE' | 'BUSINESS_HOURS' | 'LINE_BOT';
    done: boolean;
  }[];
};
