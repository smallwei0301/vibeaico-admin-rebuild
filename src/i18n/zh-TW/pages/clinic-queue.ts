/**
 * 看診號碼掛號（/tenant/clinic-queue）文案
 * 逐字取自原站 DOM（headings / cards / tables / queueServiceModal / sessionModal /
 * registerModal / lockModal）與 inline JS 字串。
 * 全域的「回報問題」「AI 客服助理」文案在 common，不重複收錄。
 */
export const clinicQueuePage = {
  title: '看診號碼掛號',
  metaTitle: '看診號碼掛號 - 店家後台',

  /* ---------------------------------------- 尚未建置：誠實告示（不可省略） */
  /**
   * ⚠️ 這一區塊是「誠實化」文案，對應 CLAUDE.md「Never fabricate a known」。
   * 本頁沒有任何後端（無 /api/clinic-queue、無對應的 src/services 函式），所有互動
   * 都只改瀏覽器內的 React state，也不會發送任何 LINE／Email 給病患。
   * 在真後端接上之前，頁面不得再顯示成功訊息或「已通知病患」之類的對外行為宣稱。
   */
  notBuilt: {
    title: '看診號碼掛號後端尚未建置，本頁操作尚未生效',
    body:
      '此頁的看診項目、診次、掛號名單與當日鎖號都只存在於這個瀏覽器畫面：不會寫入資料庫，重新整理就會消失。畫面上的號碼與病患為示範資料。',
    notifyBody:
      '本頁不會發送任何 LINE、Email 或簡訊給病患 —— 通知後端尚未建置。掛號、取消、改號、休診一律請自行致電告知病患。',
    serviceCreated: (name: string) =>
      `尚未生效：「${name}」只加在畫面上，看診項目後端尚未建置，未寫入資料庫。`,
    sessionSaved: '尚未生效：診次只留在畫面上，後端尚未建置，未寫入資料庫。',
    sessionDeleted: '尚未生效：僅從畫面移除，後端尚未建置，資料庫沒有變更。',
    registered: (num: number) =>
      `尚未生效：畫面上先給了 ${num} 號，但掛號後端尚未建置，沒有寫入資料庫，系統也不會通知病患。`,
    cancelConfirm: (num: number) =>
      `確定要在畫面上把 ${num} 號標記為取消嗎？掛號後端尚未建置：這不會寫入資料庫，系統也不會通知病患，請務必自行致電告知。`,
    cancelled: (num: number) =>
      `尚未生效：${num} 號只在畫面上標記為取消，未寫入資料庫，系統未通知病患，請自行致電。`,
    completed: (num: number) =>
      `尚未生效：${num} 號只在畫面上標記為看完診，後端尚未建置，未寫入資料庫。`,
    lockApplied: '尚未生效：當日設定只留在畫面上，後端尚未建置，未寫入資料庫，也不會影響病患端。',
    lockRestored: '尚未生效：只還原了畫面上的當日設定，後端尚未建置，資料庫沒有變更。',
    lockPreviewTail:
      '（本頁只會把它們在畫面上標記為取消；後端尚未建置，不會寫入資料庫，系統也不會通知任何病患，請自行致電。）',
    lockRestoreConfirm:
      '恢復此日設定為診次預設（清除畫面上的鎖號／休診／上限設定）。\n\n提醒：當日設定後端尚未建置，這些操作從頭到尾都只影響畫面，不會寫入資料庫，系統也沒有通知過任何病患。確定要恢復嗎？',
  },

  /* ------------------------------------------------------------ 使用步驟卡 */
  guide: {
    title: '使用步驟',
    steps:
      '① 在此頁建立「看診項目」（例：看診）→ ② 替它新增診次（早/午/晚，各設號數上限與發號規則）→ ③ 選診次+日期看逐號看板、代客掛號、鎖號/休診。',
    allInPage: '全部在本頁完成，不用到其他頁面。',
    /** `{catalog}` 由頁面在 render 期依當下模式展開（14 分冊 §8.13／§8.17） */
    alsoInServicesLead: '看診項目也會出現在「{catalog}」頁（進階設定可去那裡改）；',
    /* ⚠️ 舊文案寫「病患已可在 LINE 自助掛號」——那個功能並不存在，
       與頁頂的「尚未建置」告示自相矛盾。措辭一律不得宣稱既成事實。 */
    lineSelfServiceStrong: '病患自助掛號（LINE 與公開頁）都尚未建置',
    lineSelfServiceTail: '——規劃中的流程是「選日期→診次→系統發線上號段號碼」，目前只能由店家在本頁代客掛號。',
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
    /* ⚠️ 舊文案「將無法收到任何系統通知」隱含有填電話就會收到——通知後端尚未建置，
       任何人都不會收到。改為中性描述：電話只是給店家自己聯絡用的欄位。 */
    noPhoneWarning:
      '⚠️ 未填電話：電話欄位僅供你自行聯絡病患使用（系統不會發送任何通知），未填則這位病患在名單上沒有可聯絡的號碼。',
    noNotifyWarning: '⚠️ 系統不會自動通知病患，發號後請口頭／電話告知病患號碼。',
    submit: '發號掛號',
    submitOnline: '發號掛號（📞 預約）',
    submitWalkIn: '發號掛號（🚶 現場）',
    requireNameOrPhone: '請至少填寫病患姓名或電話其中一項',
    pickSessionFirst: '請先選擇診次與日期',
    success: '掛號成功',
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
    lowerReserveHint: '「降低現場保留號數」',
    /** 套用前的影響預覽 */
    previewLead: (affected: number) => `此操作將取消 ${affected} 筆已掛號預約`,
    previewConfirmAgain: '確定要繼續嗎？請再按一次「套用」確認取消。',
    previewFailedPrefix: '查詢影響失敗：',
    applyFailedPrefix: '套用失敗：',
  },

  /* ---------------------------------------------------------- 取消 / 完成 */
  cancel: {
    failedPrefix: '取消失敗：',
  },

  complete: {
    confirm: (number: number) => `確定要標記 ${number} 號「看完診」嗎？`,
  },

  /* ---------------------------------------------------------------- 訊息 */
  messages: {
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
