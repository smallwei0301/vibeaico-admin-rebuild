import { nav, resolveNavTerms } from '@/i18n/zh-TW/nav';
import type { BusinessType } from '@/config/modes';
import type { SetupStatus } from '@/lib/types';

type SetupStepKey = SetupStatus['steps'][number]['key'];

/**
 * 儀表板（/tenant/dashboard）文案
 * 內容依 docs/specs/dashboard.json 的 headings / cards / statCards / alerts /
 * buttons / jsStrings 逐字收錄，措辭與原站一致。
 */
export const dashboardPage = {
  title: '儀表板',
  metaTitle: '儀表板 - 店家後台',

  /* ------------------------------------------------ 「3 分鐘開始收單」引導卡 */
  focus: {
    title: '3 分鐘開始收單',
    close: '略過',
    step1Badge: '1',
    step2Badge: '2',
    /** 原站步驟標題由 JS 動態產生，spec 未收錄，依按鈕語意重建 */
    /** `{catalog}` 由頁面在 render 期依當下模式展開（14 分冊 §8.13） */
    step1Title: '確認{catalog}與價格',
    step1Action: '去修改',
    step2Title: '複製預約網址，分享給顧客',
    step2Locked: '先完成第 1 步',
    step2Action: '複製',
    readyBanner: '你的預約頁已可以收單：',
    readyOpen: '開啟',
    viewPublicPage: '查看公開頁面',
    firstCoupon: '發第一張票券',
    customDesign: '自訂店面設計',
  },

  /* ------------------------------------------------------------ 設定進度卡 */
  setup: {
    title: '快速開始設定您的店家',
    progressLabel: '設定進度',
    percent: (p: number) => `${p}%`,
    steps: {
      SHOP_INFO: '完善店家資訊',
      STAFF: '設定員工資料',
      SERVICE: '設定{catalog}',
      BUSINESS_HOURS: '設定營業時間',
      LINE_BOT: '連接 LINE Bot',
    },
    done: '已完成',
    todo: '尚未完成',
  },

  /**
   * 設定步驟的**業態別**用字（同 nav.ts 的 navLabel 慣例）。
   *
   * 上面的 steps 是共用預設值；嚮導的目錄是行程而不是服務項目，員工是嚮導，
   * 沿用預設會叫他去一個他選單裡根本不存在的頁面。
   *
   * 目錄名稱本身已改用 `{catalog}` 佔位符（setupStepLabel 會展開成該模式的
   * 目錄名：LOCAL_SHOP 服務項目／GUIDE 行程與方案／CLINIC 診療項目），
   * `SERVICE` 步驟因此不需要 CLINIC 覆寫——`{catalog}` 展開已經是「設定診療
   * 項目」。這裡只列**展開後仍不對**的鍵，目前只剩員工稱呼（14 分冊 §8.17）。
   */
  stepOverrides: {
    GUIDE: {
      STAFF: '設定嚮導資料',
    },
    CLINIC: {
      STAFF: '設定醫師資料',
    },
  } as Record<string, Partial<Record<SetupStepKey, string>>>,

  /* ------------------------------------------------------------ 頁面警示區 */
  cutoffExpired: {
    title: (date: string) => `預約截止日期已過（${date}）`,
    body: '顧客目前無法透過 LINE / 公開頁面預約任何日期。請前往店家設定更新或清除截止日。',
    action: '前往設定',
  },

  expiredFeatures: {
    title: '功能訂閱已到期',
    body: '相關的票券已暫停、商品已下架（顧客暫時看不到）。你的設定與資料都完整保留，',
    bodyStrong: '續訂後系統會自動恢復原狀',
    bodyEnd: '。',
  },

  expiringFeatures: {
    title: '功能訂閱即將到期',
    body: '以下功能將在 10 天內到期，請及時續訂以免影響使用',
    action: '前往續訂',
    expiresToday: '今日到期',
    expiresInDays: (n: number) => `${n} 天後到期`,
  },

  /** LINE 官方帳號免費推播額度用盡（原站 border-danger 卡片） */
  pushQuotaExhausted: {
    title: 'LINE 推送額度已用盡',
    body:
      '您的 LINE 官方帳號本月免費推播額度（200 則）已用完，預約通知、行銷推播等將無法送達顧客。',
    upgradeHint:
      '請到 LINE 官方帳號管理後台 →「設定」→「帳務專區」→「推廣方案」升級方案：',
    upgradePlan: '中用量 NT$800/月（3,000 則）',
    orReset: '或等下個月 1 號重置。',
  },

  /** 系統推送額度警示（pushQuotaWarningCard） */
  pushQuotaWarning: {
    over80: '系統推送額度使用超過 80%',
    almostOut: '系統推送額度即將用盡',
    usage: (used: number, quota: number, pct: number, remaining: number) =>
      `本月已使用 ${used}/${quota} 則（${pct}%），剩餘 ${remaining} 則。額度用完後預約通知、行銷推播等將無法發送。`,
    resetHint: '額度將於每月 1 號重置。如需更多額度請聯繫客服。',
  },

  /* -------------------------------------------------------------- 統計卡 */
  stats: {
    todayBookings: '今日預約',
    pendingBookings: '待確認',
    monthRevenue: '本月營收',
    totalCustomers: '總顧客數',
    pushQuota: '系統推送額度',
    linePlatform: 'LINE 平台',
    quotaValue: (used: number, total: number) => `${used} / ${total}`,
    exhausted: '已用盡',
    linePlanLite: '輕量版',
    linePlanPro: '專業版',
    lineNotConfigured: '未設定 LINE',
    /** 已填 token；LINE 未開放查詢官方帳號方案，因此只陳述我們真的知道的事 */
    lineConfigured: '已設定',
    unknown: '未知',
  },

  /* ------------------------------------------------------ 行事曆同步推廣卡 */
  calendarSyncPromo: {
    title: '把預約自動同步到您的 Google / Apple 行事曆',
    body: '一次設定，所有新預約自動出現在您平常看的行事曆上',
    action: '立即設定',
    dismiss: '關閉',
  },

  /* -------------------------------------------------------------- 警示卡 */
  alertCards: {
    unprocessedBookings: {
      title: '未處理預約',
      body: (n: number) => `${n} 筆預約已過期但尚未處理`,
      action: '前往處理',
    },
    lowStock: {
      title: '庫存低量警告',
      body: (n: number) => `${n} 項商品低於安全庫存`,
      action: '查看',
    },
    atRiskCustomers: {
      title: '顧客流失預警',
      body: (n: number) => `${n} 位顧客超過 30 天未回訪`,
      action: '查看',
    },
  },

  /* -------------------------------------------------------------- 快速操作 */
  quickActions: {
    title: '快速操作',
    /*
     * 原站 6 顆按鈕由樣板迴圈產生，spec 未逐字收錄；文案取用側邊欄既有文案。
     *
     * ⚠️ 這裡原本是 `newBooking: nav.bookings` 等 6 個模組層常數，取的是
     * LOCAL_SHOP 的字面值，嚮導看到的仍是「預約列表」「服務項目」。已改由頁面
     * 在 render 期呼叫 `navLabel/catalogLabel/ordersLabel(businessType)` 取得
     * （見 dashboard/page.tsx 的 buildQuickActions）。
     */
  },

  /* ---------------------------------------------------------- 公開預約網址 */
  publicUrl: {
    label: '您的公開預約網址：',
    copy: '複製',
    open: '開啟',
    copied: '已複製預約網址',
    copiedPage: '已複製預約頁網址',
    manualCopy: '請手動複製：',
    pendingShopCode: '（建立店家代碼後顯示）',
  },

  /* ------------------------------------------------------------ 今日預約 */
  todayBookings: {
    title: '今日預約',
    viewAll: '查看全部',
    columns: {
      time: '時間',
      customer: '顧客',
      service: '服務',
      staff: '員工',
      status: '狀態',
    },
    lineUser: '(LINE 用戶)',
    unassigned: '未指定',
    count: (n: number) => `${n} 筆`,
  },

  /* ------------------------------------------------------------ 最近活動 */
  recentActivity: {
    title: '最近活動',
    empty: '暫無活動記錄',
    /** 活動列文案（原站由 JS 依事件型別組字） */
    types: {
      BOOKING_CREATED: (name: string, service: string) => `${name} 預約了 ${service}`,
      BOOKING_CANCELLED: (name: string, service: string) => `${name} 取消了 ${service}`,
      BOOKING_COMPLETED: (name: string, service: string) => `${name} 完成了 ${service}`,
      CUSTOMER_CREATED: (name: string) => `${name} 加入成為新顧客`,
      ORDER_CREATED: (name: string, product: string) => `${name} 訂購了 ${product}`,
    },
  },

  /* -------------------------------------------------------- 員工業績（本月） */
  staffPerformance: {
    title: '員工業績（本月）',
    detail: '詳細',
    columns: {
      staff: '員工',
      bookings: '預約',
      completionRate: '完成率',
      revenue: '營收',
    },
    empty: '本月暫無資料',
  },

  /* ------------------------------------------------------------ 圖表區 */
  demoHint: {
    title: '還沒有資料嗎？先看看示範店家',
    body: '你的後台目前是全新的，各頁面都還沒有資料。可以從右上角的店家選單切換到「示範店家」，' +
      '看看有實際資料時各功能長什麼樣子；看完再切回自己的店開始設定。',
    dismiss: '知道了',
  },

  demoData: {
    title: '目前顯示的是示範資料',
    body: (n: number) => `我們依照你選的營運模式，先鋪了 ${n} 筆範例（服務／行程、員工、商品），` +
      '你可以直接改成自己的內容；不需要的話按右邊一鍵清空。',
    clear: '一鍵清空示範資料',
    clearing: '清除中…',
    confirmTitle: '清空示範資料？',
    confirmBody: '會移除所有名稱開頭仍是「[示範]」的服務／行程、員工與商品。' +
      '你自己建立或已改過名稱的資料不會被動到，也不會影響任何預約紀錄。',
    cleared: '示範資料已清空',
    clearFailed: '清空示範資料失敗：',
  },

  trialBanner: {
    title: '全功能試用中',
    bodyPrefix: '所有付費功能已為你開通，試用到 ',
    bodySuffix: '。試用期結束後未訂閱的功能會自動關閉，可到功能商店選擇要留下的功能。',
    cta: '看看功能商店',
  },

  weeklyTrend: {
    title: '本週預約趨勢',
    detailReport: '詳細報表',
    bookingCount: '預約數',
    revenue: '營收 (NT$)',
    tooltipBookings: '預約數：',
    tooltipRevenue: '營收：NT$ ',
    empty: '本週還沒有預約資料',
  },

  monthSource: {
    title: '本月預約來源',
    empty: '本月尚無預約，有預約後這裡會顯示來源分布',
    unknown: '未知',
    manual: '後台建立',
    publicPage: '公開頁面',
  },

  /* ----------------------------------------------------- 功能名稱對照（提醒用） */
  featureNames: {
    BASIC_REPORT: nav.reports,
    MEMBERSHIP_SYSTEM: nav.membership_levels,
    COUPON_SYSTEM: nav.coupons,
    PRODUCT_SALES: nav.products,
    INVENTORY: nav.inventory,
    KEYWORD_REPLY: nav.keyword_replies,
    AI_ASSISTANT: nav.ai_settings,
    PORTFOLIO_SHOWCASE: nav.portfolio,
    CUSTOM_RICH_MENU: nav.rich_menu_design,
    EXTRA_PUSH: '加購推播額度',
  },

  /* ------------------------------------------------------------ 載入失敗 */
  errors: {
    stats: '載入統計資料失敗:',
    alerts: '載入提醒失敗:',
    setupStatus: '載入設定狀態失敗:',
    todayBookings: '載入今日預約失敗:',
    recentActivity: '載入最近活動失敗:',
    staffPerformance: '載入員工業績失敗:',
    weekly: '載入週統計失敗:',
    loadFailed: '載入失敗',
  },
} as const;

/**
 * 設定步驟顯示文字：有業態別覆寫就用覆寫，否則用共用預設值。
 * 與 nav.ts 的 navLabel(key, businessType) 同一套慣例。
 */
export function setupStepLabel(key: SetupStepKey, businessType?: string): string {
  const raw = (businessType && dashboardPage.stepOverrides[businessType]?.[key])
    ?? dashboardPage.setup.steps[key];
  return resolveNavTerms(raw, businessType as BusinessType | undefined);
}
