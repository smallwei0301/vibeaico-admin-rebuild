/**
 * 顧客訊息（/tenant/chat）文案
 * 左側對話清單 + 右側訊息串的兩欄聊天介面；文案逐字取自原站 DOM 與 inline JS。
 */
export const chatPage = {
  title: '顧客訊息',
  metaTitle: '顧客訊息 - 店家後台',

  /* --------------------------------------------------------- 左側對話清單 */
  list: {
    searchPlaceholder: '搜尋顧客...',
    loading: '載入中...',
    emptyTitle: '尚無顧客訊息',
    emptyDescription: '顧客在 LINE 官方帳號傳訊息給您之後，對話會出現在這裡。',
    loadFailed: '載入失敗',
  },

  /* --------------------------------------------------------- 右側訊息串 */
  thread: {
    selectHint: '選擇左側對話開始聊天',
    noMessages: '尚無訊息',
    loading: '載入中...',
    loadFailed: '載入失敗',
    viewProfile: '查看資料',
    back: '返回對話清單',
  },

  /* ------------------------------------------------------------- 輸入區 */
  composer: {
    placeholder: '輸入訊息...',
    hint: 'Enter 發送，Shift+Enter 換行',
    send: '發送',
    sendImage: '傳送圖片',
  },

  labels: {
    customerFallback: '顧客',
    image: '圖片',
    unread: '未讀',
    justNow: '剛剛',
    minutesAgo: (n: number) => `${n}分前`,
    hoursAgo: (n: number) => `${n}小時前`,
    daysAgo: (n: number) => `${n}天前`,
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    imageTooLarge: '圖片大小不可超過 5MB',
    imageSendFailed: '圖片發送失敗',
    sendFailed: '發送失敗',
    notBound: '無法開啟此顧客對話，可能尚未綁定 LINE',
    loadFailed: '載入失敗',
    unknownError: '未知錯誤',
    connectionError: '連線錯誤，請稍後再試',
  },

  /** 圖片上限：原站寫死 5MB */
  imageMaxBytes: 5 * 1024 * 1024,
} as const;
