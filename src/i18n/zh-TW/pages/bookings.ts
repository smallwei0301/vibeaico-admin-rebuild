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
    exporting: '匯出中…',
    /**
     * 兩個匯出選項目前打的是同一支端點（`GET /api/export/bookings` 沒有 format
     * 路徑段），拿到的是同一個 UTF-8 加 BOM 的 CSV。標籤照 reports 頁的作法
     * 寫明實際格式——寫「匯出 Excel」卻送一個 .csv 出去就是謊報檔案格式。
     * 格式段列在 issue #33 ③，補上後這兩個選項才會真的不同。
     */
    exportExcelCsv: '匯出 Excel 可開啟的 CSV',
    exportCsv: '匯出 CSV',
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
    /*
     * issue #35：「標記尾款已結清」原本靠頁內假的「已收金額 > 0」決定要不要顯示。
     * 我方沒有金額型付款欄位（14 分冊 §6.14／§6.17），判定不出「還有沒有尾款」，
     * 所以這個標題目前沒有任何渲染路徑會用到——待「已收金額」的裁決落地後才會回來。
     */
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
    /*
     * issue #35：原站的「已付訂金」＝ `paidAmount > 0 且未付清`。我方 payment_status
     * enum 沒有這個狀態、也沒有 paid_amount 欄位，判定不出來 → 目前沒有渲染路徑，
     * 保留字串等「已收金額」裁決落地後才會用到（同 markBalancePaid）。
     */
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
    /*
     * ⚠️ 原站這個欄位的標籤是「執行 服務人員 （業績歸戶）」。
     * 依 2026-08-25 主導者裁示（issue #1 comment-5412922443），加購金額的業績
     * 算法是「與主服務同一位服務人員、依實收金額全額計入」——也就是**不看**這一欄。
     * 標籤若照原站留著「（業績歸戶）」，畫面就會宣稱一件程式沒有做的事
     * （CLAUDE.md「Never fabricate a known」），所以改成描述它真正的作用，
     * 並用 staffHelp 明說業績實際歸給誰。
     * 若日後改採逐項歸戶，這兩行文案要跟著算法一起改回。
     */
    staffLabel: '執行 服務人員',
    staffSame: '同本預約的人員',
    staffHelp: '此欄只記錄「這項加購由誰執行」；加購金額的業績一律計入本預約的服務人員（依實收金額全額計入）。',
    notifyLabel:
      '通知顧客消費明細（連續加多項時可先勾掉、最後一項再通知，避免顧客連收多則）',
    notifyHelp:
      '需要顧客已綁定 LINE 且本月推播額度足夠，每則扣 1 則推播額度；實際有沒有送出，送出後會照實告訴您。',
    footnote:
      '選「不佔時間」的加購只加金額；有佔用時長的加購會把預約結束時間往後延，若因此與同一位服務人員的下一筆預約重疊，系統會擋下並提示您先調整時段。',
    submit: '加入',
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
       * issue #17：加購後端已建置（migration 0020 + /api/bookings/:id/addons）。
       * 這一句在 issue #3 曾被誠實化為「加購也不會生效」，現在三件事都真的會發生，
       * 所以改回推薦加購——但只寫程式真的會做的事：
       *   延長時段 ✅（applied_minutes 進 end_at）
       *   記業績  ✅（金額進 final_price → staff-performance 依 bookings.staff_id 聚合）
       *   通知顧客 ⚠️ 只有勾了 addonNotify 才會送，所以寫成「可勾選通知」而不是「會通知」。
       */
      '• 若是「多做了項目/多花了時間」：建議改用「加購」——加購會延長預約時段、金額計入本預約服務人員的業績，也可勾選通知顧客消費明細',
    ],
    label: '金額',
    /*
     * ⚠️ 原句是「明細僅供參考、師父業績仍按明細歸戶」。依主導者裁示，業績是
     * 「本預約的服務人員、實收金額全額計入」，並不按明細逐項歸戶——原句會宣稱
     * 一件程式沒有做的事。改成講**手動調價與回沖的真實互動**（這才是店家調價前
     * 真正需要知道的事，見 addons route 檔頭「回沖」的定義）。
     */
    withAddonsWarning: (n: number) =>
      `此預約有 ${n} 筆加購明細。手動調整總價會直接覆寫目前金額；之後若移除某筆加購，系統仍會扣回「該筆加購當初加上去的金額」，結果可能與您現在輸入的總價對不上。確定要手動調價嗎？`,
    submit: '確認調整',
  },

  /* -------------------------------------------------------- 使用點數 modal */
  pointsModal: {
    title: '使用點數',
    intro: '以顧客的點數折抵此筆預約金額。',
    balanceLabel: '顧客可用點數',
    /**
     * issue #35：餘額來自 `customers.points`（經 bookings_view.customer_points）。
     * 這一列還沒帶到餘額時顯示 `--`，**不可以顯示 0**——0 是「這位顧客沒有點數」，
     * 是一個有意義的答案，拿它當「還不知道」會讓店家以為顧客無點可折。
     */
    balanceUnknown: '--',
    balanceUnknownHint: '這筆預約沒有帶到顧客的點數餘額，數字不是 0，是還不知道。',
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
      '此預約尚未標記收款。若已收現金／轉帳，請按「標記已線下收款」（線上付款連結尚未建置，詳見 issue #32）。',
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
    /*
     * 明細向 API 取的期間顯示這一句，**不可以直接顯示「無資料」**——
     * 那會在還不知道的時候宣稱「已知為空」（issue #17 的 Playwright 實測抓到：
     * 金額已是加購後的數字、明細卻寫「無資料」，讀起來像明細不見了）。
     */
    addonLoading: '加購明細載入中…',
    addonLoadFailed: '加購明細載入失敗（可能仍有加購項目，請重新開啟詳情確認）',
    amountLabel: '應收金額',
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
    /*
     * issue #17：刪除加購的「回沖」是**減去該筆加購當初實際加上去的金額**，
     * 不是重算。若這筆加購之後又調過價、或套用了百分比折扣的票券，扣回的數字
     * 就會與店家心裡的數字不同（見 addons route 檔頭列的兩種不精確互動）。
     * 那兩種情況無法從資料判定，所以**不猜**：把「將扣回多少」這個確定的數字
     * 直接寫在確認視窗給店家看（CLAUDE.md：不得已的取捨要寫在使用者讀得到的地方，
     * 不能只寫在程式註解裡）。
     */
    removeAddon: (name: string, amount: string, minutes: number) =>
      `確定要移除加購「${name}」嗎？\n\n・預約金額將扣回 ${amount}（這是該筆加購當初加上去的金額）`
      + (minutes > 0 ? `\n・預約結束時間將往前 ${minutes} 分鐘` : '')
      + '\n\n若這筆加購之後曾手動調價或套用過打折的票券，扣回後的總金額請再確認一次。',
    /*
     * issue #35：金額拿掉了。原站是 `⚠️ 此預約已線上收款${amt ? …}`——**原站自己**
     * 就把金額寫成條件式，因為它也可能不知道；我方沒有 paid_amount 欄位，一律走
     * 無金額的那一支，而不是編一個數字填進去。
     */
    cancelPaidWarning:
      '⚠️ 此預約已收款。取消後系統不會自動退款，請記得至您的金流後台手動退款給顧客。確定要取消嗎？',
    batchConfirm: (n: number) =>
      `確定要批次確認 ${n} 筆預約嗎？\n\n確認後這些時段都會被佔用。確定要全部確認嗎？`,
    batchUnpaidWarning: (selected: number, unpaid: number) =>
      `⚠️ 選取的 ${selected} 筆中，有 ${unpaid} 筆需線上付款但尚未收足：\n\n`,
    batchUnpaidMore: (n: number) => `・…等共 ${n} 筆`,
    batchCancel: (n: number, refundWarn: string) => `確定批次取消 ${n} 筆預約嗎？${refundWarn}`,
    /** issue #35：同 cancelPaidWarning，金額（共 $X）拿掉——我方算不出這個總額。 */
    batchRefundWarning: (n: number) =>
      `\n\n⚠️ 其中 ${n} 筆已收款，系統不會自動退款，請記得至您的金流後台手動退款給顧客。`,
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
    /**
     * issue #35：調價後「已收金額高於新應付」的提醒需要 paid_amount，我方沒有這個
     * 欄位（14 分冊 §6.14／§6.17），比不出來就不顯示 → 目前沒有渲染路徑。
     * 保留字串，待「已收金額」的裁決落地後接回。
     */
    paidOverNet: (paid: string, net: string) =>
      `已收金額 ${paid} 高於新應付 ${net}，請確認是否退還差額`,

    /**
     * /pay/* 付款頁尚未建置（issue #32），複製鈕目前 disabled，此文案不應出現在任何
     * 渲染路徑。保留字串不刪，只是不再被 copyPayLink 呼叫——鈕重新啟用後才會再用到。
     */
    payLinkCopied: '付款連結已複製，可貼給顧客',

    exported: '預約匯出成功',
    /**
     * 檔名一律取自伺服器回的 `Content-Disposition`（issue #28 ③④）。
     * 前端不得自組檔名——`exportFileName` 那種「用當天日期拼一個看起來合理的
     * 檔名」正是本輪要清掉的假的已知。
     */
    exportedAs: (fileName: string) => `預約匯出成功：${fileName}`,
    /** 示範資料模式沒有伺服器可打，沒有檔案產生——不得顯示成功 */
    exportNotDownloaded: '示範資料模式不會產生檔案，未匯出任何預約；請切換到實際店家後再匯出',
    exportFailed: '匯出失敗，請稍後再試',
    exportFailedPrefix: '匯出失敗:',

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
    /* ------------------------------------------------ 加購結果（issue #17）
     * 每一則只描述**真的發生過的事**。加購一定會寫入（成功回應才會走到這裡），
     * 差別在「消費明細有沒有送出去」——那是 API 依實際結果回來的 notified 值，
     * 一種結果一句話，不可合併成一句「已通知顧客」（00 鐵則 12）。
     */
    addonAdded: (amount: string) => `已新增加購，預約金額改為 ${amount}`,
    addonAddedNotified: (amount: string) =>
      `已新增加購，預約金額改為 ${amount}；消費明細已用 LINE 送給顧客（扣 1 則推播額度）`,
    addonAddedNoLine: (amount: string) =>
      `已新增加購，預約金額改為 ${amount}；顧客未綁定 LINE，消費明細沒有送出，請自行告知顧客`,
    addonAddedLineNotConfigured: (amount: string) =>
      `已新增加購，預約金額改為 ${amount}；本店尚未設定 LINE Channel，消費明細沒有送出`,
    addonAddedNotifyFailed: (amount: string) =>
      `已新增加購，預約金額改為 ${amount}；消費明細送出失敗（LINE 平台回報錯誤），請自行告知顧客`,
    addonRemoved: (amount: string) => `已移除加購，預約金額扣回 ${amount}`,
    addonFailed: '新增加購失敗：',
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
