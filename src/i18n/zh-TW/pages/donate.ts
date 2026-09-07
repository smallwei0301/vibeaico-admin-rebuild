/**
 * 贊助我們（/tenant/donate）文案
 * 贊助金額卡、付款結果提示、贊助名單表格與所有 toast
 * 均逐字取自原站 DOM 與 inline JS（docs/specs/donate.json）。
 */
export const donatePage = {
  title: '贊助我們',
  metaTitle: '贊助我們 - 店家後台',

  /* ---------------------------------------- 尚未建置：誠實告示（不可省略） */
  /**
   * ⚠️ 這一區塊是「誠實化」文案，對應 CLAUDE.md「Never fabricate a known」。
   * 本頁沒有任何後端（無 /api/donations、無對應的 src/services 函式）：
   * 按下「前往贊助」不會建立任何付款、也不會導向金流頁，
   * 因此不得再用假延遲後靜默關窗，讓店家以為付款已成立。
   */
  notBuilt: {
    title: '贊助金流後端尚未建置，本頁無法完成任何付款',
    body:
      '「前往贊助」目前不會建立訂單、不會導向藍新金流、也不會從你的帳戶扣任何款項。累積贊助金額與贊助名單也查不到（後端不存在），因此一律顯示未知態（--）與空名單，不放示範數字或示範名單。',
    confirmMessage: (amount: string) =>
      `贊助金流後端尚未建置：按下確定不會以 ${amount} 建立任何付款，也不會導向金流頁面。這只會關閉此視窗。`,
    submitNotEffective: '未送出贊助：贊助金流後端尚未建置，沒有產生任何付款，你的帳戶不會被扣款。',
    /**
     * 未知態顯示值。CLAUDE.md：值不知道就顯示不知道，絕不填一個看起來合理的假值
     * ——假值放在真值旁邊時傷害最大。累積贊助金額是平台對店家的財務陳述，
     * 後端不存在就不得給數字（舊值為硬編碼的 48650 / 500）。
     */
    unknownValue: '--',
    totalUnknownHint: '（贊助後端尚未建置，無法統計）',
    myDonationUnknown: '你的累計贊助金額：--（贊助後端尚未建置，無法查詢）',
    donorsEmptyTitle: '贊助名單尚未開通',
    donorsEmptyDescription: '贊助後端尚未建置，目前查不到任何贊助記錄；這裡不會放示範名單，以免看起來像真的有人贊助過。',
  },

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
    /* ⚠️ 舊文案「透過藍新金流安全付款，支援信用卡 / Apple Pay / Google Pay」
       與頁頂告示直接矛盾——金流根本沒接。 */
    payHint: '贊助金流尚未接通，目前無法用任何付款方式完成贊助。',
    amountInvalidInteger: '請輸入整數贊助金額',
    amountOutOfRange: '贊助金額須介於 NT$ 10 ~ 100,000',
    confirmTitle: '前往贊助',
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
