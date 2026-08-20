/**
 * 服務項目（/tenant/services）文案
 * 逐字取自原站 DOM（cards / tables / formModal / categoryModal）與 inline JS 字串。
 * 全域的「回報問題」「AI 客服助理」文案在 common，不重複收錄。
 */
export const servicesPage = {
  title: '服務項目',
  metaTitle: '服務項目 - 店家後台',
  tableTitle: '服務列表',

  /* ------------------------------------------------------- 使用小提醒卡 */
  tips: {
    title: '使用小提醒',
    items: [
      { term: '時段衝突', text: '：不同服務的預約不會互相衝突。但同一個服務同時段預設只接 1 位客人。' },
      { term: '同時接多位', text: '：編輯服務 → 關閉「需要指定員工」→ 調高「每時段最大預約數」。' },
      { term: 'LINE 精選', text: '：點星星控制服務是否在 LINE 顯示（黃色＝顯示），LINE 最多顯示 11 件 ，多的請關掉。' },
      { term: '拖曳排序', text: '：拖住左側圖示上下移動，放開自動儲存。LINE 和公開頁各自獨立排序。' },
      { term: '建立分類', text: '：服務超過 5 個建議建立分類，讓顧客在 LINE 更容易找到服務。' },
    ],
  },

  /* --------------------------------------------------- 篩選 / 排序模式卡 */
  toolbar: {
    filterLabel: '篩選分類：',
    filterAll: '全部',
    /** 「全部」按鈕右側的服務件數 */
    filterCount: (n: number) => `${n}`,
    uncategorized: '未分類',
    sortModeLabel: '排序模式：',
    sortModeLine: 'LINE 顯示順序',
    sortModePublic: '公開頁順序',
    syncToPublic: '套用此順序到公開頁',
    syncToLine: '套用此順序到 LINE',
    lineFeaturedLead: '目前 LINE 精選：',
    lineFeaturedCount: (n: number) => `${n} 件`,
    lineFeaturedMax: '（最多顯示 11 件）',
    lineFeaturedOver: '⚠ 超過 11 件，請點星星關掉不需要的',
    publicOrderHint: '此排序影響顧客在公開頁服務 Tab 看到的順序',
    /** 排序模式標籤（供動態訊息組字） */
    lineLabel: 'LINE 顯示順序',
    publicLabel: '公開頁順序',
    lineShort: 'LINE',
    publicShort: '公開頁',
    totalCount: (n: number) => `共 ${n} 項`,
  },

  /* -------------------------------------------------------------- 未分類 */
  uncategorizedWarning: {
    lead: '目前有 ',
    tail: ' 個未分類服務，超過 LINE 顯示上限（11 個）。',
    suggestLead: '建議',
    suggestLink: '建立分類',
    suggestTail: '，讓顧客能看到所有服務。',
  },

  /* ---------------------------------------------------------------- 表格 */
  columns: {
    name: '服務名稱',
    category: '分類',
    price: '價格',
    duration: '時長',
    status: '狀態',
    line: 'LINE',
    actions: '操作',
  },

  labels: {
    minutes: ' 分鐘',
    active: '啟用',
    inactive: '停用',
    capacityMode: '容量模式',
    overnightBadge: '🌙 住宿',
    overnightPriceBadge: '🌙 住宿/每晚',
    queueBadge: '🔢 號碼掛號',
    queueBadgeShort: '🔢 號碼掛號',
    lineShown: '在 LINE 顯示中（點擊隱藏）',
    lineHidden: '已從 LINE 隱藏（點擊顯示）',
    noCategory: '不指定分類',
    /** 骨架補充：原站以拖曳排序，這裡改用上移／下移按鈕 */
    moveUp: '上移',
    moveDown: '下移',
  },

  actions: {
    manageCategory: '管理分類',
    manageCategoryShort: '分類',
    create: '新增服務',
    createShort: '新增',
    edit: '編輯服務',
    duplicate: '複製一份',
    delete: '刪除服務',
    toggleLine: 'LINE 精選',
  },

  /* -------------------------------------------------- modal：新增/編輯服務 */
  form: {
    createTitle: '新增服務',
    editTitle: '編輯服務',
    name: '服務名稱 *',
    namePlaceholder: '例如：男士剪髮',
    nameInvalid: '請輸入服務名稱',
    /** 錯誤彙整清單用的欄位名 */
    nameField: '服務名稱',
    category: '分類',
    categoryPlaceholder: '請選擇分類',
    price: '價格 *',
    pricePrefix: 'NT$',
    pricePlaceholder: '0',
    priceInvalid: '請輸入有效的價格',
    priceField: '價格',
    duration: '時長 *',
    durationPlaceholder: '請選擇時長',
    durationInvalid: '請選擇服務時長',
    durationField: '時長',
    durationOptions: [
      { value: '30', label: '30 分鐘' },
      { value: '60', label: '1 小時' },
      { value: '90', label: '1.5 小時' },
      { value: '120', label: '2 小時' },
      { value: '150', label: '2.5 小時' },
      { value: '180', label: '3 小時' },
      { value: '210', label: '3.5 小時' },
      { value: '240', label: '4 小時' },
      { value: '270', label: '4.5 小時' },
      { value: '300', label: '5 小時' },
      { value: '330', label: '5.5 小時' },
      { value: '360', label: '6 小時' },
      { value: '390', label: '6.5 小時' },
      { value: '420', label: '7 小時' },
      { value: '450', label: '7.5 小時' },
      { value: '480', label: '8 小時' },
    ],

    overnightMode: '🌙 過夜 / 住宿模式',
    overnightHelpLead: '開啟後此服務改為「選入住日 → 退房日」訂房（民宿／包棟）：',
    overnightHelpPrice: '價格＝每晚',
    overnightHelpMiddle: '、下方',
    overnightHelpCapacity: '「最大容量」＝房間數',
    overnightHelpTail: '（系統逐晚防超賣），不綁員工、不選時段、與營業時間/班別無關。',
    checkInTime: '入住時間',
    checkOutTime: '退房時間',
    roomCountLabel: '房間數',
    roomCountHelp: '每晚最多可被預訂的房間數（系統逐晚防超賣）',

    queueMode: '🔢 號碼掛號模式（診所看診號碼）',
    queueHelpLead: '開啟後此服務改為「看診號碼掛號」：病患選診次（早/午/晚）拿一個號碼、',
    queueHelpStrong: '不看時間',
    queueHelpMiddle: '，號碼每天從 1 重來，不綁員工、不選時段。開啟並儲存後，請到',
    queueHelpLink: '看診號碼掛號',
    queueHelpTail: '設定診次與發號規則。',
    queueNotice:
      '此為號碼掛號服務：價格＝每人診金（可留空）、時長／員工／時段皆不適用。診次與鎖號／休診在「看診號碼掛號」頁管理。',

    requiresStaff: '需要指定員工',
    requiresStaffHelpLead: '關閉＝',
    requiresStaffHelpStrong: '一對多',
    requiresStaffHelpMiddle:
      '（同時段可收多人，右邊設人數上限），適用團體課、餐廳、場地等不需指定特定人員的服務。此類服務不綁人員、預約不會出現選人步驟，',
    requiresStaffHelpStrong2: '「強制指定服務人員」開關對它無效',
    requiresStaffHelpTail: '。',
    requiresStaffGroupLead: '此模式一位人員同時段預設服務 1 位顧客。若要開',
    requiresStaffGroupStrong: '團體課',
    requiresStaffGroupTail: '：',
    requiresStaffGroupOption1Lead: '① 由特定人員帶（如教練）→ 到 ',
    requiresStaffGroupOption1Link: '員工管理',
    requiresStaffGroupOption1Tail: ' 編輯該人員的「同時段最大預約數」；',
    requiresStaffGroupOption2: '② 不綁特定人員 → 關閉左邊開關，改在這裡填人數。',

    maxCapacity: '每時段最大預約數',
    maxCapacityHelp: '不需員工時，每個時段可接受的預約數量',
    maxCapacityHint:
      '這個服務同一時段最多可接受幾筆預約（例：團體課 12 人）。額滿後顧客就選不到該時段。',

    staffList: '可承接的服務人員',
    staffSelectAll: '全選',
    staffClear: '清除',
    staffHelpLead: '💡 ',
    staffHelpStrong: '不勾任何人＝所有人都能做',
    staffHelpTail: '（預設）。勾選後，顧客預約此服務時（',
    staffEmpty: '尚未建立任何服務人員',

    bufferAfter: '後置緩衝時間',
    bufferAfterHelp:
      '服務結束後預留的收拾／離場時間，會從可預約時段自動扣除（例：60 分鐘服務 + 15 分緩衝 → 下一筆預約最早從結束後 15 分起算）',
    bufferAfterOptions: [
      { value: '0', label: '無（預設）' },
      { value: '10', label: '10 分鐘' },
      { value: '15', label: '15 分鐘' },
      { value: '20', label: '20 分鐘' },
      { value: '30', label: '30 分鐘' },
      { value: '45', label: '45 分鐘' },
      { value: '60', label: '1 小時' },
      { value: '90', label: '1.5 小時' },
      { value: '120', label: '2 小時' },
      { value: '180', label: '3 小時' },
      { value: '240', label: '4 小時' },
    ],

    onlinePaymentMode: '預約線上收款',
    onlinePaymentHelp:
      '顧客預約時可線上刷卡付款。需先到「收款方式」新增並用 NT$1 測試 開通 線上刷卡金流才會生效。',
    onlinePaymentOptions: [
      { value: 'NONE', label: '不收（預設）' },
      { value: 'DEPOSIT_FIXED', label: '收訂金（固定金額）' },
      { value: 'DEPOSIT_PERCENT', label: '收訂金（比例 %）' },
      { value: 'FULL', label: '全額付清' },
    ],
    depositAmount: '訂金金額',
    depositAmountHelp: '顧客預約時需先付這筆訂金',
    depositPercent: '訂金比例',
    depositPercentHelp: '取預約金額的此比例（1–100）',
    depositUnitAmount: '金額',
    depositUnitPercent: '比例',
    depositRequired: '選了「收訂金」就必須填大於 0 的訂金',
    depositPercentMax: '訂金比例不能超過 100%',

    description: '描述',
    descriptionPlaceholder: '服務描述（選填）',
    mainImage: '主圖',
    mainImageHelp: '點擊上傳主圖（最大 2MB）',
    extraImages: '其他圖片（選填，最多 8 張）',
    extraImagesHelp: '可一次選多張，用於服務流程/細節展示',
    extraImagesNone: (max: number) => `尚未新增（0 / ${max}）`,
    imagesCount: (n: number) => `${n} 張`,
    imageTooLarge: '圖片大小不可超過 2MB',
    imageOver2mb: ' 超過 2MB',
    imageUnreadable: ' 無法讀取（可能是 HEIC 格式，請改存成 JPG/PNG），已略過',
    imageReadFailed: ' 讀取失敗，已略過',
    limitReached: '已達上限 ',

    validationLead: '請檢查：',
    sampleServiceName: '範例服務（請修改）',
  },

  /* ---------------------------------------------------- modal：管理分類 */
  category: {
    title: '管理服務分類',
    intro: '建立分類可讓顧客更容易找到服務',
    createSectionTitle: '新增分類',
    name: '分類名稱 *',
    namePlaceholder: '例如：剪髮、燙染',
    description: '描述',
    descriptionPlaceholder: '選填',
    dragHint: '拖曳左側圖示可調整分類順序',
    columns: {
      name: '分類名稱',
      description: '描述',
      status: '狀態',
      actions: '操作',
    },
    empty: '尚未建立任何分類',
    nameRequired: '請輸入分類名稱',
    nameEmpty: '分類名稱不能為空',
    renamePrompt: '請輸入新分類名稱：',
    deleteConfirm: '確定要刪除此分類嗎？\n該分類下的服務不會被刪除，只會變成「未分類」。',
    created: '分類建立成功',
    updated: '分類已更新',
    deleted: '分類已刪除',
    reordered: '分類順序已更新',
    createFailed: '建立分類失敗',
    loadFailed: '載入分類失敗:',
  },

  /* ---------------------------------------------------------- 確認 / 提醒 */
  confirm: {
    deleteTitle: '刪除服務',
    delete: '確定要刪除此服務嗎？',
    /** 切換排序模式時的覆蓋確認 */
    syncOrder: (fromLabel: string, toMode: string) =>
      `將目前的「${fromLabel}」套用到 ${toMode} 排序？\n\n會覆蓋現有 ${toMode} 排序。`,
  },

  /* ---------------------------------------------------------------- 訊息 */
  messages: {
    created: '服務建立成功',
    updated: '服務更新成功',
    deleted: '服務已刪除',
    duplicated: '服務已複製',
    lineShown: '已在 LINE 顯示',
    lineHidden: '已從 LINE 隱藏',
    lineOrderUpdated: 'LINE 順序已更新',
    publicOrderUpdated: '公開頁順序已更新',
    orderApplied: (toMode: string) => `已套用到${toMode}排序`,
    queueModeEnabled: '已開啟號碼掛號模式，請前往「看診號碼掛號」設定診次（早/午/晚）',
    staffCapabilityWarnLead: '提醒：有 ',
    staffCapabilityWarnTail:
      ' 筆未來預約的服務人員已不在此服務的能力名單中（預約不會被取消），請至預約列表確認是否需改派或聯繫顧客',
    saveServiceFailed: '儲存服務失敗:',
    saveFailedPrefix: '儲存失敗: ',
    deleteServiceFailed: '刪除服務失敗:',
    deleteFailed: '刪除失敗',
    duplicateServiceFailed: '複製服務失敗:',
    duplicateFailedPrefix: '複製失敗：',
    toggleFailed: '切換失敗',
    toggleFailedPrefix: '切換失敗：',
    syncFailed: '同步失敗',
    syncFailedPrefix: '同步失敗：',
    reorderFailed: '排序失敗',
    updateFailed: '更新失敗',
    loadServicesFailed: '載入服務失敗:',
    loadDetailFailed: '載入服務詳情失敗',
    loadDetailFailedPrefix: '載入服務詳情失敗:',
    loadFailedRow: '載入失敗',
    networkError: '網路錯誤',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    /** 原站表格內文字：暫無服務項目 */
    text: '暫無服務項目',
    title: '暫無服務項目',
    description: '點擊「新增服務」建立第一個服務，顧客就能在 LINE 與公開頁看到它。',
  },
} as const;
