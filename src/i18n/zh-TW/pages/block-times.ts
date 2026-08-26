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
   * ⚠️ 「原因」欄仍然缺席，因為**後端還是只有一個 text 欄位可以存**
   * （0027 補的是 title，reason 原本就在，但表單目前只填 title）：
   * 留著第二個輸入框＝使用者打了字、按了儲存、看到成功訊息，內容卻沒有
   * 進資料庫（00 鐵則 12 的假成功）。因此只保留必填的「封鎖名稱」。
   *
   * ✅ 「自動產生」徽章在 issue #33 ② 之後**是真的**：migration 0027 給
   * block_times 補了 `auto` 欄位，`PUT /api/settings` 存逐日營業時間時會
   * 重建這些列，`GET /api/block-times` 也會把旗標帶回來。
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
    /** 由「每天不同營業時間」自動產生的列（block_times.auto = true） */
    auto: '自動產生',
  },

  /**
   * auto 列的封鎖名稱（存進 block_times.title）。原站沒有留下這個字串，
   * 這是我方取的——但它不是一個「量測值」，只是一個標籤，且列上同時有
   * 「自動產生」徽章與下面那句說明，看得出它的來源。
   */
  autoTitle: '非營業時段（自動產生）',
  /** auto 列不可編輯／刪除時的說明（原站 docs/specs/calendar.json jsStrings[78] 同義） */
  autoLocked: '這是「每天不同營業時間」自動產生的休息時段，要調整請到 店家設定 → 營運時間',

  form: {
    createTitle: '新增封鎖時段',
    editTitle: '編輯封鎖時段',
    title: '封鎖名稱',
    titlePlaceholder: '例如：店休、團隊會議',
    recurrence: '循環類型',
    single: '單次',
    weekly: '每週',
    /*
     * ⚠️ 這裡曾經有一個 `weeklyUnavailable`：「每週循環尚未支援」。
     * issue #33 ② 之後那句話是**假的**——migration 0027 補了
     * recurrence / day_of_week，`/api/calendar` 與
     * `/api/bookings/available-slots` 都會展開每週封鎖，存下去真的會擋預約。
     * 所以整個鍵刪掉（不留死鍵，避免日後被誤用）。
     */
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
