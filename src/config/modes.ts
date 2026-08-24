import { Compass, Hospital, Store, type LucideIcon } from 'lucide-react';

/**
 * 業態模式（Business Modes）— 規格見 docs/integration/13-BUSINESS-MODES.md
 * -----------------------------------------------------------------------------
 * 店家註冊時三選一，決定後台的**選單佈局、名詞、預設功能包、LINE 內建關鍵字組、
 * 商店頁預設區塊**。
 *
 * ⚠️ 鐵則：模式換的是門牌，不是倉庫。
 *    資料表層 services 與 trips/trip_plans/trip_departures 維持分開
 *    （時段×服務人員 與 團次×名額 是兩種庫存邏輯，見 10 分冊 §0）。
 *    模式只作用在「顯示什麼、叫什麼名字」。
 *
 * ⚠️ 所有依模式分支的程式**只准讀這個檔**，不准在頁面 / nav / webhook 裡
 *    散寫 `if (businessType === 'GUIDE')`。要加行為就在 preset 加欄位。
 */

export const BUSINESS_TYPES = ['LOCAL_SHOP', 'GUIDE', 'CLINIC'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export type ModePreset = {
  /** 註冊頁卡片用 */
  icon: LucideIcon;
  /** 「賣的東西」槽位：側邊欄該用哪個頁面當服務項目 */
  catalogHref: string;
  /** 「收的單」槽位 */
  ordersHref: string;
  /**
   * 這個模式**不顯示**的側邊欄葉節點 key（config/nav.ts 的 leaf key）。
   * 資料不會被刪，只是不顯示 —— 換回模式即可再看到。
   */
  hiddenNavKeys: readonly string[];
  /** 開店時自動贈與的功能旗標（source='GRANTED'，見 09 分冊） */
  grantedFeatures: readonly string[];
  /** 服務人員的預設稱呼（寫進 tenant_settings.basic.staffTerm） */
  staffTerm: string;
  /** LINE 內建關鍵字組：這個模式額外啟用的組（見 06 分冊、keyword-replies i18n） */
  keywordGroups: readonly string[];
  /** 公開商店頁的預設區塊順序（11 分冊 catalog 端點） */
  shopSections: readonly string[];
  /**
   * LINE 圖文選單（Rich Menu）的預設六格。
   *
   * 每格的 text 會同時是 LINE message action 送出的文字，因此**必須**對得上
   * webhook 的內建指令與該模式的關鍵字組（keywordGroups）——嚮導按「服務項目」
   * 送出的文字沒有任何 handler 認得，等於按了沒反應。
   *
   * 這裡放進 preset 而不是寫在 rich-menu route 裡，是因為 CLAUDE.md 明訂
   * MODE_PRESETS 是所有「因模式而異」決策的唯一真相；六格文案正是這種決策。
   */
  richMenuCells: readonly { label: string; text: string }[];
};

export const MODE_PRESETS: Record<BusinessType, ModePreset> = {
  LOCAL_SHOP: {
    icon: Store,
    catalogHref: '/tenant/services',
    ordersHref: '/tenant/bookings',
    hiddenNavKeys: ['trips', 'tour_orders', 'clinic_queue'],
    grantedFeatures: [],
    staffTerm: '服務人員',
    keywordGroups: [],
    shopSections: ['SERVICES', 'PRODUCTS', 'PORTFOLIO'],
    richMenuCells: [
      { label: '立即預約', text: '預約' },
      { label: '我的預約', text: '我的預約' },
      { label: '服務項目', text: '服務項目' },
      { label: '會員卡', text: '會員卡' },
      { label: '優惠票券', text: '優惠' },
      { label: '聯絡我們', text: '聯絡我們' },
    ],
  },
  GUIDE: {
    icon: Compass,
    catalogHref: '/tenant/trips',
    ordersHref: '/tenant/tour-orders',
    // 嚮導不需要「時段×員工」那一套
    hiddenNavKeys: [
      'services', 'bookings', 'recurring_bookings',
      'block_times', 'shifts', 'clinic_queue',
    ],
    grantedFeatures: ['TOUR_MODULE'],
    staffTerm: '導遊',
    keywordGroups: ['TRIP', 'DEPARTURE'],
    shopSections: ['TRIPS', 'PORTFOLIO'],
    // 嚮導賣的是行程與團次，不是「時段×員工」的預約；六格照這個語彙走
    richMenuCells: [
      { label: '所有行程', text: '行程' },
      { label: '近期團次', text: '團次' },
      { label: '我的訂單', text: '我的訂單' },
      { label: '常見問題', text: '常見問題' },
      { label: '優惠票券', text: '優惠' },
      { label: '聯絡嚮導', text: '聯絡我們' },
    ],
  },
  CLINIC: {
    icon: Hospital,
    catalogHref: '/tenant/services',
    ordersHref: '/tenant/bookings',
    hiddenNavKeys: ['trips', 'tour_orders', 'portfolio'],
    grantedFeatures: [],
    staffTerm: '醫師',
    keywordGroups: [],
    shopSections: ['SERVICES'],
    richMenuCells: [
      { label: '線上掛號', text: '預約' },
      { label: '我的掛號', text: '我的預約' },
      { label: '看診項目', text: '服務項目' },
      { label: '看診進度', text: '看診進度' },
      { label: '門診時間', text: '營業時間' },
      { label: '聯絡診所', text: '聯絡我們' },
    ],
  },
};

/**
 * 斜槓店家：模式是**預設**不是牢籠。
 * 店家可在設定頁加開其他模組，加開的模組其葉節點不再被隱藏。
 * 回傳「實際要隱藏的 key」。
 */
export function hiddenNavKeys(
  businessType: BusinessType,
  extraModules: readonly BusinessType[] = [],
): string[] {
  const hidden = new Set(MODE_PRESETS[businessType].hiddenNavKeys);
  for (const m of extraModules) {
    // 加開的模組會用到的頁面 = 該模組沒有隱藏的頁面 → 從隱藏清單移除
    for (const key of hidden) {
      if (!MODE_PRESETS[m].hiddenNavKeys.includes(key)) hidden.delete(key);
    }
  }
  return [...hidden];
}
