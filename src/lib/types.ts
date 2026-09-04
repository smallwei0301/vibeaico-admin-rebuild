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

/* ------------------------------------------------------- GUIDE 首頁待處理事項 */
export type GuideActionInboxPriority = 'IMMEDIATE' | 'TODAY' | 'UPCOMING';

export type GuideActionInboxDepartureDay = 'TODAY' | 'TOMORROW';

type GuideActionInboxItemBase = {
  id: string;
  priority: GuideActionInboxPriority;
  dueAt: string;
  createdAt: string;
  href: string;
};

export type GuideActionInboxItem =
  | (GuideActionInboxItemBase & {
    kind: 'BOOKING_REQUEST';
    bookingNo: string;
    customerName: string;
    serviceName: string;
  })
  | (GuideActionInboxItemBase & {
    kind: 'BOOKING_PAYMENT';
    bookingNo: string;
    customerName: string;
    serviceName: string;
    amount: number;
  })
  | (GuideActionInboxItemBase & {
    kind: 'DEPARTURE';
    tripId: string;
    tripName: string;
    planName: string;
    departureDate: string;
    startTime: string;
    capacity: number;
    seatsBooked: number;
    departureDay: GuideActionInboxDepartureDay;
  });

/* ------------------------------------------------------------------ 顧客 */
export type Gender = '' | 'MALE' | 'FEMALE' | 'OTHER';

/**
 * 顧客檔案來源（Issue #7，對應 DB customers.source，預設 'MANUAL'）：
 * MANUAL = 店家後台手動新增；LINE / PUBLIC_BOOKING = 顧客透過 LINE 或公開
 * 預約頁完成第一筆預約後系統自動建檔（見 customers 頁說明文字）。
 * 選填：既有呼叫端與 mock 資料未必都已補上這個欄位。
 */
export type CustomerSource = 'MANUAL' | 'LINE' | 'PUBLIC_BOOKING';

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
  source?: CustomerSource;
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

/** #7：排班模式，per-員工屬性（staff.schedule_mode）。FIXED_REST 走週排班，ROTATING 逐日排班。 */
export type StaffScheduleMode = 'FIXED_REST' | 'ROTATING';

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
  /** 選填：舊資料／尚未回填的環境沒有這個欄位，前端一律以 'ROTATING' 當預設。 */
  scheduleMode?: StaffScheduleMode;
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

/**
 * 作品集（/tenant/portfolio ↔ 0005 portfolios 表 + 0075 line_sort_order）。
 * sortOrder = 公開頁順序（/api/portfolios/reorder 依 ids 索引寫入）；
 * lineSortOrder = LINE 作品瀏覽選單順序（/api/portfolios/reorder-line）。
 * 兩者互不影響。
 */
export type Portfolio = {
  id: string;
  title: string;
  imageUrl: string;
  description: string;
  active: boolean;
  lineFeatured: boolean;
  sortOrder: number;
  lineSortOrder: number;
  createdAt: string;
};

/**
 * 行銷活動（/tenant/campaigns）— 對應 campaigns 表（0005 migration）：
 * id/name/keyword/content jsonb/start_at/end_at/status/created_at，DB 不拆欄。
 * status 只有 DRAFT/PUBLISHED/PAUSED/ENDED 四種（沒有獨立持久化的 SCHEDULED，
 * 那是前端用 status===PUBLISHED && startAt 在未來算出來的顯示狀態）。
 *
 * description/type/pushMessage/couponId/bonusPoints/thresholdAmount/recallDays/
 * isAutoTrigger/imageUrl 全部收在 content jsonb（見
 * src/app/api/campaigns/route.ts 檔頭註解），這裡把它們攤平方便頁面使用；
 * src/services/campaigns.ts 負責在讀寫時跟 content 互轉。
 *
 * participantCount 沒有列在這個型別裡：repo 內沒有任何來源表可以算「參加人數」
 * （沒有 campaign_participants，也沒有任何表帶 campaign_id 外鍵），這是純衍生
 * 統計值，一律沒有資料可讀。頁面必須顯示誠實佔位，不可捏造 —— Issue #23
 * Owner 待決事項：若要顯示這個數字，需要先決定它的資料來源。
 */
export type CampaignStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ENDED';
export type CampaignType =
  | 'BIRTHDAY' | 'NEW_CUSTOMER' | 'SPENDING_THRESHOLD' | 'LIMITED_TIME' | 'RECALL' | 'REFERRAL';

export type Campaign = {
  id: string;
  name: string;
  keyword: string;
  description: string;
  type: CampaignType | '';
  status: CampaignStatus;
  startAt: string | null;
  endAt: string | null;
  pushMessage: string;
  couponId: string | null;
  bonusPoints: number;
  thresholdAmount: number | null;
  recallDays: number | null;
  isAutoTrigger: boolean;
  imageUrl: string;
  createdAt: string;
};

/**
 * 行銷推播（/tenant/marketing，marketing_pushes 表）— Issue #24。
 *
 * 語意見 src/app/api/marketing/pushes/route.ts 檔頭註解：
 * - status：DRAFT/SCHEDULED/SENDING/SENT/CANCELLED/FAILED（0005 migration + LINE 發送失敗）。
 *   SENDING 是條件式 update 佔位用的暫態，發送請求完成前後就會落到 SENT 或 FAILED。
 * - targetType：ALL 全部已加好友顧客；MEMBERSHIP_LEVEL／TAG／CUSTOM 的 targetValue 語意
 *   各自不同，見同一份檔頭註解，前端不得自行發明語意。
 * - 沒有 estimatedCount（預估受眾人數）或 failedCount（個別失敗人數）欄位：
 *   marketing_pushes 沒有任何欄位或關聯表能在發送前算出受眾人數，也不記錄逐筆失敗數，
 *   這是誠實缺口，不可捏造 —— 見 Issue #24 Owner 待決事項。
 */
export type MarketingPushStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
export type MarketingPushTargetType = 'ALL' | 'MEMBERSHIP_LEVEL' | 'TAG' | 'CUSTOM';

export type MarketingPush = {
  id: string;
  title: string;
  content: string;
  imageUrl: string;
  note: string;
  targetType: MarketingPushTargetType;
  /** MEMBERSHIP_LEVEL=等級 id；TAG=標籤名稱；CUSTOM=LINE User ID 換行清單 */
  targetValue: string;
  targetLabel: string;
  status: MarketingPushStatus;
  sentCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

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
    /**
     * WEEKLY 封鎖規則查詢時展開成多次發生時，`id` 會帶上發生時間讓合併陣列內
     * 保持唯一（型別頂端註解的規則）；這裡另外帶「來源規則列」的真實 uuid，
     * 供編輯／刪除呼叫 /api/block-times/:id 用（同一規則的每次發生都指回它）。
     */
    blockTimeId?: string;
    /* EXTERNAL */
    calendarName?: string;
  };
};
