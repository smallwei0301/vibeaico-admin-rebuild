/**
 * 功能商店（/tenant/feature-store）文案
 * -----------------------------------------------------------------------------
 * 分類篩選、套裝方案、每張功能卡（名稱／說明／位置／有無此功能的對照清單）、
 * 訂閱／取消／恢復流程與所有 toast，均逐字取自原站 DOM 與 inline JS
 * （docs/specs/feature-store.json，jsStrings 共 235 條）。
 *
 * 全站共用的「回報問題」「AI 客服助理」widget 文案不重複收錄，見 i18n/zh-TW/common.ts。
 */
export const featureStorePage = {
  title: '功能商店',
  metaTitle: '功能商店 - 店家後台',

  /* --------------------------------------------------------------- 餘額 */
  balance: {
    empty: '餘額： - 點',
    label: (points: string) => `餘額：${points} 點`,
  },

  /* ----------------------------------------------------------- 分類篩選 */
  filters: {
    ALL: '全部',
    BOOKING: '預約',
    CUSTOMER: '顧客',
    MARKETING: '行銷',
    SHOP: '商品',
    LINE: 'LINE',
    SYSTEM: '報表・系統',
  },
  onlyUnsubscribed: '只看未訂閱',

  /* --------------------------------------------------- 訂閱方式說明 alert */
  howTo: {
    heading: '訂閱方式',
    items: [
      { label: '套裝方案', text: '：輕量版（$399/月）或專業版（$799/月），一次開通多項功能更划算' },
      { label: '單買功能', text: '：也可個別訂閱需要的功能（$49~$249/月）' },
      { label: '升級', text: '：輕量版可隨時升級為專業版，剩餘天數不退點' },
      { label: '方案+單買共存', text: '：單買的功能獨立計算到期時間，取消方案不影響單買的功能' },
    ],
    topupLead: '點數不足時可前往',
    topupLink: '「點數管理」',
    topupTail: '儲值（1 點 = NT$1）',
  },

  /* --------------------------------------------------------------- 區塊 */
  sections: {
    bundles: '套裝方案（更划算）',
    individual: '個別功能',
    free: '免費功能',
    paid: '付費功能',
  },

  /* ----------------------------------------------------------- 套裝方案 */
  bundles: {
    allFreeNotice: '您的所有功能已由平台永久免費開通，無需訂閱套裝方案。',
    items: [
      {
        key: 'LITE',
        name: '輕量版',
        priceLabel: '$399/月',
        saveLabel: '省 18%',
        summary: '無限員工、自動提醒、進階報表、集點系統、會員等級',
        audience: '',
      },
      {
        key: 'PRO',
        name: '專業版',
        priceLabel: '$799/月',
        saveLabel: '省 38%',
        summary: '全部 18 項付費功能',
        audience: '適合中大型店家',
      },
    ],
  },

  /* ------------------------------------------------------------ 功能卡 */
  card: {
    freeTag: '免費功能',
    paidTag: '付費功能',
    subscribed: '已訂閱',
    cancelled: '已取消',
    cancelledUsable: '已取消（到期前可用）',
    grantedActive: '已啟用（平台贈送）',
    permanentFree: '永久免費',
    permanentFreeGranted: '永久免費（平台贈送）',
    subscribe: '立即訂閱',
    renew: '續訂',
    cancel: '取消',
    restore: '恢復',
    period: (start: string, end: string) => `訂閱期間：${start} ~ ${end}`,
    expiry: (end: string, daysLeft: number) => `到期：${end}（剩 ${daysLeft} 天）`,
    daysLeft: (daysLeft: number) => `（剩餘 ${daysLeft} 天）`,
    noDescription: '暫無說明',
    priceLabel: (points: number) => `${points} 點/月`,
    whereLabel: '後台位置：',
    lineWhereLabel: 'LINE 位置：',
    beforeLabel: '沒有這個功能時',
    afterLabel: '訂閱後可以',
  },

  /* ------------------------------------------------------ 訂閱 modal */
  subscribe: {
    title: (name: string) => `訂閱「${name}」`,
    monthsLabel: '訂閱期間',
    oneMonth: '1 個月',
    months: (m: number) => `${m} 個月`,
    monthsOption: (label: string, total: number) => `${label} — ${total} 點`,
    confirm: '確認訂閱',
  },

  /* ------------------------------------------------------ 點數不足 modal */
  insufficient: {
    title: '點數不足',
    intro: (name: string, months: number, needPoints: string) =>
      `你剛才想訂閱「${name}」${months} 個月（${needPoints} 點）。\n\n`,
    enough: (balance: string) => `目前餘額 ${balance} 點，已經足夠了，要現在完成訂閱嗎？`,
    topupCta: (suggest: string) => `前往儲值 ${suggest} 點`,
  },

  /* ------------------------------------------------ 加購前提醒（EXTRA_PUSH）*/
  purchaseNotice: {
    title: '加購前提醒',
    ok: '我已了解，繼續購買',
  },

  /* --------------------------------------------------------------- 確認 */
  confirm: {
    subscribeTitle: '訂閱功能',
    subscribe: (name: string) => `確定要訂閱「${name}」功能嗎？`,
    cancelTitle: '取消訂閱',
    cancel: (name: string) => `確定要取消訂閱「${name}」功能嗎？\n\n`,
    cancelKeepUntilExpiry:
      '取消後功能在到期日前仍可繼續使用，到期後將自動停用。已扣除的點數不予退還。',
    cancelImmediately: '取消後將無法使用此功能，但已扣除的點數不予退還。',
    restoreTitle: '恢復訂閱',
    restore: (name: string) =>
      `確定要恢復「${name}」訂閱嗎？\n\n恢復後將繼續使用至原到期日，不會額外扣除點數。`,
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    activated: (name: string) => `「${name}」功能已開通！`,
    renewed: (name: string, months: number) => `「${name}」已成功續訂 ${months} 個月！`,
    restored: (name: string) => `「${name}」訂閱已恢復！`,
    cancelled: (name: string) => `已取消訂閱「${name}」功能`,
    cancelledUsable: (name: string) => `已取消訂閱「${name}」，功能在到期前仍可使用`,
    couponsRestored: (rc: number) => `${rc} 張票券已自動恢復發布`,
    productsRestored: (rp: number) => `${rp} 項商品已自動重新上架`,
    restoreSideEffectFailed:
      '\n⚠️ 但票券/商品自動恢復失敗，請到票券管理／商品管理手動恢復',
    subscribeFailed: '訂閱失敗:',
    subscribeFailedFull: '訂閱失敗：',
    cancelFailed: '取消訂閱失敗:',
    cancelFailedFull: '取消訂閱失敗：',
    restoreFailed: '恢復訂閱失敗:',
    restoreFailedFull: '恢復訂閱失敗：',
    loadFeaturesFailed: '載入功能列表失敗:',
    deepLinkFailed: 'feature deep link 處理失敗（忽略）:',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '這個分類目前沒有符合條件的功能',
    description: '換一個分類，或取消勾選「只看未訂閱」看看全部功能。',
    loading: '載入功能列表中...',
  },

  /* ========================================================================
     每個功能的完整文案
     name / summary（效益）/ where（後台位置）/ lineWhere（LINE 位置）
     before（沒有這個功能時）/ after（訂閱後可以）
     ====================================================================== */
  features: {
    /* ------------------------------------------------------------ 免費 */
    ONLINE_BOOKING: {
      name: '線上預約',
      summary: '24 小時線上預約，不漏單',
      where: '側邊欄 → 預約管理',
      lineWhere: '主選單 → 開始預約',
      before: ['電話/現場接受預約'],
      after: [
        '線上接受顧客預約',
        '顧客可自助取消預約',
        '自動檢查時段衝突',
        '預約狀態追蹤管理',
        '預約紀錄完整保存',
      ],
    },
    SERVICE_CATALOG: {
      name: '服務項目',
      summary: '清楚展示服務內容與價格',
      where: '側邊欄 → 服務管理',
      lineWhere: '預約流程 → 選擇服務',
      before: ['口頭說明服務項目'],
      after: [
        '建立服務項目與分類',
        '設定服務時長與價格',
        '支援分類管理（如：髮型、美甲、攝影）',
        '指定可服務的員工',
        '顧客可在 LINE 選擇',
      ],
    },
    CUSTOMER_BASIC: {
      name: '顧客管理',
      summary: '雲端管理，隨時查詢',
      where: '側邊欄 → 顧客管理',
      lineWhere: '',
      before: ['紙本或 Excel 管理顧客'],
      after: ['顧客基本資料管理', '顧客資料自動建檔', 'LINE 綁定自動同步'],
    },
    STAFF_BASIC: {
      name: '員工管理',
      summary: '員工基本資料管理',
      where: '側邊欄 → 員工管理',
      lineWhere: '',
      before: [],
      after: ['員工基本資料管理', '最多可新增 3 位員工'],
    },

    /* ------------------------------------------------------------ 付費 */
    UNLIMITED_STAFF: {
      name: '無限員工',
      summary: '突破 3 位員工限制',
      where: '側邊欄 → 員工管理',
      lineWhere: '',
      before: ['最多只能新增 3 位員工'],
      after: ['無限制員工數量', '員工基本資料管理'],
    },
    SHIFT_MANAGEMENT: {
      name: '班表管理',
      summary: '輕鬆設定員工班表',
      where: '側邊欄 → 員工管理',
      lineWhere: '',
      before: ['無法管理員工排班'],
      after: [
        '每週排班時間設定',
        '每位員工可獨立設定排班',
        '請假管理功能',
        '完整的請假管理功能',
      ],
    },
    BOOKING_REMINDER: {
      name: '預約提醒',
      summary: '系統自動提醒，降低爽約率',
      where: '設定 → 通知設定',
      lineWhere: '',
      before: ['需手動提醒顧客預約'],
      after: [
        '預約前自動發送 LINE 提醒',
        '自訂提醒時間（如：前 1 天、前 2 小時）',
        '每日早上 9:00 自動發送',
        '減少顧客爽約率',
        '自動推播提醒訊息',
      ],
    },
    BIRTHDAY_GREETING: {
      name: '生日祝福',
      summary: '自動送祝福，提升顧客好感',
      where: '設定 → 通知設定',
      lineWhere: '',
      before: ['容易遺忘顧客生日'],
      after: [
        '自動發送生日祝福訊息',
        '自訂祝福訊息內容',
        '可附帶生日優惠券',
        '生日當天自動發送票券/點數',
        '自動推播生日祝福',
      ],
    },
    CUSTOMER_RECALL: {
      name: '顧客喚回',
      summary: '主動喚回，提升回訪率',
      where: '設定 → 通知設定',
      lineWhere: '',
      before: ['流失顧客難以追蹤'],
      after: [
        '自動偵測久未到訪顧客',
        '自訂未到訪天數門檻',
        '發送喚回通知訊息',
        '每日下午 2:00 自動發送',
        '久未到訪時自動發送票券/點數',
        '自動推播喚回訊息',
      ],
    },
    POINT_SYSTEM: {
      name: '集點系統',
      summary: '自動集點，提升顧客回訪率',
      where: '設定 → 點數設定',
      lineWhere: '會員資訊 → 點數餘額',
      before: ['無法追蹤顧客累積消費'],
      after: [
        '顧客完成預約自動累積點數',
        '自訂消費金額兌換比例',
        '點數可折抵消費金額',
        '顧客可在 LINE 查看點數餘額',
        '點數餘額與交易紀錄',
      ],
    },
    ADVANCED_CUSTOMER: {
      name: '進階顧客管理',
      summary: '快速篩選目標客群，精準行銷',
      where: '側邊欄 → 顧客管理',
      lineWhere: '顧客詳情',
      before: ['顧客資料只能逐筆查看'],
      after: [
        '顧客標籤分類管理',
        '自訂文字標籤和顏色',
        '依消費金額/次數篩選',
        '匯出顧客名單 Excel',
        '顧客消費分析與分群',
        '批次發送行銷訊息',
      ],
    },
    EMAIL_NOTIFICATION: {
      name: 'Email 通知',
      summary: '不開後台也能收到 Email 通知',
      where: '設定 → 通知設定 → Email 通知',
      lineWhere: '',
      before: ['只能在後台看 SSE 即時通知'],
      after: [
        '新預約建立自動 Email 通知店家',
        '預約確認/取消即時 Email 通知',
        '員工被指派預約自動收到 Email',
        '精美 HTML 郵件，含完整預約資訊',
        '自動發送預約通知信',
        '接收指派預約通知',
        '店家信箱',
        '員工信箱',
      ],
    },
    BASIC_REPORT: {
      name: '營運報表',
      summary: '深度分析，協助經營決策',
      where: '側邊欄 → 營運報表',
      lineWhere: '',
      before: ['手動計算營業數據', '僅有基本統計數據'],
      after: [
        '每日/每週/每月統計',
        '營收總覽',
        '熱門服務排行',
        '員工業績排行榜',
        '預約數量與完成率',
        '服務熱門度趨勢圖',
        '營收趨勢預測',
        '即時查看營運狀況',
      ],
    },
    MEMBERSHIP_SYSTEM: {
      name: '會員等級',
      summary: '區分 VIP 顧客，提供差異化服務',
      where: '側邊欄 → 顧客管理 → 會員等級',
      lineWhere: '會員資訊 → 等級顯示',
      before: ['所有顧客享有相同待遇'],
      after: [
        '建立多個會員等級（如：銀卡、金卡、白金）',
        '設定升級門檻（累計消費/預約次數）',
        '不同等級享有不同優惠',
        '自動升降級通知',
      ],
    },
    COUPON_SYSTEM: {
      name: '票券管理',
      summary: '可建立多種票券，LINE 自動發放核銷',
      where: '側邊欄 → 店家營運 → 票券管理',
      lineWhere: '主選單 → 領取票券',
      before: ['無法建立任何優惠票券'],
      after: [
        '建立折扣券、現金券、免費服務券',
        '設定限量發放和使用期限',
        '顧客可在 LINE 領取票券',
        '後台一鍵核銷票券',
      ],
    },
    PRODUCT_SALES: {
      name: '商品管理',
      summary: '顧客可隨時透過 LINE 瀏覽購買',
      where: '側邊欄 → 商品管理',
      lineWhere: '主選單 → 瀏覽商品',
      before: ['只能現場銷售商品'],
      after: ['在 LINE 上展示商品目錄', '顧客可瀏覽並下單購買', '支援商品分類管理'],
    },
    INVENTORY: {
      name: '庫存異動',
      summary: '庫存追蹤與提醒',
      where: '側邊欄 → 商品管理',
      lineWhere: '',
      before: [],
      after: ['庫存追蹤與提醒'],
    },
    KEYWORD_REPLY: {
      name: '關鍵字回覆',
      summary: '顧客打你設定的關鍵字時自動回覆',
      where: '側邊欄 → 店家營運 → 關鍵字回覆',
      lineWhere: '',
      before: ['LINE 官方自動回應與 Bot 搶回覆互相打架，只能二擇一'],
      after: [
        '自訂關鍵字與回覆內容（文字/圖片/連結按鈕）',
        '每店最多 20 組，隨時啟用/停用',
        '店家設定優先於系統預設，可完全取代 LINE 官方自動回應',
        '可設定關鍵字觸發個資收集（不綁預約流程）',
        'Bot 內建關鍵字回覆，關掉官方自動回應也保有關鍵字體驗',
      ],
    },
    AI_ASSISTANT: {
      name: 'AI 客服',
      summary: 'AI 代勞，節省時間精力',
      where: '',
      lineWhere: '顧客發送訊息時自動回覆',
      before: ['需人工回覆每則訊息'],
      after: [
        'AI 自動回答顧客常見問題',
        '根據店家資訊智慧回覆',
        '顧客發送訊息時自動回覆',
        '無法回答時自動引導至人工',
        '24 小時不間斷服務',
      ],
    },
    PORTFOLIO_SHOWCASE: {
      name: '作品展示',
      summary: '顧客隨時瀏覽，提升預約意願',
      where: '側邊欄 → 店家營運 → 作品展示',
      lineWhere: '主選單 → 作品展示',
      before: ['無法線上展示過往作品'],
      after: [
        '上傳精選作品照片與說明',
        '顧客透過 LINE 即可瀏覽作品集',
        '自訂排序與啟用/停用控制',
      ],
    },
    CUSTOM_RICH_MENU: {
      name: '選單設計',
      summary: '完全自訂設計，打造專屬品牌選單',
      where: '選單設計（側邊欄）',
      lineWhere: '顧客打開聊天室即可看到',
      before: ['只能使用系統預設 5 種配色或上傳背景圖（系統疊加文字）'],
      after: [
        '每格獨立上傳圓形圖示（手繪風等）',
        '支援大尺寸選單（3 行以上佈局）',
        '點擊格子可彈出自訂 Flex 輪播卡片',
        '上傳自訂背景圖片，打造品牌風格',
      ],
    },
    EXTRA_PUSH: {
      name: '加購推播額度',
      summary: '適合預約量大或行銷活動頻繁的店家',
      where: '儀表板 → 推送額度',
      lineWhere: '',
      before: ['每月 200 則推播額度'],
      after: [
        '基本額度 200 則/月，加購後增加至 700 則',
        '每月 700 則，搭配 LINE 中用量方案（3,000 則）更靈活',
        '涵蓋預約通知、行銷推播、自動提醒等',
      ],
      /** 加購前提醒（原站在按下訂閱前先跳這段） */
      noticeWarning: '⚠️ LINE 免費方案上限 200 則/月，需先升級 LINE 推廣方案',
      noticeWhere: '官方帳號管理後台 → 設定 → 帳務專區 → 推廣方案',
    },
  },
} as const;
