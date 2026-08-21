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

export type FeatureSubscription = {
  code: FeatureCode;
  /** 是否在有效訂閱期間內 */
  active: boolean;
  /** ISO 日期；null = 永久 */
  expiresAt: string | null;
};

/** 距到期幾天內要在儀表板出現「即將到期」提醒（原站文案：10 天內） */
export const FEATURE_EXPIRY_WARNING_DAYS = 10;

/** LINE 官方帳號免費方案每月推播上限（原站文案寫死 200 則） */
export const LINE_FREE_PUSH_QUOTA = 200;
