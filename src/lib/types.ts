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
  /**
   * 票券折抵累計金額（`bookings.coupon_discount`，migration 0022；issue #35）。
   * **`null` = 沒有紀錄**（這筆預約沒套過票券，或套用發生在 0022 之前），
   * 不是 0——0 是「折抵了 0 元」，兩者不可互相冒充（CLAUDE.md「載入中不要顯示 0」
   * 的同一條原則用在「無紀錄」上）。
   */
  couponDiscount?: number | null;
  /** 點數折抵累計點數（`bookings.points_redeemed`，1 點 = 1 元）。`null` = 無紀錄。 */
  pointsRedeemed?: number | null;
  /**
   * 顧客目前可用點數（`customers.points`，經 `bookings_view.customer_points`）。
   * 「使用點數」modal 的餘額來源。`null` = 這個回應沒有帶（例如舊版端點）。
   */
  customerPoints?: number | null;
};

/**
 * 預約加購明細（`booking_addons`，migration 0020；契約見 04 分冊 §B-1.1）。
 *
 * ⚠️ 與行程加購（10 分冊 §5 `trip_addons`）同名但**不是同一個資料模型**，
 * 兩者不可互換使用（CLAUDE.md：services 與 trips 兩套庫存模型不得合併）。
 */
export type BookingAddon = {
  id: string;
  /** 「從服務清單帶入」的來源服務；自由輸入（耗材／商品類）為 null */
  serviceId: string | null;
  name: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  /** 執行人員；null = 同本預約的人員。 */
  staffId: string | null;
  staffName: string | null;
  /** C+：PRIMARY=繼承預約人員、SPECIFIC_STAFF=指定、NONE=不計個人業績。 */
  performanceMode: 'PRIMARY' | 'SPECIFIC_STAFF' | 'NONE';
  performanceStaffId: string | null;
  /** 建立當下實際加進 booking.finalPrice 的金額（刪除時原數回沖） */
  appliedAmount: number;
  /** 建立當下實際加進 booking.durationMinutes 的分鐘（刪除時原數回沖） */
  appliedMinutes: number;
  /** 消費明細通知**實際**的結果（不是「有沒有要求通知」） */
  notified: BookingAddonNotifyOutcome;
  createdAt: string;
};

/** 加購消費明細通知的實際結果；每個值只描述真的發生過的事（04 §B-1.1） */
export type BookingAddonNotifyOutcome =
  /**
   * 沒有送出任何通知：`addonNotify` 沒勾；或 mock 模式（沒有任何推播管道，
   * 什麼都沒送出去，回 'NONE' 才是誠實的——同 updateBooking 的 notifyTriggered）
   */
  | 'NONE'
  /** 已推播給顧客，扣 1 則推播額度 */
  | 'LINE'
  /** 顧客未綁定 LINE → 沒有管道可送 */
  | 'NO_LINE'
  /** 本店尚未設定 LINE Channel → 沒送出 */
  | 'NOT_CONFIGURED'
  /** 本月推播額度已用完 → 沒送出（API 以 409 回應，加購仍已寫入） */
  | 'QUOTA_EXCEEDED'
  /** 試著送了但 LINE 平台回錯 → 沒送成 */
  | 'FAILED';

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
  /** 公開頁排序（DB services.sort_order）；POST /api/services/reorder 落地 */
  sortOrder: number;
  /** LINE 精選排序（DB services.line_sort_order，0017）；POST …/reorder-line 落地 */
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
  /** 公開頁排序（DB products.sort_order）；POST /api/products/reorder 落地 */
  sortOrder: number;
  /** LINE 精選排序（DB products.line_sort_order，0017）；POST …/reorder-line 落地 */
  lineSortOrder?: number;
};

export type ProductOrderStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

