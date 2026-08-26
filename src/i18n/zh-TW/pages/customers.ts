/**
 * 顧客管理（/tenant/customers）文案
 * 表格、篩選器、進階篩選、4 個 modal 與所有 toast／確認訊息均逐字取自原站 DOM 與 inline JS。
 */
export const customersPage = {
  title: '顧客管理',
  metaTitle: '顧客管理 - 店家後台',
  subtitle: '管理您的顧客資訊與會員等級',
  tableTitle: '顧客列表',

  /* ------------------------------------------------------------ 頁面提示 */
  helpTip: {
    prefix: '提示：',
    text: '您可以透過搜尋欄位快速找到顧客，點擊「新增顧客」建立新的顧客資料。',
  },

  /* -------------------------------------------------------- 流失風險模式 */
  atRisk: {
    bannerTitle: '顧客流失預警 — 超過 30 天未回訪',
    count: (n: number) => `共 ${n} 位流失風險顧客`,
    backToAll: '返回全部顧客',
  },

  /* ------------------------------------------------------ 進階篩選功能鎖 */
  featureTip: {
    text: '依標籤與會員等級篩選顧客，需訂閱「進階顧客管理」（49 點/月）。',
    textLead: '依',
    textTag: '標籤',
    textMiddle: '與',
    textLevel: '會員等級',
    textTail: '篩選顧客，需訂閱「進階顧客管理」（49 點/月）。',
    learnMore: '了解',
  },

  /* ------------------------------------------------------------- 搜尋列 */
  search: {
    placeholder: '輸入姓名或電話搜尋...',
    statusFilter: { all: '全部顧客', atRisk: '流失風險' },
    level: '會員等級',
    levelAll: '全部等級',
    tag: '標籤篩選',
    tagAll: '全部標籤',
    minSpent: '最低消費',
    minSpentPlaceholder: '0',
    maxSpent: '最高消費',
    maxSpentPlaceholder: '不限',
    minVisits: '最低次數',
    minVisitsPlaceholder: '0',
    apply: '篩選',
    clear: '清除',
    advancedTitle: '進階篩選',
  },

  /* --------------------------------------------------------------- 表格 */
  columns: {
    info: '顧客資訊',
    contact: '聯絡方式',
    level: '會員等級',
    bookingCount: '預約次數',
    totalSpent: '消費金額',
    status: '狀態',
    actions: '操作',
  },

  labels: {
    and: ' 與 ',
    noNickname: '(未設定暱稱)',
    noName: '（尚未取得姓名）',
    lastVisit: (date: string) => `上次到訪 ${date}`,
    neverVisited: '從未到訪',
    totalZero: '共 0 筆資料',
    linePrefix: 'LINE：',
  },

  /* --------------------------------------------------------------- 動作 */
  actions: {
    export: '匯出 Excel',
    create: '新增顧客',
    edit: '編輯顧客',
    delete: '刪除顧客',
    detail: '查看詳情',
    bindLine: '綁定 LINE',
    unbindLine: '解除 LINE 綁定',
  },

  /**
   * ⚠️ 移除了 `orphan: '殘留綁定'` 與 `autoCreated: '自動建立檔案'`：這兩個徽章
   * 沒有任何資料來源（line_users 與 customers 都沒有對應欄位），接線前是靠一個
   * 寫死的 id 集合與頁內假資料掛上去的。查不到的狀態就不顯示。
   */
  status: {
    active: '正常',
    atRisk: '流失風險',
    inactive: '已停用',
    unbound: '未綁定',
  },

  /* -------------------------------------------------- modal 1：新增/編輯 */
  form: {
    createTitle: '新增顧客',
    editTitle: '編輯顧客',
    sectionBasic: '基本資料',
    sectionNote: '備註資訊',
    name: '姓名',
    namePlaceholder: '請輸入顧客姓名',
    nameInvalid: '請輸入顧客姓名',
    phone: '電話',
    phonePlaceholder: '例如：0912-345-678',
    phoneHelp: '用於預約通知和聯繫',
    phoneInvalid: '請輸入有效的電話號碼',
    email: '電子郵件',
    emailPlaceholder: 'example@email.com',
    emailInvalid: '請輸入有效的電子郵件格式',
    gender: '性別',
    birthday: '生日',
    birthdayHelp: '用於生日優惠活動通知',
    note: '備註',
    notePlaceholder: '記錄顧客的特殊需求、偏好或注意事項...',
    noteHelp: '可記錄顧客偏好、過敏資訊等',
    noteMax: 500,
  },

  /* ------------------------------------------------- modal 2：綁定 LINE */
  bindLine: {
    title: (name: string) => `綁定 LINE 用戶 — ${name}`,
    /**
     * ⚠️ 原文是「以下是綁定異常的 LINE 用戶（未綁定 / 顧客已被刪但 LINE 殘留）」。
     * 端點 GET /api/line-users/unbound 只回「已加好友且尚未綁定顧客」一種列，
     * 沒有任何欄位能判斷「顧客已被刪但 LINE 殘留」——留著那半句會讓店家以為
     * 清單裡混有殘留帳號並據此做判斷。文案改成只講端點真的查得到的事。
     */
    intro: '以下是已加入官方帳號、但尚未綁定任何顧客的 LINE 用戶。點選對應暱稱／頭像綁到此顧客：',
    loading: '載入中...',
    binding: '綁定中...',
    emptyTitle: '目前沒有待綁定的 LINE 用戶',
    emptyDescription: '顧客加入官方帳號並傳送訊息後，會出現在這份清單中。',
    loadFailed: '載入失敗，請稍後再試',
  },

  /* --------------------------------------- modal 3 / 4：解除綁定 / 確認 */
  confirm: {
    deleteTitle: '刪除顧客',
    delete: (name: string) => `確定要刪除顧客「${name}」嗎？`,
    unbindTitle: '解除 LINE 綁定',
    unbindLine: (name: string) => `確定要解除「${name}」的 LINE 綁定嗎？日後可重新綁定。`,
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    created: '顧客建立成功',
    updated: '顧客資料已更新',
    deleted: '顧客已刪除',
    deleteFailed: '刪除失敗',
    exported: '顧客匯出成功',
    exportFailed: '匯出失敗，請稍後再試',
    exportFailedPrefix: '匯出失敗:',
    saveFailedPrefix: '儲存失敗: ',
    saveCustomerFailed: '儲存顧客失敗:',
    phoneExists: '手機號碼已存在',
    phoneTaken: '此電話號碼已被其他顧客使用',
    checkFields: '請檢查標示紅色的欄位',
    lineBound: 'LINE 用戶綁定成功',
    lineUnbound: 'LINE 綁定已解除',
    bindFailed: '綁定失敗',
    bindFailedPrefix: '綁定失敗:',
    bindFailedRetry: '綁定失敗，請稍後再試',
    unbindFailed: '解除綁定失敗',
    loadCustomersFailed: '載入顧客失敗:',
    loadAtRiskFailed: '載入流失風險顧客失敗:',
    loadUnboundFailed: '載入未綁定 LINE 用戶失敗:',
    loadDetailFailed: '載入顧客詳情失敗',
    loadDetailFailedPrefix: '載入顧客詳情失敗:',
    loadFailedPrefix: '載入失敗：',
    loadFailedRetry: '載入失敗，請稍後再試',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  /* --------------------------------------------------------------- 匯出 */
  exportFile: {
    filename: (date: string) => `顧客清單_${date}.xlsx`,
  },

  empty: {
    title: '還沒有顧客資料',
    description: '顧客透過 LINE 或公開預約頁完成第一筆預約後會自動建檔，你也可以手動新增。',
  },
} as const;
