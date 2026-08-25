/**
 * 商品訂單（/tenant/product-orders）文案
 * 狀態篩選、表格、訂單詳情、手動建單 modal 與所有 toast／確認訊息
 * 均逐字取自原站 DOM 與 inline JS。
 */
export const productOrdersPage = {
  title: '商品訂單',
  metaTitle: '商品訂單 - 店家後台',
  tableTitle: '訂單列表',

  /* ------------------------------------------------------------- 狀態篩選 */
  filter: {
    statusLabel: '狀態篩選：',
    statusOptions: [
      { value: '', label: '全部' },
      { value: 'PENDING', label: '待確認' },
      { value: 'CONFIRMED', label: '已確認' },
      { value: 'COMPLETED', label: '已完成' },
      { value: 'CANCELLED', label: '已取消' },
    ],
    pendingCount: (n: number) => `待處理: ${n}`,
  },

  /* ------------------------------------------------------------------ 表格 */
  columns: {
    orderNo: '訂單編號',
    customer: '顧客',
    product: '商品',
    quantity: '數量',
    amount: '金額',
    status: '狀態',
    createdAt: '建立時間',
    actions: '操作',
  },

  status: {
    PENDING: '待確認',
    CONFIRMED: '已確認',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  },

  payBadge: {
    paid: '已付清',
    unpaid: '待付款',
    notOnline: '未線上付款',
    partial: '部分付款',
  },

  labels: {
    lineCustomer: 'LINE 顧客',
    noPhone: '未提供電話',
    notProvided: '未提供',
    none: '無',
    unnamed: '未命名',
    unknown: '未知',
    pickup: '自取',
    shipping: '郵寄',
    taxId: (id: string) => `統編 ${id}`,
    payDue: (at: string) => `未付款自動取消期限：${at}`,
    fromBooking: '本單為預約現場加購（至預約列表查看）',
    quantityUnitPrice: (qty: number, unitPrice: string) => `${qty} × ${unitPrice}`,
    unassignedPayment: '未指定（下單後與顧客確認）',
  },

  /* ------------------------------------------------------------------ 動作 */
  actions: {
    create: '新增訂單',
    view: '查看詳細資訊',
    chat: '聊天',
    confirm: '確認訂單',
    complete: '完成取貨',
    cancel: '取消',
    markPaidOffline: '標記已線下收款',
    /** 商品訂單線上付款尚未建置，複製鈕改停用；文案只誠實標示現況，不承諾能刷卡。 */
    payLinkNotBuilt: '線上付款尚未建置，暫無法產生付款連結',
    applyCouponAndComplete: '套用票券並完成',
    completeWithoutCoupon: '直接完成（無票券）',
    applyAndComplete: '套用並完成',
  },

  /* --------------------------------------------------- modal 1：訂單詳情 */
  detail: {
    title: '訂單詳情',
    loading: '載入中...',
    fields: {
      product: '商品',
      quantityUnitPrice: '數量 × 單價',
      lineUser: 'LINE 用戶',
      paymentMethod: '付款方式',
      onlinePayment: '線上收款',
      couponDiscount: '票券折抵',
      staff: '經手員工',
      relatedBooking: '關聯預約',
      note: '備註',
      taxId: '統一編號',
      shippingAddress: '收件地址',
      completedPickup: '完成取貨',
      cancelReason: '取消原因',
      cancelledAt: '取消時間',
    },
  },

  /* ------------------------------------------- modal 2：完成取貨 / 套用票券 */
  complete: {
    title: '完成取貨',
    confirmText: '確定顧客已取貨完成？',
    couponCodeLabel: '輸入票券代碼',
    couponCodeRequired: '請輸入票券代碼',
    couponApplied: (amount: string) => `票券已套用！折抵 ${amount}`,
    couponAppliedButFailed: '票券已套用，但「完成訂單」失敗：',
  },

  /* ------------------------------------------------ modal 3：手動建立訂單 */
  manual: {
    title: '新增訂單（現場加購記帳）',
    customerSection: '顧客',
    modeExisting: '既有顧客',
    modeNew: '新顧客',
    searchPlaceholder: '搜尋姓名/電話...',
    search: '搜尋',
    searching: '搜尋中...',
    searchFailed: '搜尋失敗',
    customerPlaceholder: '請先搜尋顧客',
    customerNotFound: '找不到顧客，可切換「新顧客」建檔',
    newNamePlaceholder: '姓名',
    newPhonePlaceholder: '電話（手機或市話）',
    productSection: '商品',
    productPlaceholder: '請選擇商品',
    noProducts: '無上架商品',
    add: '加入',
    itemsEmpty: '尚未加入商品',
    totalLabel: '合計：',
    totalZero: 'NT$ 0',
    optionSection: '選項',
    staffLabel: '經手員工（僅記錄供日後查詢，不計入業績報表，選填）',
    staffPlaceholder: '不指定',
    paymentLabel: '付款方式（選填）',
    paymentPlaceholder: '未指定',
    bookingLabel: '關聯今日預約（選填，對帳用）',
    bookingPlaceholder: '不關聯',
    noteLabel: '備註',
    notePlaceholder: '選填',
    paidCompleted: '已當場收款完成（自動完成訂單：集點/累計消費即時入帳）',
    notify: 'LINE 通知顧客消費明細（未綁 LINE 自動改寄 Email；每則扣 1 推播額度）',
    submit: '建立訂單',
    submitting: '建立中...',
    remove: '移除',
    quantityMin: '數量至少 1',
    selectCustomerFirst: '請先搜尋並選擇顧客',
    newCustomerRequired: '新顧客請填姓名與電話',
    selectProduct: '請選擇商品',
    atLeastOneItem: '請至少加入一項商品',
    phoneExists: (existingName: string, name: string) =>
      `此電話已屬於既有顧客「${existingName}」，訂單將記在該顧客名下（消費明細也會通知這位顧客），不會建立「${name}」。確定繼續嗎？`,
    phoneExistsTitle: '電話已存在',
  },

  /* --------------------------------------------------- modal 4：各種確認 */
  confirm: {
    confirmOrderTitle: '確認訂單',
    confirmOrder: '確定要確認此訂單嗎？',
    confirmOrderUnpaid:
      '⚠️ 此訂單需線上付款但顧客尚未付款。\n若顧客改用現金/轉帳，可先確認，收款後再按「標記已線下收款」。\n\n仍要確認嗎？',
    markPaidTitle: '標記已線下收款',
    markPaid:
      '確定顧客已用現金 / 轉帳等方式付清此訂單？\n標記後會清除「待付款」徽章，且不會被系統自動取消。',
    cancelTitle: '取消訂單',
    cancelPaid: (amount: string) =>
      `⚠️ 此訂單已收款 ${amount}。\n取消後系統不會自動退款，請依實際收款方式退款給顧客（線上刷卡請至您的金流後台操作）。\n\n仍要取消嗎？`,
    cancelReasonLabel: '請輸入取消原因（選填）：',
  },

  /* ------------------------------------------------------------------ 訊息 */
  messages: {
    created: '訂單已建立',
    createdNotCompleted: '訂單已建立但未完成，請至列表手動處理',
    confirmed: '訂單已確認',
    completed: '訂單已完成',
    cancelled: '訂單已取消，庫存已回補',
    cancelledRefundReminder: '訂單已取消，庫存已回補。請記得退款給顧客。',
    markedPaid: '已標記為已收款',
    actionFailed: '操作失敗',
    createOrderFailed: '建立訂單失敗:',
    loadOrdersFailed: '載入訂單失敗:',
    loadPendingCountFailed: '載入待處理數量失敗:',
    loadManualDataFailed: '載入建單資料失敗:',
    loadProductStaffFailed: '載入商品/員工資料失敗',
    loadFailed: '載入失敗',
    connectionError: '連線錯誤，請稍後再試',
    unknownError: '未知錯誤',

    /**
     * 手動建單勾選「LINE 通知顧客消費明細」後的結果訊息（issue #27 ③）。
     *
     * 以前這裡沒有東西 —— 頁面直接把勾選框的標籤原句再 toast 一次，讀起來像
     * 「已通知」，但後端根本沒有通知任何人。現在每一句都對應
     * `ProductOrderNotifyOutcome` 的一個值，只描述**真的發生過的事**（鐵則 12）。
     */
    notifyResult: {
      /**
       * 'LINE'：顧客已綁 LINE，明細已推播、扣 1 推播額度。
       * ⚠️ 只說「已送出」不說「已通知」（14 分冊 §8.10）——LINE 推播 API 回 200
       * 只代表 LINE 收下了，不代表顧客手機上顯示出來了。
       */
      line: '消費明細已用 LINE 送出給顧客（扣 1 則推播額度）',
      /** 'EMAIL'：顧客未綁 LINE，改用 Email 送出（不扣推播額度） */
      email: '顧客未綁定 LINE，消費明細已改用 Email 送出（不扣推播額度）',
      /** 'NO_CONTACT'：既沒綁 LINE 也沒留 Email，沒有管道可送 */
      noContact: '顧客未綁定 LINE 也沒有 Email，消費明細未送出',
      /** 'QUOTA_EXCEEDED'：本月推播額度用完 */
      quotaExceeded: '本月推播額度已用完，消費明細未送出',
      /** 'FAILED'：送了但沒送成（LINE 平台回錯、未設定 LINE 憑證、寄信失敗…） */
      failed: '消費明細發送失敗，訂單已建立，請改用其他方式通知顧客',
    },
  },

  empty: {
    title: '暫無訂單',
    description: '顧客在 LINE 或公開頁下單後會出現在這裡，你也可以手動建立現場加購訂單。',
  },
} as const;
