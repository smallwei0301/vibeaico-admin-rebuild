/**
 * 班表管理（/tenant/shifts）文案
 * 逐字取自原站 DOM（toolbar / alert / tables / shiftModal / weeklyScheduleModal / tplModal）
 * 與 inline JS 字串。全域的「回報問題」「AI 客服助理」文案在 common，不重複收錄。
 */
export const shiftsPage = {
  title: '班表管理',
  metaTitle: '班表管理 - 店家後台',

  /* ------------------------------------------------------------ 優先序說明 */
  priorityNote: {
    label: '優先序：',
    text: '店家封鎖 > 班表（指定日）> 請假 > 週排班。有班表記錄時，該員工當日以班表為準，忽略請假與週排班。',
  },

  /* ---------------------------------------------------------------- 工具列 */
  toolbar: {
    prev: '上一頁',
    next: '下一頁',
    today: '今天',
    thisWeek: '本週',
    thisMonth: '本月',
    nextMonth: '下個月',
    jumpDate: '自訂日期：',
    weeks1: '1 週',
    weeks2: '2 週',
    weeks4: '4 週',
    repeatCycle: '循環重複到…',
    manageTemplates: '管理範本',
  },

  /* ---------------------------------------------------------------- 表格 */
  columns: {
    staff: '員工',
    mode: '排班模式',
  },
  modeHint: '點按鈕可切換',

  /** 排班模式 */
  modes: {
    FIXED_REST: '固定休息',
    ROTATING: '輪休',
  },
  modeSwitchConfirm: (label: string) => `將此員工切換為「${label}」模式？`,
  modeSwitched: (label: string) => `已切換為${label}`,

  /* ---------------------------------------------------------- 格子狀態 */
  cell: {
    dash: '—',
    off: '休',
    working: '上班',
    notWorking: '未上班',
    notScheduled: '未排班',
    leave: '請假',
    blocked: '封鎖',
    custom: '自訂',
    halfDayLeave: '(半天假)',
    addShift: '新增班別',
    editShift: '編輯班別',
    templateEarly: '早班',
    templateLate: '晚班',
  },

  /* -------------------------------------------------- 格子 tooltip / 說明 */
  tooltip: {
    businessHoursLabel: '店家營業時間：',
    weeklyLabel: (weekday: string) => `${weekday}週排班：`,
    onLeaveLabel: '當天已請假：',
    fullDayLeave: (recurrence: string) => `全天請假${recurrence}`,
    rangeLeave: (start: string, end: string, recurrence: string) => `${start}–${end} 請假${recurrence}`,
    weeklyRecurrence: '（每週）',
  },

  /* ------------------------------------------------------ modal：設定班別 */
  shiftModal: {
    title: '設定班別',
    context: (name: string, date: string) => `${name}　${date}`,
    quickPick: '快速選擇',
    noTemplates: '尚無班別範本，請先點右上「管理範本」建立。',
    quickOff: '休',
    clear: '清除（恢復週排班）',
    type: '班別類型',
    typeWorking: '上班',
    typeOff: '休',
    start: '開始時間 *',
    end: '結束時間 *',
    breakStart: '休息開始（選填）',
    breakEnd: '休息結束（選填）',
    breakHelp: '休息時間必須在上班時段內。不需要休息請保持空白。',
    note: '備註（班別名稱，選填）',
    notePlaceholder: '例如：早班、晚班、加班',
    clearConfirm: '清除這筆班表？\n\n清除後該員工當日將沿用週排班。',
  },

  /* -------------------------------------------------- modal：編輯週排班 */
  weeklyModal: {
    title: '編輯週排班',
    intro: '此員工為「固定休息」模式，直接編輯每週固定時段。儲存後本週與未來各週都會套用。',
    columns: {
      weekday: '星期',
      working: '上班',
      start: '開始',
      end: '結束',
      breakStart: '休息開始',
      breakEnd: '休息結束',
    },
  },

  /* ---------------------------------------------- modal：班別範本管理 */
  templateModal: {
    title: '班別範本管理',
    intro:
      '建立常用班別（早班、午班、晚班…），之後在每位員工的月曆班表可一鍵套用，不用重複填時間。最多 10 組。',
    createSectionTitle: '新增班別',
    name: '班別名稱 *',
    namePlaceholder: '例：早班',
    start: '開始時間 *',
    end: '結束時間 *',
    color: '顯示色',
    breakStart: '休息開始（選填）',
    breakEnd: '休息結束（選填）',
    add: '新增',
    update: '更新',
    clear: '清除',
    columns: {
      name: '班別名稱',
      range: '時段',
      break: '休息',
      actions: '操作',
    },
    empty: '尚無範本',
    notCreatedHint: '尚未建立，請點右方「管理範本」新增',
    edit: '編輯',
    delete: '刪除',
    nameRequired: '請填寫班別名稱',
    deleteConfirm: '確定刪除此班別範本？\n已排定的班表會保留原本時間，不受影響',
    created: '班別範本已新增',
    updated: '班別範本已更新（不影響已排定的班表）',
    deleted: '班別範本已刪除（已排定的班表不受影響）',
    loadFailed: '載入班別範本失敗',
  },

  /* -------------------------------------------------- modal：循環重複排班 */
  repeatModal: {
    title: '🔁 循環重複排班',
    targetLabel: '對象',
    targetAll: '全部員工',
    untilLabel: '重複到',
    cycleLead: '以 ',
    cycleTail: (weeks: number) => ` 週）這段的排班為一個循環，按星期幾重複排到結束日。`,
    warning:
      '⚠️ 沒排班的格子不會複製，那些天仍沿用員工「週排班」設定（可能仍顯示為可預約）。已有預約衝突的天會自動跳過。請先把這',
    warningTail: '週排好再用。',
    maxHint: '最多排到 ',
    maxHintTail: '（一年後）。',
    start: '開始重複',
    endDateRequired: '請選擇結束日期',
    applied: (days: number) => `已重複排班：寫入 ${days} 天`,
    appliedSkipped: (days: number) => `，${days} 天因已有預約跳過`,
    allSkipped: (days: number) => `${days} 天都因已有預約被跳過，沒有新增排班`,
    noDates: '沒有日期被排到',
    truncated: (effectiveEnd: string, requestedEnd: string) =>
      `。⚠️ 為避免一次排太久，只排到 ${effectiveEnd}（未達您選的 ${requestedEnd}），到期前再重複一次即可`,
    failedPrefix: '循環重複失敗：',
  },

  /* ---------------------------------------------------------------- 驗證 */
  validation: {
    timeRequired: '請選擇開始與結束時間',
    endAfterStart: '結束時間必須晚於開始時間',
    endAfterStartWith: (start: string, end: string) => `結束時間（${end}）必須晚於開始時間（${start}）`,
    breakBothRequired: '休息時間需同時填寫開始和結束',
    breakStartMissing: '已填休息結束，請一併填休息開始（或兩個都留空）',
    breakEndMissing: '已填休息開始，請一併填休息結束（或兩個都留空）',
    breakInsideShift: '休息時段必須在班別時段內',
    breakEndAfterStart: '休息結束必須晚於休息開始',
    breakEndAfterStartWith: (breakStart: string, breakEnd: string) =>
      `休息結束（${breakEnd}）必須晚於休息開始（${breakStart}）`,
    breakStartAfterWorkStart: (breakStart: string, start: string) =>
      `休息開始（${breakStart}）不能早於上班時間（${start}）`,
    breakEndBeforeWorkEnd: (breakEnd: string, end: string) =>
      `休息結束（${breakEnd}）不能晚於下班時間（${end}）`,
    beforeBusinessStart: '班別時間不能早於營業時間（',
    afterBusinessEnd: '班別時間不能晚於營業時間（',
    shiftStartBeforeBusiness: (start: string, bizStart: string) =>
      `班別開始時間（${start}）不能早於店家營業時間（${bizStart}）`,
    shiftEndAfterBusiness: (end: string, bizEnd: string) =>
      `班別結束時間（${end}）不能晚於店家營業時間（${bizEnd}）`,
    /** 週排班逐日驗證（原站以星期名稱開頭） */
    weeklyTimeRequired: (weekday: string) => `${weekday}：請選擇開始與結束時間`,
    weeklyEndAfterStart: (weekday: string, start: string, end: string) =>
      `${weekday}：結束（${end}）必須晚於開始（${start}）`,
    weeklyStartBeforeBusiness: (weekday: string, start: string, bizStart: string) =>
      `${weekday}：開始（${start}）不能早於店家營業時間（${bizStart}）`,
    weeklyEndAfterBusiness: (weekday: string, end: string, bizEnd: string) =>
      `${weekday}：結束（${end}）不能晚於店家營業時間（${bizEnd}）`,
    weeklyBreakBoth: (weekday: string) => `${weekday}：休息時間必須同時填寫`,
    weeklyBreakInside: (weekday: string) => `${weekday}：休息時段必須在上班時段內且結束晚於開始`,
  },

  /* ---------------------------------------------------------------- 訊息 */
  messages: {
    shiftSaved: '班表已儲存',
    shiftSavedWithConflict: '班表已儲存（衝突由店家自行通知）',
    weeklySaved: '週排班已儲存',
    cleared: '已清除',
    saveFailed: '儲存失敗',
    saveFailedCheck: '儲存失敗，請確認資料',
    saveFailedPrefix: '儲存失敗：',
    clearFailed: '清除失敗',
    deleteFailed: '刪除失敗',
    toggleFailed: '切換失敗',
    staffNotFound: '找不到員工資料',
    loadStaffFailed: '載入員工失敗',
    loadShiftsFailed: '載入班表失敗',
    networkError: '網路錯誤',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    /** 原站表格內文字 */
    noStaffText: '尚未建立員工，請先到「員工管理」新增員工',
    title: '尚未建立員工',
    description: '請先到「員工管理」新增員工',
    goStaff: '前往員工管理',
  },
} as const;
