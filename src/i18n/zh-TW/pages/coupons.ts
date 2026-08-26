/**
 * 票券管理（/tenant/coupons）文案
 * 表格、搜尋／篩選、7 個 modal（新增/編輯、核銷、反核銷、發放、詳情、發布類確認、刪除確認）
 * 與所有 toast／確認訊息均逐字取自原站 DOM 與 inline JS。
 */
export const couponsPage = {
  title: '票券管理',
  metaTitle: '票券管理 - 店家後台',
  tableTitle: '票券列表',

  /* ---------------------------------------------------- 功能訂閱提示（鎖） */
  feature: {
    title: '票券系統',
    lead: '未訂閱時',
    strong: '無法建立或發布任何票券',
    tail: '，顧客端的領券入口也不會出現。已建立的票券資料會保留，訂閱後立即恢復。',
    learnMore: '了解',
  },

  /* ------------------------------------------------------------- 搜尋/篩選 */
  search: {
    placeholder: '搜尋票券名稱...',
    statusOptions: [
      { value: '', label: '全部狀態' },
      { value: 'DRAFT', label: '草稿' },
      { value: 'PUBLISHED', label: '已發布' },
      { value: 'PAUSED', label: '已暫停' },
      { value: 'EXPIRED', label: '已過期' },
      { value: 'ENDED', label: '已結束' },
    ],
  },

  /* ------------------------------------------------------------------ 表格 */
  columns: {
    name: '票券名稱',
    type: '類型',
    discount: '折扣',
    validPeriod: '使用期限',
    issued: '已發放/上限',
    status: '狀態',
    actions: '操作',
  },

  status: {
    DRAFT: '草稿',
    PUBLISHED: '已發布',
    PAUSED: '已暫停',
    EXPIRED: '已過期',
    ENDED: '已結束',
  },

  types: {
    DISCOUNT_AMOUNT: '折價券',
    DISCOUNT_PERCENT: '折扣券',
    GIFT: '兌換券',
    ADDON: '加購券',
  },

  typeOptions: [
    { value: 'DISCOUNT_AMOUNT', label: '折價券（固定金額）' },
    { value: 'DISCOUNT_PERCENT', label: '折扣券（百分比）' },
    { value: 'GIFT', label: '兌換券' },
    { value: 'ADDON', label: '加購券' },
  ],

  labels: {
    private: '🔒 私密',
    unlimited: '無限',
    noLimit: '無限制',
    noExpiry: '無期限',
    unnamed: '未命名',
    unknown: '未知',
    discountPrefix: '折抵 ',
    giftItem: '兌換品',
    gift: (item: string) => `兌換：${item}`,
    discountAmount: (amount: string) => `折抵 ${amount}`,
    percentOff: (percent: number) => `${percent}% off`,
    issuedOf: (issued: number, total: number | null) =>
      `${issued} / ${total === null ? '無限' : total}`,
    redeemed: (n: number) => `已核銷 ${n}`,
  },

  /* ------------------------------------------------------------------ 動作 */
  actions: {
    redeem: '核銷票券',
    create: '新增票券',
    edit: '編輯票券',
    delete: '刪除票券',
    view: '票券詳情',
    issue: '發放',
    publish: '發布',
    pause: '暫停',
    resume: '恢復',
    undoRedeem: '還原票券（反核銷）',
  },

  /* ------------------------------------------------ modal 1：新增 / 編輯票券 */
  form: {
    createTitle: '新增票券',
    editTitle: '編輯票券',
    publishedNotice: '已發布的票券，類型與折扣欄位不可修改，僅可調整名稱、說明、使用期限、數量與圖片。',
    name: '票券名稱',
    nameInvalid: '請輸入票券名稱',
    type: '類型',
    discountAmount: '折抵金額',
    discountAmountInvalid: '請輸入折抵金額',
    minOrderAmount: '最低消費金額',
    minOrderAmountHelp: '不填則無門檻',
    discountPercent: '折扣',
    discountPercentPlaceholder: '例如：10 表示打9折',
    discountPercentUnit: '% off',
    discountPercentHelp: '輸入 10 表示打 9 折，20 表示打 8 折',
    maxDiscountAmount: '最高折抵金額',
    maxDiscountAmountHelp: '不填則無上限',
    giftItem: '兌換項目',
    giftItemPlaceholder: '例如：免費護髮一次',
    addonItem: '加購項目',
    addonItemPlaceholder: '例如：精油護理',
    addonPrice: '加購價',
    currencyUnit: 'NT$',
    validStartAt: '使用期限開始',
    validStartAtHelp: '不填則從發放時開始',
    validEndAt: '使用期限結束',
    validEndAtError: '結束時間必須晚於開始時間',
    validEndAtHelp: '不填則無期限（到期自動失效排程不適用）',
    totalQuantity: '發行數量',
    totalQuantityHelp: '不填則無上限',
    limitPerCustomer: '每人限領數量',
    limitPerCustomerHelp: '不填則每人限領 1 張',
    privateMode: '🔒 私密票券',
    privateModeHelp:
      '開啟後這張票券不會出現在公開頁與 LINE 領券清單、顧客無法自行領取，只能由您在票券列表按「發放」指定顧客發送（適合失誤補償券、熟客專屬券）',
    description: '使用說明',
    image: '票券圖片',
    imageUpload: '點擊上傳圖片（最大 2MB）',
    imageRemove: '移除圖片',
    imageTooLarge: '圖片大小不可超過 2MB',
    endBeforeStart: '使用期限結束必須晚於開始時間',
  },

  /* ------------------------------------------------------ modal 2：核銷票券 */
  redeem: {
    title: '核銷票券',
    codeLabel: '輸入票券代碼',
    codePlaceholder: '例如: ABC12345',
    codeHelp: '請輸入顧客出示的票券代碼',
    codeRequired: '請輸入票券代碼',
    orderAmountLabel: '消費金額 (選填，折扣券必填)',
    orderAmountPlaceholder: '輸入顧客消費金額',
    orderAmountHelp: '折扣券（百分比）需填入消費金額才能計算實際折扣',
    submit: '確認核銷',
    submitting: '核銷中...',
    success: (couponName: string, discountInfo: string, customerName: string, code: string) =>
      `核銷成功！${couponName}${discountInfo}｜顧客：${customerName}｜代碼：${code}`,
    discountInfoAmount: (amount: number) => `｜折抵 $${amount}`,
    discountInfoActual: (amount: number) => `｜折抵 $${amount}`,
    discountInfoGift: (item: string) => `｜兌換：${item}`,
    failedPrefix: '核銷失敗:',
    failedCheckCode: '核銷失敗，請檢查票券代碼',
  },

  /* -------------------------------------------------- modal 3：還原（反核銷） */
  undo: {
    title: '還原票券（反核銷）',
    lead: (couponName: string, code: string) =>
      `將 ${couponName}（代碼 ${code}）還原成「未使用」，顧客可以再次使用。`,
    noticeTitle: '還原前請先確認',
    notices: [
      {
        strong: '顧客不會收到通知',
        text: '，請自行告知他票券已經還原。',
        lead: '',
      },
      {
        lead: '這筆折抵會從報表的「票券折抵金額」與「已使用票券數」中移除，',
        strong: '包含已經產生的月報',
        text: '。',
      },
      {
        lead: '如果顧客 ',
        strong: '實際上已經享受過',
        text: ' 這次折扣，請改用「發放新票券」，不要用還原。',
      },
      {
        lead: '如果這張券是在 POS 結帳時核銷的，',
        strong: '當時扣掉的點數不會退回',
        text: '，需要另外到點數調整處理。',
      },
    ],
    reasonLabel: '還原原因',
    reasonPlaceholder: '例：店員誤核銷／顧客當場表示要留到下次',
    reasonHelp: '會寫進系統紀錄，供日後查核。',
    reasonRequired: '請填寫還原原因',
    submit: '確認還原',
    submitting: '還原中...',
    failedPrefix: '反核銷失敗:',
    success: '票券已還原為未使用',
  },

  /* -------------------------------------------------- modal 4：發放給指定顧客 */
  issue: {
    title: (couponName: string) => `發放給指定顧客 — ${couponName}`,
    keywordPlaceholder: '搜尋姓名/電話...',
    tagPlaceholder: '標籤（如：社區）',
    minVisitsPlaceholder: '來店 ≥ N 次',
    query: '查詢',
    selectAll: '全選本頁',
    selectedCount: (n: number) => `已選 ${n} 位（單次上限 200）`,
    beforeQuery: '請按「查詢」載入顧客',
    noMatch: '沒有符合條件的顧客',
    loadFailed: '載入顧客失敗',
    visits: (n: number) => `來店 ${n} 次`,
    truncated: '僅顯示前 200 位顧客，請用搜尋/標籤/來店次數縮小範圍',
    reachedLimit: '已達單次 200 位上限，其餘未勾選',
    lineQuotaHint: (n: number) => `已選名單中 ${n} 位綁定 LINE，將消耗約 ${n} 則推播額度`,
    batchLimit: '單次最多發放 200 位，請分批發放',
    selectSomeone: '請先勾選要發放的顧客',
    sourceDescPlaceholder: '例如：社區專屬優惠 / 來店滿10次獎勵',
    sourceDescLabel: '發放說明（記錄在票券來源，選填）',
    notifyLead: '同時發送 LINE 通知（',
    notifyStrong: '已綁 LINE 的顧客才會收到',
    notifyTail: '，每則消耗 1 推播額度）',
    submit: '發放票券',
    submitting: '發放中...',
    confirm: (n: number) => `確定發放給 ${n} 位顧客嗎？已達領取上限的顧客會自動略過。`,
    confirmTitle: '發放票券',
    max: 200,
    columns: {
      select: '',
      name: '姓名',
      phone: '電話',
      visits: '來店次數',
    },
    failedPrefix: '批次發放失敗:',
    loadCustomersFailed: '載入顧客失敗:',
  },

  /* ------------------------------------------------------ modal 5：票券詳情 */
  detail: {
    title: '票券詳情',
    loading: '載入中...',
    discountContent: '優惠內容：',
    discountAmount: '折抵金額：',
    minOrderAmount: '最低消費：',
    discountPercent: '折扣：',
    maxDiscountAmount: '最高折抵：',
    giftItem: '兌換項目：',
    addonItem: '加購項目：',
    addonPrice: '加購價：',
    /*
     * issue #35：`applicableServices`（適用服務：）已隨欄位一併移除——原站詳情有這一行，
     * 但原站 formModal 沒有任何欄位可以設定它（docs/specs/coupons.json 全文只有詳情那
     * 一處出現），我方也沒有寫入路徑，留著等於永遠不會出現的死文案。
     */
    usageDescription: '使用說明：',
    visibility: '可見性：',
    visibilityPrivate: '🔒 私密票券（不在公開頁與 LINE 顯示，僅限「發放」指定顧客）',
    loadFailed: '載入票券詳情失敗',
    loadFailedPrefix: '載入票券詳情失敗:',
  },

  /* ---------------------------------------- modal 6 / 7：發布類確認、刪除確認 */
  confirm: {
    publishTitle: '發布票券',
    publish: '確定要發布此票券嗎？發布後顧客可從 LINE 領取。',
    publishPrivate:
      '確定要發布此私密票券嗎？發布後才能按「發放」指定顧客發送；發布本身不會出現在公開頁或 LINE，顧客也無法自行領取。',
    pauseTitle: '暫停票券',
    pause: '確定要暫停此票券嗎？暫停後顧客無法領取。',
    resumeTitle: '恢復票券',
    resume: '確定要恢復此票券嗎？恢復後顧客可繼續領取。',
    deleteTitle: '刪除票券',
    delete: '確定要刪除此票券嗎？',
  },

  /* ------------------------------------------------------------------ 訊息 */
  messages: {
    created: '票券建立成功',
    updated: '票券更新成功',
    deleted: '票券已刪除',
    published: '票券已發布',
    paused: '票券已暫停',
    resumed: '票券已恢復發布',
    checkFields: '請檢查標示紅色的欄位（名稱、類型、金額等）',
    saveFailedPrefix: '儲存失敗: ',
    saveCouponFailed: '儲存票券失敗:',
    deleteFailedPrefix: '刪除失敗：',
    deleteCouponFailed: '刪除票券失敗:',
    publishFailedPrefix: '發布失敗：',
    pauseFailedPrefix: '暫停失敗：',
    resumeFailedPrefix: '恢復失敗：',
    loadCouponsFailed: '載入票券失敗:',
    loadFailed: '載入失敗',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '暫無票券',
    description: '建立第一張票券後，顧客就能從 LINE 領取並到店核銷。',
    filteredTitle: '沒有符合條件的票券（試試清除搜尋/篩選）',
  },
} as const;
