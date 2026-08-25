/**
 * 預約管理（/tenant/bookings）文案
 * 表格、篩選器、8 個 modal 與所有 toast／確認訊息均逐字取自原站 DOM 與 inline JS。
 */
export const bookingsPage = {
  title: '預約管理',
  metaTitle: '預約管理 - 店家後台',
  tableTitle: '預約列表',

  /* ------------------------------------------------------------------ 篩選 */
  filters: {
    dateSeparator: '~',
    statusAll: '全部狀態',
    status: {
      UNPROCESSED: '未處理',
      PENDING: '待確認',
      CONFIRMED: '已確認',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
      NO_SHOW: '爽約',
    },
    showCancelled: '含已取消',
    searchPlaceholder: '搜尋顧客姓名或電話...',
    selectedCount: (n: number) => `已選 ${n} 筆`,
  },

  /* ------------------------------------------------------------------ 動作 */
  actions: {
    export: '匯出',
    create: '新增預約',
    createShort: '新增',
    batchConfirm: '確認',
    batchCancel: '取消',
    clearSelection: '清除選取',
  },

  columns: {
    no: '編號',
    datetime: '日期時間',
    customer: '顧客',
    service: '服務',
    staff: '員工',
    amount: '金額',
    status: '狀態',
    actions: '操作',
  },

  rowActions: {
    detail: '查看詳情',
    confirm: '確認預約',
    confirmShort: '確認',
    edit: '編輯預約',
    cancel: '取消預約',
    complete: '完成預約',
    markComplete: '標記完成',
    markNoShow: '標記爽約',
    addon: '加購',
    applyCoupon: '套用票券',
    applyPoints: '使用點數',
    adjustPrice: '調整金額',
    revert: '還原為已確認',
    copyPayLink: '複製付款連結',
    markPaidOffline: '標記已線下收款',
    markBalancePaid: '標記尾款已結清',
    stayNotEditable: '住宿訂單不可編輯',
    queueNotEditable: '號碼掛號不可編輯',
    chat: '聊天',
    close: '關閉',
  },

  labels: {
    unprocessed: '未處理',
    memberPrice: '(會員價)',
    deletedService: '（此服務已刪除）',
    received: (amount: string) => `（已收 ${amount}）`,
    discounted: (amount: string) => `（已折抵 ${amount}）`,
    unassigned: '未指定',
    noStaffNeeded: '無需指定',
    sameStaff: '同預約人員',
    originalService: '原服務',
    noData: '無資料',
    customerNote: '顧客備註',
    queueNumber: (n: number) => `${n} 號`,
    checkoutTo: (date: string) => `→ 退房 ${date}`,
  },

  payment: {
    paid: '已付清',
    deposit: '已付訂金',
    pending: '待付款',
    unpaid: '尚未付款',
  },

  /* -------------------------------------------------------- 新增預約 modal */
  createModal: {
    title: '新增預約',
    /** `{catalog}` 由頁面在 render 期依當下模式展開（14 分冊 §8.13／§8.17） */
    intro: '請選擇顧客、{catalog}、日期與時間來建立預約。新建立的預約狀態為「待確認」。',
    customer: '顧客 *',
    newCustomerToggle: '新顧客（直接輸入姓名與電話）',
    customerPlaceholder: '請選擇顧客',
    customerInvalid: '請選擇顧客',
    newCustomerName: '顧客姓名',
    newCustomerPhone: '台灣 0912345678；外籍含國碼 +81...',
    newCustomerInvalid: '請填寫顧客姓名與正確手機號（台灣 09 開頭 10 碼；外籍請含國碼）',
    customerHelp: '系統會自動建檔；若手機號已存在則沿用既有顧客（不會覆蓋既有姓名）。',

    service: '{catalog} *',
    servicePlaceholder: '請選擇服務',
    serviceInvalid: '請選擇{catalog}',
    serviceHelp: '看診號碼掛號服務不在此列表，代客掛號請至左側「看診號碼掛號」頁操作。',
    serviceOption: (name: string, minutes: number, price: string) => `${name} (${minutes}分鐘 / ${price})`,
    stayServiceOption: (name: string, price: string) => `${name} 🌙住宿 (每晚 ${price})`,

    staff: '服務人員',
    staffAuto: '不指定（系統自動分配）',
    staffHelp: '可選擇指定 服務人員 或由系統自動分配',
    staffRequired: '此店家設定為強制指定',
    staffRequiredSuffix: '，請選擇後再送出',
    staffNoShift:
      '此人員當日無排班/已額滿。如要排班表外時段請自行選擇，系統會於送出時再次檢查衝突。',

    date: '預約日期 *',
    dateInvalid: '請選擇預約日期',
    checkoutDate: '退房日期 *',
    checkoutInvalid: '退房日期必須晚於入住日期',
    stayHelp: '🌙 住宿模式：選入住日 + 退房日，每晚一間房（價格為每晚），不選時段/員工。',

    time: '開始時間 *',
    timeInvalid: '請選擇開始時間',
    slotsOnly: (n: number) => `僅顯示可預約時段（${n}）`,
    showAllSlots: '顯示全部時段',
    allSlotsShown: '已顯示全部時段（手動）',

    duration: '服務時長',
    durationPlaceholder: '選擇服務後自動填入',
    durationHelp: '服務時長由{catalog}決定',
    durationValue: (minutes: number) => `${minutes} 分鐘`,

    note: '備註',
    notePlaceholder: '可填寫顧客特殊需求或注意事項...',
    noteMax: 500,

    submit: '建立預約',
    submitting: '建立中...',
  },

  /* -------------------------------------------------------- 編輯預約 modal */
  editModal: {
    title: '編輯預約',
    /* ⚠️ 舊文案是「修改預約資訊後，系統將自動發送 LINE 通知給顧客。」，與 issue #27
     * 依 §8.7 做出來的行為互相矛盾：只改備註**不會**推播，而且推播只是「送出」，
     * 系統無從得知顧客有沒有收到（§8.10）。使用者在同一個視窗裡先被告知一定會通知、
     * 送出後卻拿到「未送出顧客通知」——這是 2026-08-25 Preview 實測抓到的。 */
    intro: '修改預約時間或服務人員時，系統會送出 LINE 通知給顧客；只調整備註則不會送出通知。',
    customer: '顧客',
    customerHelp: '顧客資訊無法修改',
    service: '{catalog} *',
    servicePlaceholder: '請選擇服務',
    serviceInvalid: '請選擇{catalog}',
    staff: '服務人員',
    staffAuto: '不指定（系統自動分配）',
    staffHelp: '可選擇指定 服務人員 或由系統自動分配',
    date: '預約日期 *',
    dateInvalid: '請選擇預約日期',
    time: '開始時間 *',
    timeInvalid: '請選擇開始時間',
    duration: '服務時長 *',
    durationUnit: '分鐘',
    durationHelp: '可調整服務時長（30-480 分鐘，每 30 分鐘一檔）',
    noteToCustomer: '給顧客的備註',
    /* 同上：備註本身不會觸發推播，只有時間／人員變動時才送出，而備註會一併帶在那則通知裡。 */
    noteToCustomerPlaceholder: '若這次同時改了時間或人員，此備註會一併寫在送出的 LINE 通知裡...',
    noteMax: 500,
    submit: '儲存變更',
    submitting: '儲存中...',
  },

  /* -------------------------------------------------------- 取消預約 modal */
  cancelModal: {
    title: '取消預約',
    intro: '取消後將透過 LINE 通知顧客，請填寫原因讓顧客了解。',
    label: '取消原因',
    placeholder: '例：店家臨時公休、員工請假、時段調整...',
    max: 200,
    back: '返回',
    confirm: '確定取消',
    batchTitle: (n: number) => `批次取消 ${n} 筆預約`,
  },

  /* -------------------------------------------------------- 加購項目 modal */
  addonModal: {
    title: '加購項目',
    fromServiceLabel: '從服務清單帶入（選填，可改價）',
    freeInputOption: '— 自由輸入（耗材/商品類）—',
    itemName: '項目名稱 *',
    itemNamePlaceholder: '例如：刮痧 / 青草膏',
    price: '加購價 *',
    pricePlaceholder: '優惠價',
    duration: '佔用時長',
    durationOptions: [
      { value: '0', label: '不佔時間' },
      { value: '10', label: '10 分鐘' },
      { value: '20', label: '20 分鐘' },
      { value: '30', label: '30 分鐘' },
      { value: '40', label: '40 分鐘' },
      { value: '50', label: '50 分鐘' },
      { value: '60', label: '60 分鐘' },
      { value: '90', label: '90 分鐘' },
      { value: '120', label: '120 分鐘' },
    ],
    quantity: '數量',
    staffLabel: '執行 服務人員 （業績歸戶）',
    staffSame: '同本預約的人員',
    submit: '加入',
  },

  /* --------------------------------- 加購：尚未建置的誠實告示（不可省略） */
  /**
   * ⚠️ 這一區塊是「誠實化」文案，對應 CLAUDE.md「Never fabricate a known」。
   * 加購（booking add-on）沒有任何後端：`src/app/api/bookings/**` 底下沒有
   * addons 路由，`src/services/bookings.ts` 也沒有對應函式（Phase 8b 才排）。
   * 舊實作按「加入」後假延遲 400ms → toast「加購已加入，顧客將收到 LINE 消費明細」，
   * 但金額、時長、加購明細都沒有異動（重新載入後加購就不見了），LINE 訊息也從未送出。
   * 兩個謊：一是宣稱資料已寫入，二是宣稱已對顧客做了對外動作。
   */
  addonNotBuilt: {
    modalTitle: '加購後端尚未建置（Phase 8b），此表單不會寫入任何資料',
    modalBody:
      '這張表單目前沒有可以寫入的後端：按「加入」不會改變預約金額與時長、不會產生加購明細，也不會送出任何 LINE 消費明細給顧客。填寫內容在關閉視窗後即消失。',
    notifyDisabled:
      '通知顧客消費明細（加購通知後端尚未建置，此選項無法勾選，本表單不會送出任何 LINE 訊息）',
    footnote:
      '加購後端建置完成後，佔時間的加購才會延長預約結束時間、耗材類選「不佔時間」只加金額。在那之前請自行以口頭或現場單據向顧客說明加購內容。',
    submitNotEffective:
      '未新增加購：加購後端尚未建置（Phase 8b），這筆加購沒有寫入資料庫，預約金額與時長不變，顧客也不會收到任何 LINE 消費明細，請自行告知顧客。',
    removeConfirm:
      '加購後端尚未建置（Phase 8b）：按下確定不會移除任何加購明細，預約金額與時長也不會變動。此視窗只會關閉。',
    removeNotEffective:
      '未移除加購：加購後端尚未建置（Phase 8b），這個項目仍在原處，預約金額與時長不變。',
  },

  /* -------------------------------------------------------- 套用票券 modal */
  couponModal: {
    title: '套用票券折抵',
    intro: '輸入票券代碼來折抵此筆預約金額。',
    amountLabel: '預約金額',
    code: '票券代碼 *',
    codePlaceholder: '請輸入票券代碼',
    codeHelp: '可在票券管理頁面查詢已發放的票券代碼',
    submit: '確認套用',
  },

  /* -------------------------------------------------------- 調整金額 modal */
  adjustPriceModal: {
    title: '調整金額',
    intro: '調整此筆預約的金額（覆蓋最終計價）：',
    bullets: [
      '• 會員折扣顯示快照將清除（以此金額為準）',
      '• 票券/點數折抵不受影響，仍會從新金額扣除',
      /*
       * ⚠️ 誠實化文案（CLAUDE.md「Never fabricate a known」）。
       * 舊句推薦店家「改用加購」，宣稱加購才會延長時段、記師父業績、通知顧客——
       * 但加購後端尚未建置（Phase 8b，見本檔 addonNotBuilt 註解）：加購表單不會
       * 寫入資料庫、不會改動時長金額、也不會送出任何 LINE 訊息。等於把使用者
       * 導向一個不存在的能力。禁止復原。
       */
      '• 若是「多做了項目/多花了時間」：加購後端尚未建置（Phase 8b），目前無論調價或加購都不會延長時段、不會記師父業績、也不會通知顧客，請自行告知顧客並手動記錄業績',
    ],
    label: '金額',
    withAddonsWarning: (n: number) =>
      `此預約有 ${n} 筆加購明細。手動調整總價後，明細與總價將脫鉤（明細僅供參考、師父業績仍按明細歸戶）。確定要手動調價嗎？`,
    submit: '確認調整',
  },

  /* -------------------------------------------------------- 使用點數 modal */
  pointsModal: {
    title: '使用點數',
    intro: '以顧客的點數折抵此筆預約金額。',
    balanceLabel: '顧客可用點數',
    label: '折抵點數',
    placeholder: '請輸入折抵點數',
    help: '1 點折抵 $1，最多折抵至應付金額為止。',
    submit: '確認折抵',
  },

  /* -------------------------------------------------------- 標記付款 modal */
  markPaidModal: {
    titleOffline: '標記已線下收款',
    titleBalance: '標記尾款已結清',
    confirmOffline:
      '確定標記此預約為「已線下收款」嗎？（現金/轉帳等線下收足，標記為已付清；不會建立線上金流交易）',
    paidHint: '已付清，本次無需再向顧客收款。',
    depositHint: '下方「應收金額」已自動扣除，現場只需收尾款。',
    balanceHint:
      '如需向顧客收取差額，請收現後按「標記尾款已結清」（線上付款連結尚未建置，詳見 issue #32）。',
    /**
     * /pay/* 付款頁尚未建置（issue #32 才會做），此文案目前不應出現在任何渲染路徑；
     * 保留只是因為 copyPayLink 的複製動作邏輯本身仍在（見 page.tsx 的 copyPayLink），
     * #32 完成、鈕重新啟用後才會再被用到。
     */
    payLinkIntro: '複製此付款連結傳給顧客：',
  },

  /* -------------------------------------------------------- 預約詳情 modal */
  detailModal: {
    title: '預約詳情',
    loading: '載入中...',
    loadFailed: '載入失敗',
    addonSection: '加購明細',
    addonLoadFailed: '加購明細載入失敗（可能仍有加購項目，請重新開啟詳情確認）',
    amountLabel: '應收金額',
    paidLabel: '已收金額',
    couponDiscount: (amount: string) => `票券折抵 ${amount}`,
    pointsDiscount: (points: number) => `點數折抵 ${points} 點 = $${points}`,
    afterCoupon: '（再扣票券，以系統計算為準）',
    notConfirmed: '此預約尚未確認',
    /** 複製付款連結鈕已停用時，鈕旁顯示的說明（issue #28 ②：/pay 頁待 issue #32 建置） */
    payLinkUnavailable: '付款頁尚未建置，連結目前無法使用（詳見 issue #32）。',
  },

  /* -------------------------------------------------------------- 確認訊息 */
  confirmMessages: {
    confirmBooking: '確定要確認此預約嗎？確認後顧客將會收到通知。',
    manualConfirm:
      '手動確認後時段就會被佔用（付款完成本來會自動確認）。\n若顧客改用現金／轉帳到店付款，可先確認，收款後再按「標記已線下收款」。\n\n確定要手動確認嗎？',
    onlinePayWarning: (warn: string) => `⚠️ 此預約需線上付款，但顧客${warn}。\n\n`,
    noShow: '確定要將此預約標記為爽約嗎？',
    cancelPaidWarning: (amount: string) =>
      `⚠️ 此預約已線上收款${amount}。取消後系統不會自動退款，請記得至您的金流後台手動退款給顧客。確定要取消嗎？`,
    batchConfirm: (n: number) =>
      `確定要批次確認 ${n} 筆預約嗎？\n\n確認後這些時段都會被佔用。確定要全部確認嗎？`,
    batchUnpaidWarning: (selected: number, unpaid: number) =>
      `⚠️ 選取的 ${selected} 筆中，有 ${unpaid} 筆需線上付款但尚未收足：\n\n`,
    batchUnpaidMore: (n: number) => `・…等共 ${n} 筆`,
    batchCancel: (n: number, refundWarn: string) => `確定批次取消 ${n} 筆預約嗎？${refundWarn}`,
    batchRefundWarning: (n: number, total: string) =>
      `\n\n⚠️ 其中 ${n} 筆已線上收款（共 ${total}），系統不會自動退款，請記得至您的金流後台手動退款給顧客。`,
    revert:
      '確定要還原為「已確認」嗎？\n\n此操作會：\n• 預約回到「已確認」狀態\n• 扣回顧客累計消費與到訪次數（報表營收同步更新）\n保留不動（保護顧客既得權益）：\n• 已升等的會員等級\n• 已套用的票券\n• 已發給顧客的點數\n• 加購項目（不受還原影響，要移除請至詳情逐項刪）',
  },

  /* ------------------------------------------------------------------ 訊息 */
  messages: {
    created: '預約建立成功',
    /**
     * 時間或服務人員有變更 → 後端已觸發顧客端 LINE 推播（issue #27 ②）。
     * 推播是 fire-and-forget（06 分冊 §5），回應當下無從得知顧客是否真的收到，
     * 所以只說「已送出」並標明哪些情況收不到 —— 不宣稱「已通知顧客」。
     */
    updated: '預約已更新，已送出變更通知給顧客（未綁定 LINE 或已關閉此通知者不會收到）',
    /** 沒有觸發推播（例如只改備註，或 mock 模式）——不可謊稱已通知 */
    updatedNoNotify: '預約已更新（未送出顧客通知）',
    confirmed: '預約已確認',
    completed: '預約已完成',
    cancelled: '預約已取消',
    markedNoShow: '已標記為爽約',
    markedPaid: '已標記為已收款',
    reverted: '預約已還原為已確認',
    priceAdjusted: (amount: string) => `金額已調整為 ${amount}`,
    couponApplied: (discount: string, net: string) => `票券已套用！折抵 ${discount}，實收 ${net}`,
    pointsApplied: (points: number) => `點數折抵 ${points} 點 = $${points}`,
    overpaidWarning: (amount: string) =>
      `⚠️ 折抵後顧客已多付 ${amount}，請至您的金流後台手動退差額給顧客`,
    paidOverNet: (paid: string, net: string) =>
      `已收金額 ${paid} 高於新應付 ${net}，請確認是否退還差額`,

    /**
     * /pay/* 付款頁尚未建置（issue #32），複製鈕目前 disabled，此文案不應出現在任何
     * 渲染路徑。保留字串不刪，只是不再被 copyPayLink 呼叫——鈕重新啟用後才會再用到。
     */
    payLinkCopied: '付款連結已複製，可貼給顧客',

    exported: '預約匯出成功',
    exportFailed: '匯出失敗，請稍後再試',
    exportFailedPrefix: '匯出失敗:',
    exportFileName: (start: string, end: string, ext: string) => `預約清單_${start}_${end}.${ext}`,

    batchConfirmed: (n: number) => `成功確認 ${n} 筆預約`,
    batchCancelled: (n: number) => `成功取消 ${n} 筆預約`,
    batchConfirmFailed: '批次確認失敗',
    batchCancelFailed: '批次取消失敗',
    selectConfirmFirst: '請先選擇要確認的預約',
    selectCancelFirst: '請先選擇要取消的預約',
    noPendingSelected: '選取的預約中沒有「待確認」狀態的預約',
    noCancellableSelected: '選取的預約中沒有可取消的預約',

    requiredFields: '請填寫所有必填欄位',
    invalidAmount: '請輸入有效金額（0 以上的數字）',
    couponRequired: '請輸入票券代碼',
    itemNameRequired: '請輸入項目名稱',
    pastDate: '預約日期不能是過去的日期',

    createFailed: '建立預約失敗：',
    updateFailed: '更新預約失敗：',
    confirmFailed: '確認預約失敗：',
    cancelFailed: '取消預約失敗：',
    noShowFailed: '標記爽約失敗：',
    markFailed: '標記失敗：',
    adjustFailed: '調整失敗：',
    revertFailed: '還原失敗：',
    couponFailed: '套用票券失敗',
    couponCompleteFailed: '票券／點數已套用，但「完成預約」失敗：',
    removeAddonFailed: '移除加購失敗:',
    loadFailed: '載入預約失敗:',
    loadDetailFailed: '載入預約資料失敗：',
    loadCustomersFailed: '載入顧客失敗:',
    loadServicesFailed: '載入服務失敗:',
    loadStaffFailed: '載入員工失敗:',
    loadSlotsFailed: '載入可用時段失敗:',
    loadAddonsFailed: '載入加購明細失敗:',
    loadAddonOptionsFailed: '載入加購選項失敗:',
    tableLoadFailed: '載入失敗，請重新整理頁面',
    actionFailed: '操作失敗',
    unknownError: '未知錯誤',
    retryLater: '請稍後再試',
    networkError: '連線錯誤，請稍後再試',
  },

  empty: {
    title: '目前沒有預約',
    description: '調整篩選條件，或點右上角「新增預約」建立第一筆預約。',
  },
} as const;
