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
