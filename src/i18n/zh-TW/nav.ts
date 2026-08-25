import { MODE_PRESETS, type BusinessType } from '@/config/modes';

/**
 * 側邊欄導航文案（zh-TW）
 * 鍵對應 src/config/nav.ts 的 key。換語系只需新增同結構的檔案。
 */
export const nav = {
  dashboard: '儀表板',
  navBooking: '預約管理',
  bookings: '預約列表',
  recurring_bookings: '定期預約',
  calendar: '行事曆',
  reports: '營運報表',
  calendar_sync: '行事曆同步',
  trips: '行程與方案',
  tour_orders: '旅遊訂單',
  navCustomer: '顧客管理',
  customers: '顧客列表',
  membership_levels: '會員等級',
  chat: '顧客訊息',
  navOperation: '店家營運',
  staff: '員工管理',
  services: '服務項目',
  block_times: '封鎖時段',
  clinic_queue: '看診號碼掛號',
  shifts: '班表管理',
  payment_methods: '收款方式',
  coupons: '票券管理',
  products: '商品管理',
  product_orders: '商品訂單',
  inventory: '庫存異動',
  keyword_replies: '關鍵字回覆',
  ai_settings: 'AI 客服設定',
  navMarketing: '行銷推廣',
  promote: '推廣中心',
  campaigns: '行銷活動',
  marketing: '行銷推播',
  referrals: '推薦好友',
  navPublicPage: '公開頁面',
  shop_design: '店面設計',
  portfolio: '作品展示',
  navSystem: '系統設定',
  settings: '店家設定',
  line_settings: 'LINE 設定',
  rich_menu_design: '選單設計',
  feature_store: '功能商店',
  points: '點數管理',
  donate: '贊助我們',
  report_issue: '回報問題',
} as const;

export type NavKey = keyof typeof nav;

/**
 * 業態模式的名詞覆寫（見 src/config/modes.ts）。
 * 只覆寫「同一個槽位、不同業態叫法不同」的鍵；未列出者用上面的預設值。
 * 例：嚮導的「預約管理」其實是在管旅遊訂單，叫「訂單管理」才對。
 */
export const navByMode: Partial<Record<string, Partial<Record<NavKey, string>>>> = {
  GUIDE: {
    navBooking: '訂單管理',
    navOperation: '行程營運',
    calendar: '出團行事曆',
  },
  CLINIC: {
    navBooking: '看診管理',
    navOperation: '診所營運',
    services: '診療項目',
    staff: '醫師管理',
    calendar: '看診行事曆',
  },
};

/** 取得某個業態模式下的選單文案 */
export const navLabel = (key: NavKey, businessType = 'LOCAL_SHOP'): string =>
  navByMode[businessType]?.[key] ?? nav[key];

/* -------------------------------------------------------------------------- */
/* 父層級「目錄／訂單」的名稱（14 分冊 §8.13）                                    */
/* -------------------------------------------------------------------------- */
/*
 * 「服務項目」與「預約管理」是**父層級概念**，三種模式各有自己的子層級：
 *   目錄  LOCAL_SHOP 服務項目 / GUIDE 行程與方案 / CLINIC 診療項目
 *   訂單  LOCAL_SHOP 預約列表 / GUIDE 旅遊訂單   / CLINIC 預約列表
 *
 * 跨頁文案提到目錄或訂單時**一律**呼叫下面兩個函式，不得寫死「服務項目」
 * 「預約管理」——嚮導的選單裡沒有那兩頁，寫死等於叫他去一個不存在的地方。
 * 由 tests/unit/mode-links.test.ts 的靜態鎖把關。
 */

/** 這個模式的「目錄」叫什麼（賣什麼） */
export const catalogLabel = (businessType: BusinessType = 'LOCAL_SHOP'): string =>
  navLabel(MODE_PRESETS[businessType].catalogNavKey, businessType);

/** 這個模式的「訂單」叫什麼（誰買了） */
export const ordersLabel = (businessType: BusinessType = 'LOCAL_SHOP'): string =>
  navLabel(MODE_PRESETS[businessType].ordersNavKey, businessType);

/**
 * 文案裡的名詞佔位符解析。
 *
 * i18n 檔把跨頁引用寫成 `{catalog}` / `{orders}` / `{navBooking}`，頁面在
 * **render 期**用當下的 businessType 呼叫本函式展開。之所以不在 i18n 檔直接算，
 * 是因為 i18n 是模組層常數——模組求值早於 AppShell 決定模式，先算會凍住錯的模式
 * （CLAUDE.md「mode-aware mock data」同一個陷阱）。
 */
export const resolveNavTerms = (
  text: string,
  businessType: BusinessType = 'LOCAL_SHOP',
): string =>
  text
    .replace(/\{catalog\}/g, catalogLabel(businessType))
    .replace(/\{orders\}/g, ordersLabel(businessType))
    .replace(/\{navBooking\}/g, navLabel('navBooking', businessType));
