/**
 * 員工管理（/tenant/staff）文案
 * 逐字取自原站 DOM（headings / alerts / tables / modals）與 inline JS 字串。
 * 全域的「回報問題」「AI 客服助理」文案在 common，不重複收錄。
 */
export const staffPage = {
  title: '員工管理',
  metaTitle: '員工管理 - 店家後台',
  tableTitle: '員工列表',

  /* ------------------------------------------------------------ 頁面提示 */
  /** 原站 alert-info：上班時段、輪休、班別範本請至 班表管理 ；此頁僅管理員工基本資料與請假。 */
  shiftsTip: {
    lead: '上班時段、輪休、班別範本請至',
    link: '班表管理',
    /** 連結 title：原站 hover 提示 */
    linkTitle: '班表管理（排班/輪休/範本）',
    tail: '；此頁僅管理員工基本資料與請假。',
  },

  /* -------------------------------------------------- 免費版員工數量上限 */
  limit: {
    reached: (max: number) => `員工數量已達免費版上限（${max} 位）`,
    currentLead: '目前 ',
    currentTail: ' 位',
    upsell: '訂閱「無限員工」（129 點/月）後即可新增更多員工。',
    subscribe: '前往訂閱',
  },

  /* ---------------------------------------------------------------- 表格 */
  columns: {
    index: '#',
    info: '員工資訊',
    contact: '聯絡方式',
    bookable: '可預約',
    status: '狀態',
    actions: '操作',
  },

  labels: {
    yes: '是',
    no: '否',
    allStaffCapable: '全員可做',
    /** 骨架補充：原站以拖曳排序，這裡改用上移／下移按鈕 */
    moveUp: '上移',
    moveDown: '下移',
  },

  status: {
    active: '啟用',
    inactive: '停用',
  },

  /* ---------------------------------------------------------------- 動作 */
  actions: {
    create: '新增員工',
    edit: '編輯員工',
    delete: '刪除員工',
    leave: '請假管理',
    copyLink: '複製員工專屬連結',
    staffTerm: '自訂員工稱呼',
  },

  /* ------------------------------------------- modal：自訂員工稱呼 */
  staffTerm: {
    title: '自訂員工稱呼',
    label: '員工統稱',
    placeholder: '服務人員（預設）',
    help:
      '例如：專業技術師 / 美容師 / 治療師 / 教練。此稱呼會套用到後台、公開預約頁、LINE 與通知信。留空＝恢復預設「服務人員」。',
    /** 留空時恢復的預設稱呼 */
    defaultTerm: '服務人員',
    changed: (val: string) => `已將稱呼改為「${val}」`,
    restored: '已恢復預設稱呼「服務人員」',
  },

  /* ------------------------------------------------ modal：新增/編輯員工 */
  form: {
    createTitle: '新增員工',
    editTitle: '編輯員工',
    avatar: '頭像',
    avatarHelp: '點擊上傳頭像（最大 2MB）',
    avatarRemove: '移除頭像',
    avatarTooLarge: '圖片大小不可超過 2MB',
    name: '姓名 *',
    nameInvalid: '請輸入員工姓名（最多50字）',
    /** 錯誤彙整清單用的欄位名 */
    nameField: '員工姓名',
    displayName: '顯示名稱',
    displayNameHelp: '用於顧客端顯示，不填則使用姓名',
    phone: '電話',
    phoneInvalid: '請輸入有效的電話號碼',
    email: '電子郵件',
    emailInvalid: '請輸入有效的電子郵件',
    /** 錯誤彙整清單用的欄位名 */
    emailField: 'Email 格式',
    bio: '簡介',
    bioMax: 500,
    maxConcurrentBookings: '同時段最大預約數',
    maxConcurrentBookingsHelp: '此員工同一時段可同時接待的預約數量（預設 1）',
    /** `{catalog}` 由頁面在 render 期展開：嚮導的員工承接的是行程與方案 */
    services: '可承接的{catalog}',
    servicesSelectAll: '全選',
    servicesClear: '清除',
    servicesHelp:
      '與「{catalog} → 可承接的服務人員」是同一份設定。標「全員可做」的服務目前未限制人員——取消勾選會把它改成「指定名單」（新進員工不再自動涵蓋）。',
    /** 取消勾選「全員可做」服務時的二次確認 */
    unlinkAllStaffConfirm: (serviceName: string) =>
      `「${serviceName}」原為全員可做；取消勾選後將改為「指定名單」（其餘人員保留、新進人員不再自動涵蓋）。確定嗎？`,
    isBookable: '可接受預約',
    isVisible: '顯示於前台',
    validationLead: '請檢查：',
  },

  /* ------------------------------------------------------ modal：請假管理 */
  leave: {
    /** 標題後面接員工姓名（原站標題為「請假管理 -」） */
    title: '請假管理',
    titleWith: (name: string) => `請假管理 - ${name}`,
    createSectionTitle: '新增請假',
    type: '請假類型',
    typeOptions: {
      PERSONAL: '事假',
      SICK: '病假',
      VACATION: '休假',
      ANNUAL: '特休',
      OTHER: '其他',
      BLOCKED: '封鎖時段',
    },
    recurrence: '循環類型',
    recurrenceSingle: '單次',
    recurrenceWeekly: '每週',
    date: '請假日期 *',
    dateHelp: '可選擇單一日期或使用下方快速選擇',
    dayOfWeek: '星期幾 *',
    reason: '請假原因（選填）',
    reasonPlaceholder: '例如：家中有事、身體不適等',
    quickPick: '快速選擇',
    quickTomorrow: '明天',
    quickNextWeekdays: '下週一~五',
    quickThisWeekend: '本週末',
    quickNextWeekend: '下週末',
    selectedDates: '已選擇日期',
    selectedDatesWith: (dates: string) => `已選擇日期：${dates}`,
    fullDay: '整天',
    startTime: '開始時間',
    endTime: '結束時間',
    submit: '新增請假',
    submitting: '新增中...',
    listTitle: '已排定請假',
    listHint: '顯示未來 60 天內的請假',
    columns: {
      date: '日期',
      weekday: '星期',
      type: '類型',
      reason: '原因',
      actions: '操作',
    },
    /** 表格日期欄：2026/08/21 (週五) */
    dateWithWeekday: (date: string, weekday: string) => `${date} (${weekday})`,
    weeklyBadge: '每週',
    fullDayBadge: '整天',
    emptyText: '目前沒有排定的請假',
    loadFailedRow: '載入失敗',
    deleteConfirm: '確定要刪除此請假記錄嗎？',
  },

  /* ---------------------------------------------------------- 確認 / 刪除 */
  confirm: {
    deleteTitle: '刪除員工',
    delete: '確定要刪除此員工嗎？此操作無法復原。',
  },

  /* ---------------------------------------------------------------- 驗證 */
  validation: {
    timeRequired: '請填寫開始和結束時間',
    dateRequired: '請選擇請假日期',
    startBeforeEnd: '開始時間必須早於結束時間',
    startBeforeBusiness: (time: string) => `開始時間不能早於營業開始時間（${time}）`,
    endAfterBusiness: (time: string) => `結束時間不能晚於營業結束時間（${time}）`,
    overlapBreak: (range: string) => `時段與休息時間（${range}）重疊，休息時段本來就不營業`,
  },

  /* ---------------------------------------------------------------- 訊息 */
  messages: {
    created: '員工建立成功',
    updated: '員工更新成功',
    deleted: '員工已刪除',
    reordered: '員工順序已更新',
    reorderFailed: '排序失敗，重新整理後恢復',
    linkCopied: '已複製員工專屬連結',
    linkFailed: '產生連結失敗',
    linkFailedPrefix: '產生連結失敗: ',
    leaveCreated: '請假已新增（衝突由店家自行通知）',
    leaveCreatedCount: (n: number) => `成功新增 ${n} 筆請假`,
    leaveCreatedWeekly: '成功新增每週請假',
    leaveDeleted: '請假記錄已刪除',
    saveStaffFailed: '儲存員工失敗:',
    saveFailedPrefix: '儲存失敗: ',
    createFailedPrefix: '新增失敗: ',
    deleteStaffFailed: '刪除員工失敗:',
    deleteFailedPrefix: '刪除失敗: ',
    deleteLeaveFailed: '刪除請假失敗:',
    createLeaveFailed: '新增請假失敗:',
    loadStaffFailed: '載入員工失敗:',
    loadDetailFailed: '載入員工詳情失敗',
    loadDetailFailedPrefix: '載入員工詳情失敗:',
    loadLeavesFailed: '載入請假列表失敗:',
    loadFailedRow: '載入失敗',
    loadFailedRetry: '載入失敗，請重新整理頁面',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    /** 原站表格內文字：暫無員工，請點擊「新增員工」建立 */
    text: '暫無員工，請點擊「新增員工」建立',
    title: '暫無員工',
    description: '請點擊「新增員工」建立',
  },
} as const;
