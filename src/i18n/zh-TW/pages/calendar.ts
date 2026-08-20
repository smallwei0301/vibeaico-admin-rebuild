/**
 * 行事曆（/tenant/calendar）文案
 * 詳情／確認／封鎖相關字串逐字取自原站 inline JS，未改寫措辭。
 * 註：月/週檢視切換的按鈕字（月、週）為本骨架自訂，原站以 FullCalendar 內建工具列呈現。
 */
export const calendarPage = {
  title: '行事曆',
  metaTitle: '行事曆 - 店家後台',

  actions: {
    createBooking: '新增預約',
    modeBooking: '顧客預約',
    modeStaff: '員工排班',
  },

  view: {
    month: '月',
    week: '週',
    today: '今天',
    prev: '上一頁',
    next: '下一頁',
    monthLabel: (year: number, month: number) => `${year} 年 ${month} 月`,
    weekLabel: (from: string, to: string) => `${from} ～ ${to}`,
  },

  filters: {
    staffAll: '全部員工',
  },

  legend: {
    external: '外部行事曆事件（唯讀）',
    block: '封鎖時段',
    unassigned: '未指定',
    unprocessed: '未處理',
  },

  payment: {
    paid: '已付清',
    deposit: '已付訂金',
    pending: '待付款',
    unpaid: '尚未付款',
  },

  detail: {
    title: '預約詳情',
    loading: '載入中...',
    time: '時間：',
    staff: '員工：',
    service: '服務：',
    note: '備註：',
    queue: (n: number) => `🔢 掛號號碼：第 ${n} 號`,
    checkIn: '🌙 入住：',
    checkOut: '退房：',
    nights: (n: number) => `（${n}晚）`,
    discounted: (n: number) => `（已折抵 $${n}）`,
    chat: '聊天',
    viewDetail: '查看詳情',
    confirm: '確認',
    complete: '標記完成',
    noShow: '爽約',
    cancel: '取消',
    close: '關閉',
    notConfirmed: '此預約尚未確認',
  },

  confirmMessages: {
    confirmBooking:
      '手動確認後時段就會被佔用（付款完成本來會自動確認）。\n確定要手動確認嗎？',
    onlinePayWarning: (warn: string) => `⚠️ 此預約需線上付款，但顧客${warn}。\n\n`,
    complete:
      '確定標記此預約為「已完成」？（將自動集點。若需套用票券／點數，請改用「查看詳情」到預約列表操作）',
    noShow: '確定標記此預約為「爽約」？',
  },

  cancelModal: {
    title: '取消預約',
    intro: '取消後將透過 LINE 通知顧客，請填寫原因讓顧客了解。',
    label: '取消原因',
    placeholder: '例：店家臨時公休、員工請假、時段調整...',
    back: '返回',
    confirm: '確定取消',
  },

  block: {
    quickTitle: '臨時封鎖',
    blockSlot: '封鎖這個時段',
    blockSlotHint: '從這個時間起 1 小時不接受預約（下一步可改名稱）',
    blockDay: '封鎖這一天',
    blockDayHint: '這一整天都不接受預約（下一步可改名稱）',
    namePlaceholder: '例如：店休、私人行程',
    multiDay: (days: number) => `多天：這 ${days} 天每天都封鎖下面這個時間範圍`,
    rangeLabel: (start: string, last: string, days: number) =>
      `${start} ～ ${last}（共 ${days} 天）`,
    fullDayLabel: (date: string) => `${date}（整天）`,
    created: (ok: number) => `已建立 ${ok} 筆封鎖`,
    none: '未建立任何封鎖',
    deleteTitle: '刪除封鎖時段',
    deleteConfirm: (title: string) => `刪除封鎖「${title}」？`,
    deleteWeeklyConfirm: (title: string) =>
      `刪除封鎖「${title}」？\n\n這是「每週重複」的封鎖，會把每一週的這個封鎖整條刪除。`,
    deleted: '封鎖已刪除',
    autoRest:
      '這是「每天不同營業時間」自動產生的休息時段，要調整請到 店家設定 → 營運時間',
    timeRequired: '請選擇開始與結束時間',
    startBeforeEnd: '開始時間必須早於結束時間',
  },

  messages: {
    confirmed: '預約已確認',
    completed: '預約已完成',
    cancelled: '預約已取消',
    markedNoShow: '已標記爽約',
    notified: '，已通知顧客',
    loadFailed: '載入行事曆資料失敗:',
    loadStaffFailed: '載入員工列表失敗',
    confirmFailed: '確認預約失敗：',
    completeFailed: '完成預約失敗：',
    cancelFailed: '取消預約失敗：',
    noShowFailed: '標記爽約失敗：',
    unknownError: '未知錯誤',
    retryLater: '請稍後再試',
    networkError: '連線錯誤，請稍後再試',
  },

  empty: {
    title: '這段期間沒有預約',
    description: '切換月份或改變員工篩選條件，或點右上角「新增預約」建立第一筆預約。',
  },
} as const;
