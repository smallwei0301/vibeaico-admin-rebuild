/**
 * 封鎖時段（/tenant/block-times）文案
 * 文字全數取自原站 DOM 與 inline JS，未改寫措辭。
 */
export const blockTimesPage = {
  title: '封鎖時段',
  metaTitle: '封鎖時段 - 店家後台',
  tableTitle: '封鎖時段列表',

  /** 頁面上方灰色提示（原站 .alert-light） */
  intro: {
    text: '封鎖時段內不接受預約，適用所有預約入口（公開頁面、LINE Bot、後台新增預約）',
    businessHours: '營運時間',
  },

  actions: {
    create: '新增封鎖',
  },

  /**
   * ⚠️ 少了兩欄，都是因為**後端沒有那個欄位**（block_times 只有
   * id / staff_id / start_at / end_at / reason）：
   *   - 「原因」：接線前表單有「封鎖名稱」與「原因」兩個輸入框，但只有一個
   *     text 欄位可以存。留著第二個輸入框＝使用者打了字、按了儲存、看到成功訊息，
   *     內容卻沒有進資料庫（00 鐵則 12 的假成功）。因此只保留必填的「封鎖名稱」，
   *     它存進 `reason`（行事曆頁也是拿這個欄位當標籤）。
   *   - 「自動產生」徽章：來源是「每天不同營業時間」自動產生的休息時段，
   *     GET /api/block-times 沒有這個旗標可讀，接線後永遠不會是 true。
   */
  columns: {
    title: '名稱',
    type: '類型',
    date: '日期',
    time: '時段',
    staff: '對象',
    actions: '操作',
  },

  /** 列表徽章 */
  tags: {
    single: '單次',
    weekly: '每週',
    fullDay: '整天',
    allStaff: '全店',
  },

  form: {
    createTitle: '新增封鎖時段',
    editTitle: '編輯封鎖時段',
    title: '封鎖名稱',
    titlePlaceholder: '例如：店休、團隊會議',
    recurrence: '循環類型',
    single: '單次',
    weekly: '每週',
    /**
     * 「每週」目前**存不進去**：block_times 只有起訖時間，沒有循環欄位；
     * 就算硬加一個欄位，判斷可預約時段的 `/api/bookings/available-slots`
     * 與 `/api/calendar` 也都是照 start_at/end_at 過濾，不會認得循環規則——
     * 也就是說存下去也不會真的擋掉預約。與其做成一個「有存到、但沒有效果」
     * 的開關，不如照實說它還沒做。
     */
    weeklyUnavailable: '每週循環尚未支援：目前只能新增單次封鎖，儲存後才會真的擋住預約。',
    date: '日期',
    dayOfWeek: '星期幾',
    weekdays: [
      { value: '0', label: '週日' },
      { value: '1', label: '週一' },
      { value: '2', label: '週二' },
      { value: '3', label: '週三' },
      { value: '4', label: '週四' },
      { value: '5', label: '週五' },
      { value: '6', label: '週六' },
    ],
    fullDay: '整天封鎖',
    startTime: '開始時間',
    endTime: '結束時間',
  },

  empty: {
    title: '尚未設定封鎖時段',
    description: '封鎖時段內不接受預約，適用所有預約入口（公開頁面、LINE Bot、後台新增預約）',
  },

  /** 依目前營業時間做的時段檢查；查不到營業時間就不做這組檢查（見頁面註解） */
  businessHoursUnknown: '目前查不到營業時間設定，因此不檢查時段是否落在營業時間內。',

  messages: {
    created: '封鎖時段已新增',
    createdWithConflict: '封鎖時段已新增（衝突由店家自行通知）',
    updated: '封鎖時段已更新',
    deleted: '已刪除',
    deleteConfirm: '確定要刪除此封鎖時段？',
    notFound: '找不到封鎖時段',
    loadFailed: '載入失敗',
    saveFailed: '儲存失敗：',
    deleteFailed: '刪除失敗：',
    retryLater: '請稍後再試',
    networkError: '連線錯誤，請稍後再試',
    unknownError: '未知錯誤',
  },

  validation: {
    titleRequired: '請輸入封鎖名稱',
    dateRequired: '請選擇日期',
    timeRequired: '請填寫開始和結束時間',
    startBeforeEnd: '開始時間必須早於結束時間',
    startBeforeOpen: (t: string) => `開始時間不能早於營業開始時間（${t}）`,
    endAfterClose: (t: string) => `結束時間不能晚於營業結束時間（${t}）`,
    overlapRest: (t: string) => `時段與休息時間（${t}）重疊，休息時段本來就不營業`,
  },
} as const;
