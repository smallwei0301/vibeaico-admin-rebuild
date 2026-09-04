/**
 * 封鎖時段（/tenant/block-times）文案
 *
 * #169：後端補齊 title/recurrence/day_of_week/full_day/auto 五個欄位
 * （0074 migration）後，名稱／每週循環／整天封鎖／自動產生／編輯全部復原成
 * 真的接 API，不是頁面假資料。
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

  columns: {
    title: '名稱',
    type: '類型',
    date: '日期/星期',
    time: '時段',
    reason: '原因',
    staff: '適用對象',
    actions: '操作',
  },

  staffAll: '全店',

  /** 列表徽章 */
  tags: {
    single: '單次',
    weekly: '每週',
    fullDay: '整天',
    auto: '自動產生',
  },

  form: {
    createTitle: '新增封鎖時段',
    editTitle: '編輯封鎖時段',
    title: '封鎖名稱',
    titlePlaceholder: '例如：店休、團隊會議',
    reason: '原因',
    reasonPlaceholder: '選填',
    staff: '適用對象',
    recurrence: '循環類型',
    single: '單次',
    weekly: '每週',
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

  auto: {
    /** auto=true 列的說明（列表與編輯區塊皆用） */
    hint: '由「營運時間」的每天不同營業時間設定自動產生，無法在此編輯或刪除',
  },

  empty: {
    title: '尚未設定封鎖時段',
    description: '封鎖時段內不接受預約，適用所有預約入口（公開頁面、LINE Bot、後台新增預約）',
  },

  messages: {
    created: '封鎖時段已新增',
    updated: '封鎖時段已更新',
    deleted: '已刪除',
    deleteConfirm: '確定要刪除此封鎖時段？',
    loadFailed: '載入失敗',
    saveFailed: '儲存失敗：',
    deleteFailed: '刪除失敗：',
    unknownError: '未知錯誤',
  },

  validation: {
    titleRequired: '請輸入封鎖名稱',
    dateRequired: '請選擇日期',
    dayOfWeekRequired: '請選擇星期幾',
    timeRequired: '請填寫開始和結束時間',
    startBeforeEnd: '開始時間必須早於結束時間',
  },
} as const;