export type ProductOrder = {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  items: { productId: string; productName: string; quantity: number; price: number }[];
  /** 應付金額。套用票券後由後端扣減（見 /api/product-orders/:id/apply-coupon） */
  totalAmount: number;
  status: ProductOrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  /**
   * 已發生的票券折抵金額累計（migration 0027 的 product_orders.coupon_discount）。
   * null / undefined = 沒有折抵紀錄（mock 模式與 0027 之前的舊資料）。
   * 兩者在畫面上都顯示「無」——那句話在「沒套過券」與「套了 0 元」兩種情況下
   * 都成立；不得因此把 null 填成一個看起來像量測值的數字。
   */
  couponDiscount?: number | null;
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
  /* --- migration 0022（issue #35）：原站 formModal 既有欄位，補進契約 --- */
  /** 最低消費門檻；`null` = 無門檻 */
  minOrderAmount: number | null;
  /** 最高折抵金額（百分比折扣用）；`null` = 無上限 */
  maxDiscountAmount: number | null;
  /** 兌換券的兌換項目；`''` = 未填 */
  giftItem: string;
  /** 每人限領張數；`null` = 未設定（原站說明：不填則每人限領 1 張） */
  limitPerCustomer: number | null;
  /** 私密票券：不在公開頁與 LINE 顯示，僅限「發放」指定顧客 */
  privateMode: boolean;
  /**
   * 最近一張已核銷實例的 8 碼代碼（由 `coupon_instances` 即時算出，非欄位）。
   * `null` = 這張票券沒有任何已核銷的實例 → 頁面不顯示「還原票券」。
   */
  lastRedeemedCode: string | null;
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
  /* --- migration 0022（issue #35）：原站 levelModal 既有欄位，補進契約 --- */
  /** 等級說明（原站「等級說明」textarea） */
  description: string;
  /** 啟用此等級；停用的等級不會被自動升級指派 */
  active: boolean;
  /** 預設等級（新顧客自動套用）；每租戶至多一個（0022 的 partial unique index） */
  isDefault: boolean;
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
  /**
   * 示範店家：不是使用者真的擁有的店，資料全部來自 src/mock，供新註冊的店家
   * 參考各頁面長什麼樣子。只由前端（AppShell）合成，後端永遠不會回這個欄位。
   */
  demo?: boolean;
};

/* -------------------------------------------------- 老闆通知（owner-notify）
 * issue #18 / 06 分冊 §5.5。名單來源＝該店已加入的 LINE 好友（line_users），
 * 一位「主要」接收者另外會收到訂閱到期／儲值提醒。
 */

export type OwnerNotifyRecipient = {
  id: string;
  lineUserId: string;
  /** 可能是空字串（LINE 沒給暱稱）；畫面 fallback 成「(LINE 用戶)」 */
  displayName: string;
  pictureUrl: string;
  isPrimary: boolean;
  createdAt: string;
};

/**
 * `ENABLED`        名單非空，且剛剛真的問過 LINE（GET /v2/bot/info）回 200
 * `DISCONNECTED`   名單非空，但 LINE 連線異常 → 通知暫停發送中
 * `NO_RECIPIENTS`  LINE 已設定，但名單是空的 → 一則都不會發
 * `NOT_CONFIGURED` 尚未設定 LINE Channel
 */
export type OwnerNotifyStatus = 'ENABLED' | 'DISCONNECTED' | 'NO_RECIPIENTS' | 'NOT_CONFIGURED';

export type OwnerNotifyState = {
  status: OwnerNotifyStatus;
  recipients: OwnerNotifyRecipient[];
  /** 名單人數上限（後端提供；預設 3，見 migration 0022 檔頭） */
  maxRecipients: number;
};

/** 可加入名單的 LINE 好友（已 follow 且尚未在名單中） */
export type BindableLineUser = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
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

  /* ---- 以下為與 tour-platform 行程 JSON 對齊而新增的選填欄位（Phase 8a）----
   * 對應 tour-platform `buildActivityExportTemplate()` 的輸出，讓該站管理者
   * 匯出的 JSON 能原樣匯入本後台而不遺漏欄位。選填是因為既有 mock 資料與
   * 手動建立的行程不一定有值（鐵則 3：只增不改）。 */
  /** 適合對象（tour-platform goodFor） */
  goodFor?: string[];
  /** 常見問題（tour-platform faq） */
  faq?: TripFaqItem[];
  /** 社群口碑語錄（tour-platform socialProofQuotes） */
  socialProofQuotes?: TripSocialProofQuote[];
  /** 整體活動時長；方案層另有各自的 durationMinutes */
  durationMinutes?: number;
  /** 退款規則條列（tour-platform refundRules；與 refundPolicyType 併存） */
  refundRules?: string[];
};

/** 常見問題一則（tour-platform faq[]） */
export type TripFaqItem = { q: string; a: string };

