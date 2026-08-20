/**
 * 看診號碼掛號（/tenant/clinic-queue）文案
 * 逐字取自原站 DOM（headings / cards / tables / queueServiceModal / sessionModal /
 * registerModal / lockModal）與 inline JS 字串。
 * 全域的「回報問題」「AI 客服助理」文案在 common，不重複收錄。
 */
export const clinicQueuePage = {
  title: '看診號碼掛號',
  metaTitle: '看診號碼掛號 - 店家後台',

  /* ------------------------------------------------------------ 使用步驟卡 */
  guide: {
    title: '使用步驟',
    steps:
      '① 在此頁建立「看診項目」（例：看診）→ ② 替它新增診次（早/午/晚，各設號數上限與發號規則）→ ③ 選診次+日期看逐號看板、代客掛號、鎖號/休診。',
    allInPage: '全部在本頁完成，不用到其他頁面。',
    alsoInServicesLead: '看診項目也會出現在「服務項目」頁（進階設定可去那裡改）；',
    lineSelfServiceStrong: '病患已可在 LINE 自助掛號',
    lineSelfServiceTail: '（選日期→診次→系統發線上號段號碼）；公開頁自助掛號為後續階段。',
  },

  /* --------------------------------------------------------- 建立看診項目 */
  serviceSection: {
    heading: '先建立你的「看診項目」',
    selectLabel: '號碼掛號服務',
    selectLoading: '載入中...',
    selectEmpty: '（無號碼掛號服務）',
    selectLoadFailed: '載入失敗',
    create: '建立看診項目',
  },

  /* -------------------------------------------------------------- 診次設定 */
  sessionSection: {
    title: '診次設定',
    create: '新增診次',
    columns: {
      name: '診次',
      total: '總號數',
      reserve: '前N現場',
      oddEven: '奇偶分流',
      time: '顯示時間',
      actions: '操作',
    },
    on: '開',
    off: '關',
    none: '（無）',
    empty: '尚未設定診次，點右上「新增診次」開始',
    loadFailedRow: '載入失敗',
    deleteConfirm: '確定刪除此診次？（今日起若有未完成掛號將無法刪除）',
  },

  /* -------------------------------------------------------------- 逐號看板 */
  board: {
    title: '逐號看板',
    sessionLabel: '診次',
    sessionPlaceholder: '請先新增診次',
    dateLabel: '日期',
    register: '代客掛號',
    daySettings: '當日設定 / 鎖號 / 休診',
    pickFirst: '請選擇診次與日期',
    loading: '載入中...',
    loadFailed: '載入失敗',
    closed: '整天休診',
    summaryTotal: (total: number) => `總號 ${total}`,
    summaryEffectiveTotal: (total: number) => `（當日上限 ${total}）`,
    summaryReserve: (n: number) => `　前 ${n} 號現場`,
    summaryOddEven: (enabled: boolean) => `　奇偶分流 ${enabled ? '開' : '關'}`,
    numberStates: {
      available: '可掛',
      taken: '已掛',
      locked: '鎖定',
      reserved: '保留',
      disabled: '停用',
    },
    rosterTitle: '今日掛號名單',
    rosterHint: '（病患來電取消，點該列「取消」即可）',
    columns: {
      number: '號碼',
      patient: '病患',
      phone: '電話',
      status: '狀態',
      actions: '操作',
    },
    statusWaiting: '候診中',
    statusDone: '已看診 ✓',
    statusCancelled: '已取消',
    statusNoShow: '爽約',
    channelOnline: '📞 預約',
    channelWalkIn: '🚶 現場',
    unnamed: '(未命名)',
    cancel: '取消',
    complete: '完成看診',
    completeShort: '看完✓',
  },

  /* -------------------------------------------- modal：建立看診項目 */
  serviceModal: {
    title: '建立看診項目',
    name: '項目名稱 *',
    namePlaceholder: '例：看診、門診掛號',
    nameDefault: '看診',
    help: '號碼掛號不需要填價格與時長；建好後接著新增診次（早/午/晚）即可開始掛號。',
    submit: '建立',
    nameRequired: '請填項目名稱',
    created: (name: string) => `已建立「${name}」！接著新增診次（早/午/晚）就能開始掛號`,
    createFailedPrefix: '建立失敗：',
  },

  /* ------------------------------------------------- modal：新增/編輯診次 */
  sessionModal: {
    createTitle: '新增診次',
    editTitle: '編輯診次',
    name: '診次名稱 *',
    namePlaceholder: '例：早診',
    total: '當日總號數 *',
    reserve: '前 N 號現場保留',
    reserveHelp: '前 N 號不由系統發，留給現場排隊。',
    oddEven: '奇偶分流（線上只發偶數號，奇數留給現場）',
    displayStart: '顯示起始時間（選填）',
    displayEnd: '顯示結束時間（選填）',
    avgMinutes: '平均每人看診分鐘（選填）',
    avgMinutesPlaceholder: '例：5',
    avgMinutesHelp: '目前病患端不顯示時間，此欄留給後續「預估到院區間」估算用。',
    nameRequired: '請填診次名稱',
    totalRange: '總號數需為 1–99',
    reserveLessThanTotal: '前 N 號現場保留必須小於總號數',
  },

  /* ------------------------------------------------------ modal：代客掛號 */
  registerModal: {
    title: '代客掛號',
    channelLabel: '掛號來源',
    channelOnline: '📞 電話／線上預約',
    channelWalkIn: '🚶 現場',
    channelOnlineHintOddEven: '發「預約號段」（偶數號，保留號段之後）。',
    channelOnlineHint: '發「預約號段」（保留號段之後最小可用號）。',
    channelWalkInHintOddEven: '發「現場號段」：先發前 N 保留號（1 號起），滿了再發奇數號。',
    channelWalkInHint: '發「現場號段」：先發前 N 保留號（1 號起），滿了與預約共用號段。',
    context: (sessionName: string, date: string) =>
      `診次「${sessionName}」　日期 ${date}　系統將依「掛號來源」自動發下一個可用號碼。`,
    phone: '病患電話',
    phonePlaceholder: '手機或市話皆可（例：0912345678 / 0212345678）',
    phoneHelpLead: '手機、市話、家用電話都可以。姓名與電話',
    phoneHelpStrong: '至少填一項',
    phoneHelpTail: '。',
    name: '病患姓名',
    namePlaceholder: '例：王小明',
    noPhoneWarning:
      '⚠️ 未填電話：這位病患將無法收到任何系統通知（取消／變更都要口頭告知），之後也無法用電話搜尋到他。',
    noNotifyWarning: '⚠️ 系統不會自動通知病患，發號後請口頭／電話告知病患號碼。',
    submit: '發號掛號',
    submitOnline: '發號掛號（📞 預約）',
    submitWalkIn: '發號掛號（🚶 現場）',
    requireNameOrPhone: '請至少填寫病患姓名或電話其中一項',
    pickSessionFirst: '請先選擇診次與日期',
    success: '掛號成功',
    successNumber: (num: number) => `✅ 已發號：${num} 號　—　請口頭告知病患此號碼（系統不會自動通知病患）`,
    failedPrefix: '掛號失敗：',
  },

  /* ------------------------------------- modal：當日設定 / 鎖號 / 休診 */
  lockModal: {
    title: '當日設定 / 鎖號 / 休診',
    context: (sessionName: string, date: string) => `診次「${sessionName}」　日期 ${date}`,
    closed: '整天休診',
    closedHint: '（該日該診次不發任何號）',
    total: '當日號數上限（選填）',
    totalPlaceholder: '留空＝用診次預設',
    totalHelp: '臨時控量，例如今天只看到 20 號。',
    numbers: '鎖定號碼（逗號分隔）',
    numbersPlaceholder: '例：6,10',
    numbersHelp: '被鎖的號不開放預約；已選取的號：',
    numbersInvalid: (bad: string) => `鎖定號碼含無法辨識的內容：「${bad}」。請用逗號分隔數字，例：6,10`,
    reason: '原因（選填）',
    reasonPlaceholder: '例：國定假日休診',
    restoreDefault: '恢復當日預設',
    apply: '套用',
    applyConfirm: '確認取消並套用',
    restoreConfirm:
      '恢復此日設定為診次預設（清除當日的鎖號/休診/上限設定）。\n\n注意：這不會取消目前有效的掛號，但也「無法救回先前已被取消的病患」——他們已收到取消通知，如需恢復請個別聯繫重新掛號。確定要恢復嗎？',
    lowerReserveHint: '「降低現場保留號數」',
    /** 套用前的影響預覽 */
    previewLead: (affected: number) => `此操作將取消 ${affected} 筆已掛號預約`,
    previewTail: '（有 LINE／Email 且店家已開啟取消通知者，系統會嘗試通知）：',
    previewItem: (number: number, name: string) => `${number} 號　${name}`,
    previewNeedCall: (n: number) => `⚠️ 其中 ${n} 位系統無法自動通知，請自行致電：`,
    previewNoContact: (n: number) => `其中 ${n} 位系統無法自動通知，請自行致電。`,
    previewConfirmAgain: '確定要繼續嗎？請再按一次「套用」確認取消。',
    previewFailedPrefix: '查詢影響失敗：',
    cancelledSummary: (n: number) => `已取消 ${n} 筆掛號`,
    applied: '已套用',
    appliedWithCancel: (n: number) => `已套用，取消 ${n} 筆掛號`,
    applyFailedPrefix: '套用失敗：',
    restored: '已恢復當日預設',
  },

  /* ---------------------------------------------------------- 取消 / 完成 */
  cancel: {
    confirm: (number: number, notifyMsg: string) => `確定要取消 ${number} 號的掛號嗎？${notifyMsg}`,
    notifyOk: '系統會嘗試以 LINE／Email 通知病患。',
    notifyNone: '⚠️ 系統「無法」自動通知此病患，取消後請務必自行致電告知！',
    successNotified: (number: number) => `已取消 ${number} 號掛號（系統已嘗試通知病患）`,
    successManual: (number: number) => `已取消 ${number} 號掛號 — 請記得自行致電告知病患`,
    failedPrefix: '取消失敗：',
  },

  complete: {
    confirm: (number: number) => `確定要標記 ${number} 號「看完診」嗎？`,
    success: (number: number) => `${number} 號已標記看完診`,
  },

  /* ---------------------------------------------------------------- 訊息 */
  messages: {
    saved: '已儲存',
    deleted: '已刪除',
    saveFailedPrefix: '儲存失敗：',
    deleteFailedPrefix: '刪除失敗：',
    operationFailedPrefix: '操作失敗：',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    /** 尚未建立號碼掛號服務 */
    serviceTitle: '尚未建立看診項目',
    serviceDescription: '點擊「建立看診項目」後，就能替它新增診次（早/午/晚）開始掛號。',
    sessionTitle: '尚未設定診次',
    sessionDescription: '點右上「新增診次」開始',
    rosterTitle: '今日尚無掛號',
    rosterDescription: '病患透過 LINE 自助掛號或由店家代客掛號後，會出現在這份名單。',
  },
} as const;
