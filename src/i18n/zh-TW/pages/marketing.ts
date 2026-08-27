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
    { key: 'COMPLETED', name: '已完成', desc: '發送完畢' },
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
    COMPLETED: '已完成',
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
    resultFailed: (n: number) => `失敗 ${n}`,
    people: (n: number) => `${n} 人`,
    notSent: '—',
    noImage: '未附圖片',
    /**
     * 「預估人數」在真實模式是**還不知道**，不是 0（issue #7 (乙)）。
     * 平台沒有「試算受眾」端點，真正的收件名單是 `/api/marketing/pushes/:id/send`
     * 在發送當下由 line_users ∩ customers 算出來的。顯示 0 會讓「沒有人符合」
     * 與「我們沒有在算」長得一模一樣——CLAUDE.md 點名的捏造已知。
     */
    unknownValue: '--',
    estimatedUnknown: '尚未試算',
    estimatedUnknownHint: '尚未試算：實際收件名單會在按下「立即發送」時才計算，這裡的「--」是還不知道，不是 0 人。',
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
    /**
     * ⚠️ 一併刪除三個宣稱「上傳能力」而該能力不存在的鍵（issue #7 (乙)）：
     * imageUploadHint（點擊上傳圖片（最大 2MB））、imageRemove（移除圖片）、
     * imageTooLarge（圖片大小不可超過 2MB）。頁面從來沒有上傳程式碼，
     * 「最大 2MB」這種限制描述只會讓人以為背後有一條上傳鏈路。禁止復原。
     */
    imageFormatHint: '支援 JPG、PNG、WebP 格式，建議尺寸 1040x1040',
    imageUrl: '圖片網址（選填）',
    imageUrlPlaceholder: 'https://example.com/image.jpg',
    /** 舊字串是「或直接輸入圖片網址（上傳圖片優先）」——沒有上傳，也就沒有優先順序可言。 */
    imageUrlHelp: '直接輸入圖片網址；這是目前唯一會隨推播送給顧客的圖片來源。',
    scheduledAt: '排程發送時間（選填）',
    scheduledAtHelp: '不填則儲存為草稿，手動發送',
    note: '備註',
    notePlaceholder: '內部備註，顧客不會看到',
    /**
     * 檔案選擇器目前是停用的（issue #7 (乙)）：它以前只把檔名記進本地 state，
     * 從來沒有上傳過，送出時也不會帶走。整頁其餘動作接上真實後端之後，一個
     * 「看起來能選、選了會被丟掉」的控制項比先前更容易誤導，所以停用並在此說明。
     */
    imageUploadNotWired: '圖片上傳尚未接上，選檔不會有作用；目前唯一會隨推播送給顧客的圖片是下方的「圖片網址」。',
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
    /**
     * ⚠️ 舊字串是「推播已開始發送」，而當時頁面根本沒有呼叫任何端點
     * （14 分冊 §1）。`/api/marketing/pushes/:id/send` 是**同步**的：回應回來時
     * multicast 已經送完、額度已經扣掉，回傳的 sentCount 是後端數出來的實際人數。
     * 所以這裡報的是完成式與真實數字，不是「開始」這種無法查證的說法。
     */
    sent: (n: number) => `推播已送出給 ${n} 位顧客`,
    saveFailedPrefix: '儲存失敗: ',
    saveFailedRetry: '儲存失敗，請稍後再試',
    savePushFailed: '儲存推播失敗:',
    deleteFailed: '刪除失敗',
    cancelFailed: '取消失敗',
    sendFailedPrefix: '發送失敗: ',
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
