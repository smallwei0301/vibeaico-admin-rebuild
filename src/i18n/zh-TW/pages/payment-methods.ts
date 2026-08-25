/**
 * 收款方式（/tenant/payment-methods）文案
 * 逐字取自原站 DOM（formModal）與 inline JS 字串（含銀行建議清單）。
 * 全域的「回報問題」「AI 客服助理」文案在 common，不重複收錄。
 */
export const paymentMethodsPage = {
  title: '收款方式',
  metaTitle: '收款方式 - 店家後台',

  actions: {
    create: '新增收款方式',
    edit: '編輯收款方式',
    delete: '刪除',
    enable: '啟用',
    disable: '停用',
    testCharge: '實刷測試並開通（藍新 NT$1／綠界 NT$5）',
    testConnection: '檢查金流設定',
  },

  /* ---------------------------------------------------------- 收款類型 */
  methodTypes: {
    LINE_PAY: 'LINE Pay',
    JKOPAY: '街口支付',
    BANK_TRANSFER: '銀行轉帳',
    CASH: '現金',
    ONLINE_PAYMENT: '線上刷卡付款',
    OTHER: '其他',
  },
  /** 下拉選單的完整標籤（線上刷卡有額外說明） */
  methodTypeOptions: [
    { value: '', label: '請選擇' },
    { value: 'LINE_PAY', label: 'LINE Pay' },
    { value: 'JKOPAY', label: '街口支付' },
    { value: 'BANK_TRANSFER', label: '銀行轉帳' },
    { value: 'CASH', label: '現金' },
    { value: 'ONLINE_PAYMENT', label: '線上刷卡付款（顧客直接刷卡給你）' },
    { value: 'OTHER', label: '其他' },
  ],

  /* ---------------------------------------------------------- 卡片標記 */
  badges: {
    active: '啟用',
    inactive: '停用',
    verified: '已驗證開通',
    notVerified: '尚未驗證',
    notVerifiedLong: '尚未驗證（需實刷小額測試）',
    sandbox: '測試環境',
    demo: '🧪 示範測試（不會真的收款）',
    noImage: '尚無圖片',
  },

  /* ------------------------------------------------- modal：新增/編輯 */
  form: {
    createTitle: '新增收款方式',
    editTitle: '編輯收款方式',

    methodType: '收款類型 *',
    methodTypePlaceholder: '請選擇',
    displayName: '顯示名稱 *',
    displayNamePlaceholder: '如：LINE Pay、國泰世華銀行',

    qrCode: 'QR Code 圖片',
    qrNoImage: '尚無圖片',
    qrRemove: '移除圖片',
    qrTooLarge: '圖片大小不能超過 5MB',

    bankHint: '輸入銀行名稱可從建議清單選擇，系統自動帶入代碼；也可手動輸入。',
    bankName: '銀行名稱 *',
    bankNamePlaceholder: '點擊選擇或輸入銀行名稱',
    bankCode: '銀行代碼 (自動帶入)',
    bankCodePlaceholder: '如 013',
    bankNoMatch: '查無符合銀行，可直接手動輸入',
    accountNumber: '銀行帳號 *',
    accountNumberPlaceholder: '純數字，可加 - 分隔',
    accountHolder: '戶名 (選填)',
    accountHolderPlaceholder: '如：王小明',

    /* --------------------------------------------------- 線上刷卡付款 */
    onlineIntroLead: '設定你自己的金流帳號，讓顧客在預約時',
    onlineIntroStrong: '線上直接刷卡付款給你',
    onlineIntroTail: '——錢直接進「你自己的金流帳戶」，平台不經手。',
    onlineStepLead: '設定並用',
    onlineStepStrong: '小額實刷測試開通',
    onlineStepMiddle: '（藍新 NT$1／綠界 NT$5）後，到「服務項目」把服務設為',
    onlineStepStrong2: '收訂金 / 全額',
    onlineStepTail: '，顧客預約時就會被導向付款。',
    onlineApplyNote:
      '你需先向金流商申請商店帳號（需公司 / 商業登記），取得「商店代號 / HashKey / HashIV」後填在這裡。',
    onlineApplyLink: '前往藍新申請',

    gatewaySource: '金流來源',
    gatewaySourceOwn: '用我自己的金流帳號（正式收款，錢進你帳戶）',
    gatewaySourceDemo: '🧪 用示範測試金流（免申請、免帳號，先試整個流程）',
    demoNoticeLead: '示範測試金流走',
    demoNoticeStrong: '綠界官方沙箱',
    demoNoticeMiddle: '（免申請、免帳號）。實刷測試 / 顧客付款時用測試卡',
    demoNoticeCard: '4311-9522-2222-2222',
    demoNoticeMiddle2: '（月/年填未來、後三碼隨意），',
    demoNoticeStrong2: '不扣真錢、也不會真的收到錢',
    demoNoticeTail: '，只是讓你先體驗整個流程。正式對顧客收款請改選「用我自己的金流帳號」。',
    demoLabel: '示範測試金流',

    gatewayProvider: '金流服務商 *',
    gatewayProviderOptions: [
      { value: 'NEWEBPAY', label: '藍新金流 Newebpay（需商業登記）' },
      { value: 'ECPAY', label: '綠界科技 ECPay（個人可申請、免商業登記）' },
    ],
    providerNames: {
      NEWEBPAY: '藍新金流',
      ECPAY: '綠界科技',
    },
    merchantId: '商店代號 MerchantID *',
    merchantIdPlaceholder: '如 MS12345678',
    hashKey: 'HashKey *',
    hashKeyPlaceholder: '32 字元',
    hashKeySet: '已設定，如需更改再輸入（32 字元）',
    hashIv: 'HashIV *',
    hashIvPlaceholder: '16 字元',
    hashIvSet: '已設定，如需更改再輸入（16 字元）',
    sandbox: '測試環境（藍新沙箱 ccore，用測試卡不扣真錢）',

    sortOrder: '排序',
    isActive: '啟用',
    instructions: '付款說明',
    instructionsPlaceholder: '填寫付款備註或注意事項（選填）',

    requiredFields: '請填寫必填欄位',
  },

  /* ---------------------------------------- 尚未建置：誠實告示（不可省略） */
  /**
   * ⚠️ 這一區塊是「誠實化」文案，對應 CLAUDE.md「Never fabricate a known」。
   * 本頁沒有任何後端（無 /api/payment-methods、無 src/services 收款方式函式），
   * 所有互動都只改瀏覽器內的 React state。在真後端接上（issue #9）之前，
   * 頁面必須用這些文案說明「尚未生效」，不得再顯示任何成功訊息。
   */
  notBuilt: {
    title: '金流／收款方式後端尚未建置，本頁設定尚未生效',
    body:
      '此頁的收款方式目前只存在於這個瀏覽器畫面：新增、編輯、刪除、啟用／停用都不會寫入資料庫，重新整理就會消失，顧客的付款流程也完全不受影響。畫面上的卡片為示範資料。',
    verifyBody:
      '「實刷測試並開通」需要呼叫金流商 API，該後端尚未建置，因此本頁無法驗證任何金流帳號。卡片上的「已驗證開通」只會反映後端資料，不會因為在本頁操作而變成已開通。',
    savedNotEffective: '尚未生效：收款方式後端尚未建置，這筆內容只留在畫面上，未寫入資料庫。',
    deletedNotEffective: '尚未生效：僅從畫面移除，收款方式後端尚未建置，資料庫沒有變更。',
    toggleNotEffective: '尚未生效：啟用／停用只改變畫面，收款方式後端尚未建置，顧客端不受影響。',
    testChargeConfirm:
      '金流後端尚未建置，本頁無法送出實刷測試，也不會因此開通金流。按下確定不會產生任何付款、也不會改變驗證狀態。',
    testChargeNotAvailable: '未執行實刷測試：金流後端尚未建置，此收款方式仍為「尚未驗證」。',
  },

  /* -------------------------------------------------------- 實刷測試 */
  testCharge: {
    saveFirst: '請先儲存後再測試',
    dirtyBeforeTest: '你剛修改了金流設定，請先按「儲存」再測試',
    dirtyBeforeCheck: '你剛修改了金流設定，請先按「儲存」再檢查',
    createFailedPrefix: '建立測試付款失敗：',
    noForm: '未取得付款表單，請稍後再試',
    failed: '測試付款未成功，請確認金流設定（商店代號 / HashKey / HashIV）或稍後再試',
    checkPassed: '檢查通過',
    checkFailed: '檢查未通過',
    checkIncomplete: '檢查未完成，請稍後再試',
    checkFailedPrefix: '檢查失敗：',
  },

  /* ---------------------------------------------------------- 確認 / 訊息 */
  confirm: {
    deleteTitle: '刪除收款方式',
    delete: '確定要刪除此收款方式嗎？',
  },

  messages: {
    saveFailed: '儲存失敗:',
    saveFailedFull: '儲存失敗：',
    deleteFailed: '刪除失敗:',
    toggleFailed: '切換狀態失敗:',
    loadFailed: '載入收款方式失敗:',
    loadFailedRow: '載入失敗',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '尚未設定收款方式',
    description: '新增 LINE Pay、銀行轉帳或線上刷卡付款，顧客就能在預約流程看到付款資訊。',
  },

  /** 原站 inline JS 內建的銀行建議清單（名稱依原站順序） */
  banks: [
    '臺灣銀行',
    '土地銀行',
    '合作金庫銀行',
    '第一銀行',
    '華南銀行',
    '彰化銀行',
    '上海商業儲蓄銀行',
    '台北富邦銀行',
    '國泰世華銀行',
    '高雄銀行',
    '兆豐國際商業銀行',
    '臺灣中小企業銀行',
    '渣打國際商業銀行',
    '台中商業銀行',
    '京城商業銀行',
    '滙豐(台灣)商業銀行',
    '花旗(台灣)商業銀行',
    '星展(台灣)商業銀行',
    '臺灣新光商業銀行',
    '陽信商業銀行',
    '三信商業銀行',
    '聯邦商業銀行',
    '遠東國際商業銀行',
    '元大商業銀行',
    '永豐商業銀行',
    '玉山商業銀行',
    '萬泰商業銀行',
    '台新國際商業銀行',
    '安泰商業銀行',
    '中國信託商業銀行',
    '凱基商業銀行',
    '板信商業銀行',
    '樂天國際商業銀行',
    'LINE Bank 連線商業銀行',
    '將來商業銀行',
    '中華郵政（郵局）',
    '其他',
  ],
} as const;
