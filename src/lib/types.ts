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
  /** 公開頁排序（DB sort_order） */
  sortOrder: number;
  /** LINE 精選排序（DB line_sort_order；未升級的資料相容回 sortOrder） */
  lineSortOrder?: number;
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
  /** 公開頁排序（DB sort_order） */
  sortOrder: number;
  /** LINE 精選排序（DB line_sort_order；未升級的資料相容回 sortOrder） */
  lineSortOrder?: number;
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
  /** 業態模式（見 src/config/modes.ts）；未提供時視為 LOCAL_SHOP */
  businessType?: 'LOCAL_SHOP' | 'GUIDE' | 'CLINIC';
  /** 斜槓店家加開的其他模組 */
  extraModules?: ('LOCAL_SHOP' | 'GUIDE' | 'CLINIC')[];
};

export type SetupStatus = {
  /** 0–100 */
  percent: number;
  steps: {
    key: 'SHOP_INFO' | 'STAFF' | 'SERVICE' | 'BUSINESS_HOURS' | 'LINE_BOT';
    done: boolean;
  }[];
};

/* ------------------------------------------------------------ 行程（旅遊） */
/**
 * 導遊模組（TOUR_MODULE）— 由 Midao 的 activities / activity_plans /
 * activity_plan_seasons / activity_addons 反推，欄位語意與其一致。
 * 詳細規格：docs/integration/10-TOUR-DOMAIN.md
 */

/** VibeAI 公開商店頁的可見性 */
export type TripStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/** Midao 前台的上架審核狀態（與 TripStatus 互相獨立） */
export type MidaoListing = 'NONE' | 'PENDING' | 'LISTED' | 'REJECTED';

export type Trip = {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  /** 簡介（VibeAI 商店頁與卡片用） */
  summary: string;
  /** 詳細行程（Midao 前台用） */
  description: string;
  region: string;
  category: string;
  coverImageUrl: string;
  galleryUrls: string[];
  meetingPoint: string;
  meetingPointMapUrl: string;
  /** 費用包含 / 不包含 / 注意事項，一行一項 */
  inclusions: string[];
  exclusions: string[];
  notices: string[];
  safetyNotice: string;
  refundPolicyType: 'STANDARD' | 'FLEXIBLE' | 'STRICT';
  status: TripStatus;
  midaoListing: MidaoListing;
  /** Midao 管理者退回時的說明 */
  midaoListingNote: string;
  /** 衍生欄位（列表用） */
  planCount: number;
  upcomingDepartureCount: number;
  minPrice: number;
  updatedAt: string;
};

/** 計價方式：每人 / 每團 */
export type PriceType = 'PER_PERSON' | 'PER_GROUP';

/**
 * 預約型態（Midao booking_type）
 * INSTANT   即時確認：旅客下單即成立
 * REQUEST   需確認：導遊審核後才成立
 * SCHEDULED 固定團次：只能選已開的團次
 */
export type TripBookingType = 'INSTANT' | 'REQUEST' | 'SCHEDULED';

/** 方案送審狀態（Midao 管理者審核方案內容與定價） */
export type PlanReviewState = 'NONE' | 'PENDING' | 'CHANGES_REQUESTED';

export type TripPlan = {
  id: string;
  tripId: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceType: PriceType;
  basePrice: number;
  /** 兒童價；null = 不分 */
  childPrice: number | null;
  minParticipants: number;
  maxParticipants: number;
  bookingType: TripBookingType;
  /**
   * 線上收款模式（與服務項目同一套選項）
   * NONE            不線上收款（純 LINE / 現場結）
   * DEPOSIT_FIXED   固定金額定金
   * DEPOSIT_PERCENT 比例定金（depositValue = 1–100）
   * FULL            全額線上收（行程預設）
   */
  depositMode: 'NONE' | 'DEPOSIT_FIXED' | 'DEPOSIT_PERCENT' | 'FULL';
  depositValue: number;
  active: boolean;
  /** 全年販售；false 時以 seasons 決定販售期間 */
  yearRound: boolean;
  seasons: TripPlanSeason[];
  reviewState: PlanReviewState;
  reviewNote: string;
  sortOrder: number;
};

/** 販售季節（月/日區間，可跨年） */
export type TripPlanSeason = {
  id: string;
  name: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  /** 該季節售價；null = 用方案基本價 */
  priceOverride: number | null;
  active: boolean;
};

export type DepartureStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export type TripDeparture = {
  id: string;
  tripId: string;
  planId: string;
  planName: string;
  departsOn: string;
  startTime: string;
  capacity: number;
  seatsBooked: number;
  status: DepartureStatus;
  note: string;
};

export type TripAddon = {
  id: string;
  tripId: string;
  name: string;
  price: number;
  unit: PriceType;
  /** null = 不限量 */
  stock: number | null;
  active: boolean;
  sortOrder: number;
};

export type TourOrderStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type TourPaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';
export type TourOrderSource = 'MIDAO' | 'VIBEAI_SHOP' | 'LINE' | 'MANUAL';

export type TourOrder = {
  id: string;
  orderNo: string;
  tripId: string;
  tripTitle: string;
  planName: string;
  departsOn: string;
  startTime: string;
  customerName: string;
  customerPhone: string;
  partySize: number;
  unitPrice: number;
  totalAmount: number;
  /** 已收定金；0 = 全額或未收。待收尾款 = totalAmount - depositAmount */
  depositAmount: number;
  status: TourOrderStatus;
  paymentStatus: TourPaymentStatus;
  /** 收款方式顯示名稱（來自 tenant_payment_methods） */
  paymentMethodLabel: string;
  /** 匯款後五碼 / 金流交易編號 */
  paymentRef: string;
  source: TourOrderSource;
  /** 未付款保留到期時間；null = 不自動釋放 */
  holdExpiresAt: string | null;
  note: string;
  createdAt: string;
};

/* -------------------------------------------------------------- 行事曆 */
/**
 * GET /api/calendar 的統一事件（04 分冊 §B-1）：行事曆頁唯一資料源，
 * 「展示層合一、資料層仍分開」——四種來源合併成一個陣列，以 type 區辨：
 *   BOOKING   服務預約（bookings）
 *   DEPARTURE 行程團次（trip_departures，TOUR_MODULE 租戶才出現）
 *   BLOCK     封鎖時段（block_times）
 *   EXTERNAL  匯入的外部 ICS（external_calendars，唯讀）
 */
export type CalendarEventType = 'BOOKING' | 'DEPARTURE' | 'BLOCK' | 'EXTERNAL';

export type CalendarEvent = {
  /** 合併陣列內唯一：`<type 小寫>:<來源列 uuid>`（不同表的 uuid 理論上不撞，前綴保險） */
  id: string;
  type: CalendarEventType;
  /** 顯示標題（BOOKING=服務·顧客；BLOCK=原因；DEPARTURE=行程·方案；EXTERNAL=外部事件標題） */
  title: string;
  /** ISO 起訖 */
  start: string;
  end: string;
  /** 各 type 專屬的附加欄位，前端依 type 取用 */
  meta?: {
    /* BOOKING */
    bookingId?: string;
    bookingNo?: string;
    status?: BookingStatus;
    customerName?: string;
    serviceName?: string;
    /* BOOKING / BLOCK 共用：null = 全店（BLOCK）或未指定（BOOKING） */
    staffId?: string | null;
    staffName?: string | null;
    /* DEPARTURE */
    seatsBooked?: number;
    capacity?: number;
    /* BLOCK */
    reason?: string;
    /* EXTERNAL */
    calendarName?: string;
  };
};
