/**
 * 行銷推播（/tenant/marketing）文案
 * 標題、說明卡、狀態說明列、推送額度列、表格、建立/編輯 modal 與所有 toast／確認訊息
 * 均逐字取自原站 DOM 與 inline JS（docs/specs/marketing.json）。
 */
export const marketingPage = {
  title: '行銷推播',
  metaTitle: '行銷推播 - 店家後台',
  tableTitle: '推播列表',

  /* ------------------------------------------------------ 說明卡（alert-info）*/
  intro: {
    heading: '行銷推播是什麼？',
    lead: '行銷推播可以',
    leadStrong: '發送一則 LINE 訊息',
    leadTail: '給顧客，支援篩選受眾（全部/會員等級/標籤），可立即發送或排程。',
    useCaseLabel: '適合用來：',
    useCaseText: '公休通知、新品上架、節日問候、限時優惠通知、只給 VIP 的訊息',
    crossLead: '如果需要搭配票券或點數獎勵，請用「',
    crossLink: '行銷活動',
    crossTail: '」',
  },

  /* ------------------------------------------------ 狀態說明列（alert-light）*/
  statusLegend: [
    { key: 'DRAFT', name: '草稿', desc: '尚未發送' },
    { key: 'SCHEDULED', name: '排程中', desc: '等待發送' },
    { key: 'SENDING', name: '發送中', desc: '正在發送' },
    { key: 'SENT', name: '已完成', desc: '發送完畢' },
    { key: 'FAILED', name: '失敗', desc: '發送失敗' },
  ],

  /* ---------------------------------------------------------- 本月推送額度 */
  quota: {
    label: '本月推送額度',
    loading: '載入中...',
    usage: (used: number, quota: number, remaining: number) =>
      `${used} / ${quota}（剩餘 ${remaining}）`,
  },

  /* --------------------------------------------------------------- 表格欄位 */
  columns: {
    title: '標題',
    target: '目標對象',
    estimated: '預估人數',
    result: '發送結果',
    status: '狀態',
    actions: '操作',
  },

  /* ------------------------------------------------------------- 狀態文案 */
  status: {
    DRAFT: '草稿',
    SCHEDULED: '排程中',
    SENDING: '發送中',
    SENT: '已完成',
    FAILED: '失敗',
    CANCELLED: '已取消',
  },

  /* --------------------------------------------------------- 目標對象文案 */
  targetType: {
    ALL: '全部顧客',
    MEMBERSHIP_LEVEL: '會員等級',
    TAG: '標籤',
    CUSTOM: '自訂名單',
  },

  labels: {
    targetWithValue: (type: string, value: string) => `${type}：${value}`,
    scheduledAt: (time: string) => `排程於 ${time}`,
    sentAt: (time: string) => `發送於 ${time}`,
    resultSuccess: (n: number) => `成功 ${n}`,
    people: (n: number) => `${n} 人`,
    notSent: '—',
    noImage: '未附圖片',
    /** 後端 marketing_pushes 沒有任何欄位或關聯表能在發送前算出受眾人數，這是
     * 誠實佔位，不是假資料 —— 見 Issue #24。 */
    estimatedUnavailable: '尚未提供',
  },

  /* --------------------------------------------------------------- 動作 */
  actions: {
    create: '建立推播',
    edit: '編輯推播',
    view: '檢視推播',
    send: '立即發送',
    cancelPush: '取消推播',
    delete: '刪除推播',
  },

  /* ------------------------------------------------- modal：建立/編輯推播 */
  form: {
    createTitle: '建立推播',
    editTitle: '編輯推播',
    title: '推播標題 *',
    titlePlaceholder: '例如：本週特惠活動通知',
    titleRequired: '請輸入推播標題',
    content: '推播內容 *',
    contentPlaceholder: '輸入要發送給顧客的訊息內容...',
    contentHelp: 'LINE 訊息內容',
    contentRequired: '請輸入推播內容',
    contentMax: 1000,
    targetType: '目標對象 *',
    targetTypeOptions: [
      { value: 'ALL', label: '全部顧客' },
      { value: 'MEMBERSHIP_LEVEL', label: '指定會員等級' },
      { value: 'CUSTOM', label: '自訂名單' },
    ],
    targetValue: '會員等級',
    targetValuePlaceholder: '請選擇',
    targetValueRequired: '請選擇要推播的會員等級',
    customTargets: '自訂名單（LINE User ID，每行一個）',
    customTargetsPlaceholder: 'U1234567890abcdef\nU0987654321fedcba',
    customTargetsRequired: '請輸入自訂推播名單（每行一個 LINE 用戶 ID）',
    image: '圖片',
    imageUploadHint: '點擊上傳圖片（最大 2MB）',
    imageRemove: '移除圖片',
    imageFormatHint: '支援 JPG、PNG、WebP 格式，建議尺寸 1040x1040',
    imageUrl: '圖片網址（選填）',
    imageUrlPlaceholder: 'https://example.com/image.jpg',
    imageUrlHelp: '或直接輸入圖片網址（上傳圖片優先）',
    scheduledAt: '排程發送時間（選填）',
    scheduledAtHelp: '不填則儲存為草稿，手動發送',
    note: '備註',
    notePlaceholder: '內部備註，顧客不會看到',
  },

  /* --------------------------------------------------------------- 確認 */
  confirm: {
    deleteTitle: '刪除推播',
    delete: '確定要刪除此推播嗎？此操作無法復原。',
    cancelTitle: '取消推播',
    cancelPush: '確定要取消此推播嗎？',
    sendTitle: '立即發送',
    send: '確定要立即發送此推播嗎？發送後無法取消。',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    created: '推播已建立',
    updated: '推播已更新',
    deleted: '推播已刪除',
    cancelled: '推播已取消',
    sending: '推播已開始發送',
    saveFailedPrefix: '儲存失敗: ',
    saveFailedRetry: '儲存失敗，請稍後再試',
    savePushFailed: '儲存推播失敗:',
    deleteFailed: '刪除失敗',
    cancelFailed: '取消失敗',
    sendFailedPrefix: '發送失敗: ',
    imageTooLarge: '圖片大小不可超過 2MB',
    loadPushesFailed: '載入推播失敗:',
    loadDetailFailed: '載入推播詳情失敗',
    loadDetailFailedPrefix: '載入推播詳情失敗:',
    loadQuotaFailed: '載入推送額度失敗:',
    loadLevelsFailed: '載入會員等級失敗:',
    loadFailed: '載入失敗',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '還沒有任何推播',
    description: '建立第一則推播，把公休通知、新品上架或限時優惠直接送到顧客的 LINE。',
  },
} as const;
