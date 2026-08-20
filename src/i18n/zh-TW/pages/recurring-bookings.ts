/**
 * 定期預約（/tenant/recurring-bookings）文案
 * 表單欄位、說明與提示逐字取自原站 DOM 與 inline JS。
 */
export const recurringBookingsPage = {
  title: '定期預約',
  metaTitle: '定期預約 - 店家後台',
  tableTitle: '定期預約清單',

  /** 頁面上方說明（原站 .alert-light border） */
  info:
    '系統會逐次呼叫一般預約建立流程， 自動沿用 營業時間、午休、員工排班/請假、容量與時段衝突檢查。 遇到公休、客滿或員工不在的週次會 自動略過並回報 ，不會硬建或重複佔位。 顧客只會收到 一則摘要通知 （已綁定 LINE 時）。',

  actions: {
    create: '新增定期預約',
    renew: '續訂',
    end: '結束',
  },

  columns: {
    customer: '顧客',
    service: '服務',
    staff: '服務人員',
    frequency: '週期',
    times: '次數',
    status: '狀態',
    lastGenerated: '最後生成',
    actions: '操作',
  },

  status: {
    active: '生效中',
    ended: '已結束',
  },

  /** 週期顯示 */
  frequency: {
    weekly: '每週',
    everyNWeeks: (n: number) => `每 ${n} 週`,
    weeksUnit: ' 週',
  },

  unassigned: '不指定',

  form: {
    createTitle: '新增定期預約',
    customer: '顧客 *',
    newCustomerToggle: '新顧客（直接輸入姓名與電話）',
    customerPlaceholder: '請選擇顧客',
    customerInvalid: '請選擇顧客',
    newCustomerName: '顧客姓名',
    newCustomerPhone: '台灣 0912345678；外籍含國碼 +81...',
    newCustomerInvalid: '請填寫顧客姓名與正確手機號（台灣 09 開頭 10 碼；外籍請含國碼）',
    customerHelp: '系統會自動建檔；若手機號已存在則沿用既有顧客（不覆蓋既有姓名）。',

    service: '服務項目 *',
    servicePlaceholder: '請選擇服務',
    serviceInvalid: '請選擇服務項目',
    serviceHelp: '過夜/住宿服務不支援定期預約（每週重複的語意不成立）。',

    staff: '服務人員',
    staffAuto: '不指定（系統自動分配）',
    staffHelp: '可指定 服務人員 或由系統自動分配',

    dayOfWeek: '星期幾 *',
    dayOfWeekPlaceholder: '請選擇',
    dayOfWeekInvalid: '請選擇星期幾',
    weekdays: [
      { value: '1', label: '週一' },
      { value: '2', label: '週二' },
      { value: '3', label: '週三' },
      { value: '4', label: '週四' },
      { value: '5', label: '週五' },
      { value: '6', label: '週六' },
      { value: '7', label: '週日' },
    ],

    interval: '頻率 *',
    intervalOptions: [
      { value: '1', label: '每週' },
      { value: '2', label: '每 2 週' },
      { value: '3', label: '每 3 週' },
      { value: '4', label: '每 4 週' },
      { value: '5', label: '每 5 週' },
      { value: '6', label: '每 6 週' },
      { value: '7', label: '每 7 週' },
      { value: '8', label: '每 8 週' },
    ],
    intervalHelp: '每隔幾週重複一次，預設每週。',

    startTime: '開始時間 *',
    startTimeInvalid: '請選擇開始時間',

    weeks: '預約次數 *',
    weeksOptions: [
      { value: '4', label: '4 次' },
      { value: '8', label: '8 次' },
      { value: '12', label: '12 次' },
      { value: '16', label: '16 次' },
      { value: '24', label: '24 次' },
    ],
    weeksHelp: '超過一年上限的日期會自動略過，可日後用「續訂」延長。',

    note: '備註（選填）',
    notePlaceholder: '每筆預約共用的備註',

    previewButton: '預覽日期',
    previewIntro: '將嘗試建立以下日期（公休/客滿、以及超過建立上限「今日起一年內」的日期會自動略過）：',
    submit: '建立定期預約',
    submitting: '建立中…',
  },

  empty: {
    title: '尚無定期預約',
    description: '尚無定期預約，點右上角「新增定期預約」建立。',
  },

  messages: {
    loading: '載入中…',
    loadFailed: '載入失敗',
    loadListFailed: '載入定期預約清單失敗:',
    loadCustomersFailed: '載入顧客失敗:',
    loadServicesFailed: '載入服務失敗:',
    loadStaffFailed: '載入員工失敗:',
    createFailed: '建立定期預約失敗:',
    renewFailed: '續訂失敗:',
    endFailed: '結束失敗:',
    unknownError: '未知錯誤',
    networkError: '連線錯誤，請稍後再試',

    requiredFields: '請完整填寫必填欄位',
    previewRequired: '請先選擇星期幾、頻率與次數',
    staffRequired: '本店已設定「強制指定服務人員」，請選擇一位',
    staffRequiredShort: '本店已設定強制指定服務人員，請選擇一位',

    created: (n: number) => `已建立 ${n} 筆預約`,
    createdSummary: (created: number, skipped: number) =>
      `✅ 已建立 ${created} 筆 ｜ ⚠️ 略過 ${skipped} 次`,
    skippedDetail: '略過明細：',
    skippedPrefix: '略過：',
    skippedSample: (skipped: number, shown: number) =>
      `（略過 ${skipped} 次，僅列前 ${shown} 筆）`,
    overCapWarning: (weeks: number, overCap: number) =>
      `⚠️ 此設定共 ${weeks} 次，其中 ${overCap} 次超過建立上限（今日起一年內），實際只會建立 ${weeks - overCap} 筆；其餘請日後用「續訂」延長。`,

    renewConfirm: (freq: string, weeks: number) =>
      `續訂：沿用原頻率（${freq}），從上次生成處往後再生成 ${weeks} 次。確定續訂？`,
    renewed: (n: number) => `已續訂 ${n} 筆`,
    endConfirm: '確定結束此定期預約範本？結束後不可再續訂。',
    endCancelFutureConfirm:
      '是否一併取消此系列「今天起、尚未完成」的預約？\n\n選「確定」＝連同未來預約一起取消；選「取消」＝只結束範本，已建立的預約保留。',
    endedWithCancel: (n: number) => `已結束並取消未來 ${n} 筆預約`,
    endedKeep: '已結束範本（保留已建立預約）',
  },
} as const;
