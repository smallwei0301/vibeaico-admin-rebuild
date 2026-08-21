/**
 * 旅遊訂單（/tenant/tour-orders）文案
 * -----------------------------------------------------------------------------
 * 導遊模組（TOUR_MODULE）。訂單來源含 Midao 前台、VibeAI 商店頁、LINE 與手動建立，
 * 但只有一本帳 —— 規格見 docs/integration/10-TOUR-DOMAIN.md、11-PARTNER-API.md。
 */
export const tourOrdersPage = {
  title: '旅遊訂單',
  metaTitle: '旅遊訂單 - 店家後台',
  tableTitle: '全部訂單',

  stats: {
    pending: '待處理',
    unpaid: '待收款',
    upcoming: '近 7 天出團',
    monthRevenue: '本月營收',
  },

  actions: {
    create: '手動建立訂單',
    detail: '檢視',
    confirmPayment: '確認收款',
    complete: '標記完成',
    cancel: '取消訂單',
    contactLine: 'LINE 聯絡',
  },

  columns: {
    orderNo: '訂單編號',
    trip: '行程 / 方案',
    departsOn: '出團日期',
    customer: '旅客',
    party: '人數',
    amount: '金額',
    payment: '收款',
    status: '狀態',
    source: '來源',
    actions: '操作',
  },

  filters: {
    keywordPlaceholder: '搜尋訂單編號 / 旅客姓名 / 電話',
    statusAll: '全部狀態',
    sourceAll: '全部來源',
    paymentAll: '全部收款狀態',
  },

  status: {
    PENDING: '待確認',
    CONFIRMED: '已確認',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  },
  paymentStatus: {
    UNPAID: '未付款',
    PAID: '已付款',
    REFUNDED: '已退款',
  },
  /** 定金模式的訂單：已收定金但尾款未收 */
  depositBadge: '已收定金',
  source: {
    MIDAO: 'Midao 前台',
    VIBEAI_SHOP: '商店頁',
    LINE: 'LINE',
    MANUAL: '手動建立',
  },

  hold: {
    label: '保留至',
    expiring: (text: string) => `付款期限 ${text}`,
    expired: '已逾期，名額已釋放',
  },

  detail: {
    title: (orderNo: string) => `訂單 ${orderNo}`,
    sections: {
      trip: '行程資訊',
      customer: '旅客資訊',
      payment: '收款資訊',
      note: '備註',
    },
    fields: {
      trip: '行程',
      plan: '方案',
      departsOn: '出團日期',
      startTime: '出發時間',
      name: '姓名',
      phone: '電話',
      party: '人數',
      unitPrice: '單價',
      total: '總金額',
      deposit: '已收定金',
      balance: '待收尾款',
      method: '收款方式',
      ref: '交易編號 / 匯款後五碼',
      source: '訂單來源',
      createdAt: '成立時間',
    },
    partyUnit: (n: number) => `${n} 位`,
    noRef: '尚未回報',
    noNote: '無',
  },

  create: {
    title: '手動建立訂單',
    hint: '在 LINE 或電話談好之後，用這裡幫旅客建立訂單並保留名額。',
    tripLabel: '行程',
    planLabel: '方案',
    departureLabel: '團次',
    departurePlaceholder: '請選擇出團日期',
    customerLabel: '旅客姓名',
    phoneLabel: '聯絡電話',
    partyLabel: '人數',
    paymentLabel: '收款方式',
    noteLabel: '備註',
    totalPreview: (amount: string) => `訂單金額 ${amount}`,
    seatsLeft: (n: number) => `（剩 ${n} 位）`,
    submit: '建立訂單',
  },

  confirm: {
    confirmPaymentTitle: '確認收款',
    confirmPayment: (orderNo: string) =>
      `確認已收到訂單 ${orderNo} 的款項嗎？確認後訂單成立，旅客會收到 LINE 通知。`,
    completeTitle: '標記完成',
    complete: (orderNo: string) => `確定要把訂單 ${orderNo} 標記為已完成嗎？`,
    cancelTitle: '取消訂單',
    cancel: (orderNo: string) =>
      `確定要取消訂單 ${orderNo} 嗎？名額會立即釋放；已收款項需由你自行退款。`,
  },

  messages: {
    created: '訂單已建立',
    paymentConfirmed: '已確認收款，訂單成立',
    completed: '訂單已標記完成',
    cancelled: '訂單已取消，名額已釋放',
    seatsUnavailable: '名額不足，請重新選擇團次',
    loadFailed: '載入失敗，請稍後再試',
  },

  empty: {
    title: '還沒有旅遊訂單',
    description: '旅客從 Midao、你的商店頁或 LINE 下單後，訂單會出現在這裡。',
  },
} as const;