/** 社群口碑語錄一則（tour-platform socialProofQuotes[]） */
export type TripSocialProofQuote = {
  author: string;
  rating: number;
  text: string;
  photos?: string[];
};

/**
 * 方案「詳細行程」的一站（tour-platform planItinerary[]）。
 * imageUrl 就是使用者要的「每個時間點可以上傳照片」。
 */
export type TripPlanItineraryStep = {
  icon: string;
  title: string;
  /** 停留時間的自由文字，例如「約 40 分鐘」 */
  duration: string;
  description: string;
  imageUrl?: string;
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

  /* ---- 與 tour-platform activityPlans[] 對齊而新增的選填欄位（Phase 8a）---- */
  /** 方案英文代碼；未填時由名稱自動產生 */
  slug?: string;
  /** 方案亮點 */
  highlights?: string[];
  /** 方案層的費用包含 / 不包含（與行程層的同名欄位併存，方案優先） */
  planInclusions?: string[];
  planExclusions?: string[];
  /** 方案層購買須知 / 取消政策 */
  planNotices?: string[];
  planRefundRules?: string[];
  /** 「詳細行程」站點時間表，每站可帶一張圖 */
  planItinerary?: TripPlanItineraryStep[];
  /** 集合地點 / 體驗地點（方案層覆寫行程層） */
  meetingPointName?: string;
  meetingAddress?: string;
  experiencePointName?: string;
  experienceAddress?: string;
  /** 導覽語言 */
  language?: string;
  /** 最早可出發日 YYYY-MM-DD */
  earliestDeparture?: string;
  /** 最晚幾天前回覆訂單結果 */
  confirmByDays?: number;
  /** 幾天前可免費取消 */
  freeCancelDays?: number;
  /** 前台按鈕文案 */
  detailsLinkText?: string;
  bookingBtnText?: string;
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
export type DepartureStaffRole = 'PRIMARY' | 'ASSISTANT';

export type DepartureStaffAssignment = {
  staffId: string;
  staffName: string;
  role: DepartureStaffRole;
};

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
  primaryStaffId?: string | null;
  primaryStaffName?: string | null;
  assistantStaffIds?: string[];
  assistantStaffNames?: string[];
};

export type DepartureStaffAvailability = {
  staffId: string;
  staffName: string;
  available: boolean;
  conflicts: Array<{ reason: 'SHIFT' | 'BOOKING' | 'BLOCK' | 'DEPARTURE'; conflictStart?: string; conflictEnd?: string }>;
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

export type AddonPerformanceMode = 'PRIMARY' | 'SPECIFIC_STAFF' | 'NONE';

/** 旅遊訂單成立時保存的加購快照；完成訂單後業績欄位即凍結。 */
export type TourOrderAddon = {
  id: string;
  tripAddonId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  appliedAmount: number;
  performanceMode: AddonPerformanceMode;
  specificStaffId: string | null;
  performanceStaffId: string | null;
  performanceAmount: number | null;
  createdAt: string;
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

/** GUIDE 首頁的推導行動；資料真相仍留在訂單、團次、指派與通知帳本。 */
export type GuideActionReason =
  | 'REQUEST_PENDING' | 'PAYMENT_DUE' | 'DEPARTURE_UPCOMING' | 'GUIDE_UNASSIGNED';
export type GuideActionUrgency = 'IMMEDIATE' | 'TODAY' | 'UPCOMING';
export type GuideActionSource = {
  id: string;
  reason: GuideActionReason;
  subject: string;
  detail: string;
  dueAt: string | null;
  createdAt: string | null;
  href: string;
};
export type GuideActionItem = GuideActionSource & { urgency: GuideActionUrgency; overdue: boolean };
export type GuideActionInbox = { immediate: GuideActionItem[]; today: GuideActionItem[]; upcoming: GuideActionItem[]; timeZone?: string };

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
    departureId?: string;
    tripId?: string;
    tripTitle?: string;
    planName?: string;
    departureStatus?: DepartureStatus;
    primaryStaffId?: string | null;
    primaryStaffName?: string | null;
    assistantStaffIds?: string[];
    assistantStaffNames?: string[];
    seatsBooked?: number;
    capacity?: number;
    /* BLOCK */
    reason?: string;
    /* EXTERNAL */
    calendarName?: string;
  };
};
