/**
 * 功能商店（Feature Store）旗標
 * -----------------------------------------------------------------------------
 * 原站行為：側邊欄項目帶 data-feature="XXX"，未訂閱時仍然顯示，
 * 但點進去會被導到 /tenant/feature-store?feature=XXX 引導訂閱；
 * 訂閱到期時相關資料保留、對外功能暫停（票券暫停、商品下架）。
 */
export const FEATURE_CODES = [
  'BASIC_REPORT',        // 營運報表
  'MEMBERSHIP_SYSTEM',   // 會員等級
  'COUPON_SYSTEM',       // 票券管理
  'PRODUCT_SALES',       // 商品管理 / 商品訂單
  'INVENTORY',           // 庫存異動
  'KEYWORD_REPLY',       // 關鍵字回覆
  'AI_ASSISTANT',        // AI 客服設定
  'PORTFOLIO_SHOWCASE',  // 作品展示
  'CUSTOM_RICH_MENU',    // 選單設計
  'EXTRA_PUSH',          // 加購推播額度
  'TOUR_MODULE',         // 導遊模組：行程 / 方案 / 團次 / 旅遊訂單（見 docs/integration/10-TOUR-DOMAIN.md）
] as const;

export type FeatureCode = (typeof FEATURE_CODES)[number];

/** 訂閱來源（09 分冊 §2）：單買 / 套裝 / 平台贈送 */
export type FeatureSubscriptionSource = 'INDIVIDUAL' | 'BUNDLE_LITE' | 'BUNDLE_PRO' | 'GRANTED';

export type FeatureSubscription = {
  code: FeatureCode;
  /** 是否在有效訂閱期間內 */
  active: boolean;
  /** ISO 日期；null = 永久 */
  expiresAt: string | null;
  /* -- 以下為 09 分冊 §3 新增的選填欄位（契約只增不改，鐵則 3） -- */
  /** ISO 日期；訂閱起始日 */
  startedAt?: string;
  /** ISO 日期；非 null = 已取消（到期前仍可用），null/未提供 = 未取消 */
  cancelledAt?: string | null;
  source?: FeatureSubscriptionSource;
};

/* -------------------------------------------------------------------------- */
/* 功能目錄（22 項）— docs/integration/09-FEATURE-STORE.md §1                   */
/* -------------------------------------------------------------------------- */

/** 目錄分類；對應 i18n feature-store 頁 t.filters（不含 ALL） */
export type FeatureCategory = 'BOOKING' | 'CUSTOMER' | 'MARKETING' | 'SHOP' | 'LINE' | 'SYSTEM';

/**
 * 功能目錄唯一事實來源（原本住在 /tenant/feature-store 頁內，依 09 分冊 §1
 * 移入本檔 —— 鐵則 1 的核准例外，只搬常數不動 UI）。
 * key 同時是 i18n `featureStorePage.features` 的鍵與 DB `feature_subscriptions.code`；
 * price = 點/月（免費功能 0）；後端不得發明新的功能碼。
 */
export const FEATURE_CATALOG = [
  /* ---- 免費功能 ---- */
  { key: 'ONLINE_BOOKING', category: 'BOOKING', price: 0, paid: false },
  { key: 'SERVICE_CATALOG', category: 'BOOKING', price: 0, paid: false },
  { key: 'CUSTOMER_BASIC', category: 'CUSTOMER', price: 0, paid: false },
  { key: 'STAFF_BASIC', category: 'SYSTEM', price: 0, paid: false },

  /* ---- 付費功能（共 18 項）---- */
  { key: 'UNLIMITED_STAFF', category: 'SYSTEM', price: 49, paid: true },
  { key: 'SHIFT_MANAGEMENT', category: 'SYSTEM', price: 49, paid: true },
  { key: 'BOOKING_REMINDER', category: 'BOOKING', price: 49, paid: true },
  { key: 'BIRTHDAY_GREETING', category: 'MARKETING', price: 49, paid: true },
  { key: 'CUSTOMER_RECALL', category: 'MARKETING', price: 49, paid: true },
  { key: 'POINT_SYSTEM', category: 'CUSTOMER', price: 49, paid: true },
  { key: 'ADVANCED_CUSTOMER', category: 'CUSTOMER', price: 49, paid: true },
  { key: 'EMAIL_NOTIFICATION', category: 'SYSTEM', price: 49, paid: true },
  { key: 'BASIC_REPORT', category: 'SYSTEM', price: 99, paid: true },
  { key: 'MEMBERSHIP_SYSTEM', category: 'CUSTOMER', price: 49, paid: true },
  { key: 'COUPON_SYSTEM', category: 'MARKETING', price: 49, paid: true },
  { key: 'PRODUCT_SALES', category: 'SHOP', price: 99, paid: true },
  { key: 'INVENTORY', category: 'SHOP', price: 49, paid: true },
  { key: 'KEYWORD_REPLY', category: 'LINE', price: 49, paid: true },
  { key: 'AI_ASSISTANT', category: 'LINE', price: 249, paid: true },
  { key: 'PORTFOLIO_SHOWCASE', category: 'SHOP', price: 49, paid: true },
  { key: 'CUSTOM_RICH_MENU', category: 'LINE', price: 149, paid: true },
  { key: 'EXTRA_PUSH', category: 'LINE', price: 249, paid: true },
] as const satisfies readonly {
  key: string;
  category: FeatureCategory;
  price: number;
  paid: boolean;
}[];

/** 目錄項目 / 目錄功能碼（22 個；FEATURE_CODES 只是側邊欄閘門用的 10 碼子集） */
export type FeatureCatalogItem = (typeof FEATURE_CATALOG)[number];
export type FeatureCatalogCode = FeatureCatalogItem['key'];

/** 18 個付費功能碼（= PRO 套裝內容） */
export const PAID_FEATURE_CODES: FeatureCatalogCode[] =
  FEATURE_CATALOG.filter((f) => f.paid).map((f) => f.key);

/* -------------------------------------------------------------------------- */
/* 套裝方案（09 分冊 §1）                                                       */
/* -------------------------------------------------------------------------- */

export type FeatureBundleKey = 'LITE' | 'PRO';

/** 套裝定義：一次開通多碼、扣點只扣一次套裝價 */
export const FEATURE_BUNDLES: Record<
  FeatureBundleKey,
  { price: number; source: Extract<FeatureSubscriptionSource, 'BUNDLE_LITE' | 'BUNDLE_PRO'>;
    codes: FeatureCatalogCode[] }
> = {
  /** 輕量版 399 點/月：5 碼 */
  LITE: {
    price: 399,
    source: 'BUNDLE_LITE',
    codes: ['UNLIMITED_STAFF', 'BOOKING_REMINDER', 'BASIC_REPORT', 'POINT_SYSTEM', 'MEMBERSHIP_SYSTEM'],
  },
  /** 專業版 799 點/月：全部 18 項付費功能 */
  PRO: {
    price: 799,
    source: 'BUNDLE_PRO',
    codes: PAID_FEATURE_CODES,
  },
};

/** 距到期幾天內要在儀表板出現「即將到期」提醒（原站文案：10 天內） */
export const FEATURE_EXPIRY_WARNING_DAYS = 10;

/** LINE 官方帳號免費方案每月推播上限（原站文案寫死 200 則） */
export const LINE_FREE_PUSH_QUOTA = 200;

// Post-merge CI canary: this harmless source comment intentionally exercises the full runtime lane.
