/**
 * 點數管理（/tenant/points）文案
 * 統計卡、付款結果提示、點數用途說明、異動記錄表格、申請儲值 / 轉點 modal
 * 與所有 toast 均逐字取自原站 DOM 與 inline JS（docs/specs/points.json）。
 */
export const pointsPage = {
  title: '點數管理',
  metaTitle: '點數管理 - 店家後台',

  /* -------------------------------------------------------------- 統計卡 */
  stats: {
    balance: '目前餘額',
    balanceHint: '可用於訂閱功能',
    monthlyCost: '每月訂閱費用',
    monthlyCostHint: '目前訂閱功能的月費合計（下次續訂時扣）；此統計尚未提供，接上後顯示',
    pendingTopup: '處理中儲值',
    pendingTopupHint: '付款處理中；儲值金流尚未接上，接上後顯示',
  },

  /* ---------------------------------------------------------- 付款結果 */
  payment: {
    successTitle: '付款處理中…',
    successBody: '點數通常於數秒內入帳，若餘額尚未更新請稍候片刻再重新整理。',
    successCta: '前往功能商店訂閱',
    failedTitle: '付款未完成',
    failedBody: '，如有疑問請聯絡管理員：',
    contactEmail: 'vibeaico@gmail.com',
  },

  /* --------------------------------------------------------- 點數用途 */
  usage: {
    label: '點數用途：',
    text: '點數可用於訂閱付費功能（如無限員工、AI 客服、票券系統等）。1 點 = NT$1。',
  },

  /* --------------------------------------------------------------- 動作 */
  actions: {
    transfer: '轉點到其他分店',
    topup: '申請儲值',
    goFeatureStore: '前往功能商店訂閱',
  },

  /* --------------------------------------------------------------- 表格 */
  tableTitle: '點數異動記錄',
  columns: {
    time: '時間',
    type: '類型',
    amount: '異動點數',
    balance: '餘額',
    description: '說明',
  },
  tableFootnote: '扣點明細自 2026/06/12 起記錄，先前的功能訂閱扣點未包含在此列表',

  /* ---------------------------------------------------------- 異動類型 */
  types: {
    TOPUP: '儲值',
    CONSUME: '消費',
    SUBSCRIPTION: '功能訂閱',
    TRANSFER_IN: '分店轉點',
    TRANSFER_OUT: '分店轉點',
    REFERRAL: '推薦獎勵',
    BONUS: '贈送',
    REFUND: '退款',
    EXPIRED: '過期',
    PROCESSING: '處理中',
    REJECTED: '駁回',
    CANCELLED: '取消',
  },

  labels: {
    points: (n: number) => `${n} 點`,
    pointsUnit: ' 點',
    totalCount: (total: number) => `共 ${total} 筆`,
    perPage: (size: number) => `每頁 ${size} 筆`,
    dash: '--',
    plans: {
      lite: '輕量版方案',
      pro: '專業版方案',
    },
  },

  /* ------------------------------------------------- modal：申請儲值 */
  topup: {
    title: '申請儲值',
    amount: '儲值方案 *',
    amountPlaceholder: '請選擇儲值方案',
    amountRequired: '請選擇儲值方案',
    amountHelp: '儲值越多，贈送越多！',
    amountOptions: [
      { value: '100', label: 'NT$ 100（獲得 100 點）' },
      { value: '300', label: 'NT$ 300（獲得 300 點）' },
      { value: '500', label: 'NT$ 500（獲得 525 點，贈送 5%）' },
      { value: '800', label: 'NT$ 800（獲得 800 點，剛好續專業版一個月）' },
      { value: '1000', label: 'NT$ 1,000（獲得 1,100 點，贈送 10%）' },
      { value: '5000', label: 'NT$ 5,000（獲得 5,750 點，贈送 15%）' },
      { value: '10000', label: 'NT$ 10,000（獲得 12,000 點，贈送 20%）' },
    ],
    payMethods: '支援信用卡 / Apple Pay / Google Pay / Samsung Pay',
    payRedirectHint: '點擊「前往付款」後將導向藍新金流安全付款頁面',
    invoiceUbn: '統一編號',
    invoiceOptional: '（選填）',
    invoiceUbnPlaceholder: '8 碼數字，需開三聯式發票時填寫',
    invoiceUbnInvalid: '統一編號必須是 8 碼數字',
    invoiceUbnHelp: '填統編開立三聯式發票；不填則開立電子發票（雲端發票）寄至店家 Email',
    invoiceTitle: '發票抬頭',
    invoiceTitlePlaceholder: '公司登記名稱，未填以店家名稱開立',
    remark: '備註',
    remarkPlaceholder: '如有特殊需求可在此說明...',
    remarkMax: 200,
    submit: '前往付款',
    submitting: '處理中...',
  },

  /* --------------------------------------------------- modal：分店轉點 */
  transfer: {
    title: '轉點到其他分店',
    introLead: '只能在',
    introStrong: '您自己帳號旗下的店家',
    introTail: '之間轉點；轉出後立即生效，雙方都會留下異動記錄。',
    target: '目標店家 *',
    targetPlaceholder: '請選擇目標店家',
    targetRequired: '請選擇目標店家',
    points: '轉出點數 *',
    pointsPlaceholder: '輸入要轉出的點數',
    pointsHelp: (balance: string) => `目前餘額：${balance} 點`,
    pointsInvalid: '轉點數量必須為正整數',
    submit: '確認轉點',
    submitting: '處理中...',
    confirmTitle: '確認轉點',
    confirmMessage: (points: string, targetName: string) =>
      `確定要轉出 ${points} 點到「${targetName}」嗎？轉出後立即生效。`,
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    transferred: (points: string, targetName: string) => `已轉出 ${points} 點到「${targetName}」`,
    transferFailed: '轉點失敗:',
    payCreateFailed: '付款建立失敗:',
    payCreateFailedFull: '付款建立失敗：',
    payCreateFailedRetry: '建立付款失敗，請稍後再試',
    creditPendingRenew: (name: string) => `點數入帳中，入帳後可續訂「${name}」`,
    creditedGoRenew: (name: string) => `點數已入帳，前往續訂「${name}」`,
    creditedRenewed: (name: string) => `點數已入帳，續訂「${name}」`,
    goRenewPrefix: '前往續訂「',
    shortOfPoints: (name: string, points: string) => `「${name}」還差 ${points} 點，前往功能商店`,
    goFeatureStoreDelay: '前往功能商店（點數入帳可能稍有延遲，請以餘額為準）',
    loadBalanceFailed: '載入餘額失敗:',
    loadTransactionsFailed: '載入異動記錄失敗:',
    loadBranchesFailed: '載入分店清單失敗:',
    loadFailed: '載入失敗',
    loadFailedRefresh: '載入失敗，請重新整理頁面',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '還沒有點數異動記錄',
    description: '完成第一次儲值或訂閱功能後，這裡會列出每一筆點數進出。',
  },
} as const;
