/**
 * 封鎖時段（/tenant/block-times）文案
 *
 * 後端 block_times 表只有 staff_id/start_at/end_at/reason 四個可寫欄位
 * （沒有名稱、每週循環、整天旗標、自動產生標記），本頁文案已對齊實際欄位——
 * 「原因」同時作為列表顯示的名稱使用。
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
    reason: '原因',
    date: '日期',
    time: '時段',
    staff: '適用對象',
    actions: '操作',
  },

  staffAll: '全店',

  form: {
    createTitle: '新增封鎖時段',
    reason: '原因',
    reasonPlaceholder: '例如：店休、團隊會議',
    staff: '適用對象',
    date: '日期',
    startTime: '開始時間',
    endTime: '結束時間',
    fillFullDay: '整天',
  },

  empty: {
    title: '尚未設定封鎖時段',
    description: '封鎖時段內不接受預約，適用所有預約入口（公開頁面、LINE Bot、後台新增預約）',
  },

  messages: {
    created: '封鎖時段已新增',
    deleted: '已刪除',
    deleteConfirm: '確定要刪除此封鎖時段？',
    loadFailed: '載入失敗',
    saveFailed: '儲存失敗：',
    deleteFailed: '刪除失敗：',
    unknownError: '未知錯誤',
  },

  validation: {
    reasonRequired: '請輸入原因',
    dateRequired: '請選擇日期',
    timeRequired: '請填寫開始和結束時間',
    startBeforeEnd: '開始時間必須早於結束時間',
  },
} as const;
