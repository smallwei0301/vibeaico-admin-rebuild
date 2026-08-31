/**
 * 全站共用文案（zh-TW）
 * 所有 UI 字串一律走字典，不寫死在元件裡 —— 這是 i18n 與文案審查的單一入口。
 */
export const common = {
  brand: 'VibeAI',
  brandFull: 'VibeAI管理系統',
  productTagline: 'LINE 智慧預約系統',
  backofficeName: '店家後台管理系統',
  copyright: 'Copyright © 瓦比艾有限公司 VibeAI Co., Ltd. 2026',
  titleSuffix: '店家後台',

  /* ---- 動作 ---- */
  create: '新增',
  edit: '編輯',
  delete: '刪除',
  save: '儲存',
  saveSettings: '儲存設定',
  saving: '儲存中...',
  cancel: '取消',
  close: '關閉',
  confirmText: '確定',
  submit: '送出',
  submitting: '送出中...',
  search: '搜尋',
  clear: '清除',
  clearSearch: '清除搜尋',
  filter: '篩選',
  reset: '重設',
  refresh: '重新整理',
  copy: '複製',
  copied: '已複製',
  open: '開啟',
  download: '下載',
  upload: '上傳',
  preview: '預覽',
  detail: '詳情',
  detailPlural: '詳細',
  viewAll: '查看全部',
  view: '查看',
  back: '返回',
  next: '下一步',
  prev: '上一步',
  more: '更多',
  duplicate: '複製一份',
  enable: '啟用',
  disable: '停用',
  publish: '發布',
  pause: '暫停',
  resume: '恢復',
  end: '結束',
  retry: '重試',
  processing: '處理中...',
  exportExcel: '匯出 Excel',
  exportCsv: '匯出 CSV',

  /* ---- 狀態 ---- */
  loading: '載入中...',
  badgeLoading: '查詢中',
  noData: '目前沒有資料',
  noResult: '找不到符合條件的資料',
  required: '必填',
  optional: '選填',
  requiredHint: '標示 * 的欄位為必填項目',
  enabled: '已啟用',
  disabled: '已停用',
  notConfigured: '尚未設定',
  all: '全部',
  yes: '是',
  no: '否',
  none: '無',

  /* ---- 確認彈窗（原站每頁共用的 #confirmModal）---- */
  confirm: {
    title: '確認',
    message: '確定要執行此操作嗎？',
    ok: '確定',
    deleteMessage: '確定要刪除嗎？此操作無法復原。',
  },

  /* ---- 分頁 ---- */
  pagination: {
    range: (from: number, to: number, total: number) =>
      `顯示第 ${from}–${to} 筆，共 ${total} 筆`,
    pageOf: (page: number, total: number) => `第 ${page} / ${total} 頁`,
    prev: '上一頁',
    next: '下一頁',
    perPage: '每頁筆數',
  },

  /* ---- 訊息 ---- */
  message: {
    saveSuccess: '儲存成功',
    saveFailed: '儲存失敗，請稍後再試',
    createSuccess: '新增成功',
    updateSuccess: '更新成功',
    deleteSuccess: '刪除成功',
    deleteFailed: '刪除失敗',
    copySuccess: '已複製到剪貼簿',
    loadFailed: '載入失敗，請重新整理頁面',
    networkError: '網路連線異常，請檢查網路後再試',
    unauthorized: '登入已逾期，請重新登入',
    forbidden: '您沒有權限執行此操作',
  },

  /* ---- 驗證 ---- */
  validation: {
    required: '此欄位為必填',
    email: '請輸入有效的電子郵件格式',
    phone: '請輸入有效的電話號碼',
    phone10: '請輸入 10 位數電話號碼',
    number: '請輸入數字',
    min: (n: number) => `不可小於 ${n}`,
    max: (n: number) => `不可大於 ${n}`,
    maxLength: (n: number) => `不可超過 ${n} 個字`,
    passwordMismatch: '兩次輸入的密碼不一致',
    shopCode: '僅限小寫英文、數字、連字號（-）',
  },

  /* ---- 頂部列 ---- */
  topbar: {
    myShops: '我的店家',
    switchShop: '切換店家',
    shopSettings: '店家設定',
    installApp: '安裝手機 App',
    enablePush: '開啟新預約推播',
    logout: '登出',
    userFallback: '使用者',
    setupProgress: '設定進度',
    unknownValue: '--',
    setupProgressUnknown: '尚未取得',
    setupProgressUnknownHint: '目前讀不到設定進度，數字不是 0，是還不知道。點進店家設定可以看每一步的狀態。',
    toggleSidebar: '切換選單',
  },

  /* ---- 回報問題（全站共用 modal）---- */
  bugReport: {
    title: '回報問題',
    category: '問題類別',
    categoryPlaceholder: '請選擇類別',
    categories: {
      BUG: '功能異常',
      DISPLAY: '顯示問題',
      USABILITY: '操作困難',
      OTHER: '其他',
    },
    subject: '問題標題',
    description: '詳細說明',
    screenshot: '附上截圖（選填）',
    screenshotHint: '支援 PNG、JPG、GIF、WebP，建議小於 5MB',
    contactEmail: '聯絡信箱',
    submit: '送出回報',
  },

  /* ---- AI 客服助理（全站右下角）---- */
  supportChat: {
    title: 'AI 客服助理',
    greeting:
      '您好！我是 VibeAI 平台的 AI 客服助理，可以幫您查 LINE 狀態、推播額度、最近異常日誌，或回答後台使用問題。請問需要什麼協助？',
    placeholder: '輸入您的問題...',
    send: '送出',
  },

  /* ---- 預約狀態 ---- */
  bookingStatus: {
    PENDING: '待確認',
    CONFIRMED: '已確認',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    NO_SHOW: '爽約',
  },
  paymentStatus: {
    UNPAID: '未付款',
    PAID_ONLINE: '線上已付',
    PAID_OFFLINE: '現場已付',
    REFUNDED: '已退款',
  },
  bookingSource: {
    LINE: 'LINE',
    PUBLIC_PAGE: '公開頁',
    MANUAL: '後台建立',
    RECURRING: '定期預約',
  },
  gender: {
    '': '未指定',
    MALE: '男',
    FEMALE: '女',
    OTHER: '不公開',
  },
  weekdays: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
} as const;

export type Common = typeof common;
