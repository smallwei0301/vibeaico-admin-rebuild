/**
 * 贊助我們（/tenant/donate）文案
 * 贊助金額卡、付款結果提示、贊助名單表格與所有 toast
 * 均逐字取自原站 DOM 與 inline JS（docs/specs/donate.json）。
 */
export const donatePage = {
  title: '贊助我們',
  metaTitle: '贊助我們 - 店家後台',

  /* ------------------------------------------------------------ 贊助卡 */
  form: {
    totalLabel: '全平台累積贊助',
    amountLabel: '選擇贊助金額（NT$）',
    quickAmounts: [
      { value: 100, label: '100' },
      { value: 300, label: '300' },
      { value: 500, label: '500' },
      { value: 1000, label: '1,000' },
    ],
    customAmount: '自訂金額',
    customAmountPlaceholder: 'NT$ 10 ~ 100,000',
    customAmountHelp: '最低 NT$ 10、最高 NT$ 100,000（整數）',
    displayName: '名單顯示名稱',
    displayNamePlaceholder: '預設使用店家名稱',
    displayNameHelp: '會顯示在贊助名單與跑馬燈上（最長 50 字）',
    displayNameMax: 50,
    submit: '前往贊助',
    submitting: '處理中...',
    payHint: '透過藍新金流安全付款，支援信用卡 / Apple Pay / Google Pay',
    amountInvalidInteger: '請輸入整數贊助金額',
    amountOutOfRange: '贊助金額須介於 NT$ 10 ~ 100,000',
    confirmTitle: '前往贊助',
    confirmMessage: (amount: string) => `即將以 ${amount} 前往藍新金流付款頁面，確定要繼續嗎？`,
  },

  /* ---------------------------------------------------------- 付款結果 */
  payment: {
    successText: '謝謝你的支持！❤ 付款處理中，你的名字通常會在一分鐘內出現在贊助名單上。',
    failedStrong: '付款未完成',
    failedBody: '，沒有關係，心意我們收到了！如有疑問請聯絡：',
    contactEmail: 'vibeaico@gmail.com',
  },

  /* ------------------------------------------------------------ 說明列 */
  notice: {
    lead: '贊助是自願支持平台營運，',
    strong: '不是功能購買、也不會轉成點數',
    middle: '；需要儲值點數訂閱功能請到',
    link: '點數管理',
    tail: '。',
  },

  /* ------------------------------------------------------------ 贊助名單 */
  donors: {
    heading: '感謝這些店家',
    subtitle: '依贊助時間排序（最近 50 家）',
    columns: {
      shop: '店家',
      donatedAt: '贊助時間',
    },
    loading: '載入中...',
    loadFailed: '載入失敗，請重新整理',
    thanksPrefix: '感謝 ',
    firstDonorCallout: '☕ 成為第一位贊助者，讓 VibeAI 走得更遠 ❤',
    emptyTitle: '還沒有贊助記錄，成為第一位支持者吧 ☕',
    emptyDescription: '你的支持會直接用在平台的伺服器、推播與新功能開發上。',
  },

  labels: {
    myDonationPrefix: '你已贊助 NT$ ',
    myDonationSuffix: '，謝謝你 ❤',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    payCreateFailed: '付款建立失敗:',
    payCreateFailedFull: '付款建立失敗：',
    payCreateFailedRetry: '建立付款失敗，請稍後再試',
    loadSummaryFailed: '載入贊助總覽失敗:',
    loadFailed: '載入失敗',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },
} as const;
