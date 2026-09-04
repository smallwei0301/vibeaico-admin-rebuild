/**
 * 行銷活動（/tenant/campaigns）文案
 * 說明卡、推送額度列、表格、建立/編輯 modal（含自動觸發前提檢查）與所有
 * toast／確認訊息均逐字取自原站 DOM 與 inline JS（docs/specs/campaigns.json）。
 */
export const campaignsPage = {
  title: '行銷活動',
  metaTitle: '行銷活動 - 店家後台',
  tableTitle: '活動列表',

  /* --------------------------------------------------------------- 說明卡 */
  intro: {
    heading: '行銷活動是什麼？',
    lead: '行銷活動可以',
    leadStrong: '綁定票券和點數獎勵',
    leadTail: '，發布時自動推播 LINE 訊息給所有追蹤者，並自動發放獎勵。',
    useCaseLabel: '適合用來：',
    useCaseText: '生日送折扣券、新客優惠、老客喚回、消費滿額送點數',
    crossLead: '如果只是要發一則通知訊息（不需要票券/點數），請用「',
    crossLink: '行銷推播',
    crossTail: '」',
    toggle: '展開／收合',
  },

  /* ---------------------------------------------------------- 本月推送額度 */
  quota: {
    label: '本月推送額度',
    loading: '載入中...',
    usage: (used: number, quota: number, remaining: number) =>
      `${used} / ${quota}（剩餘 ${remaining}）`,
  },

  /* --------------------------------------------------------------- 表格 */
  columns: {
    name: '活動名稱',
    type: '類型',
    period: '活動期間',
    participants: '參與人數',
    status: '狀態',
    actions: '操作',
  },

  status: {
    DRAFT: '草稿',
    SCHEDULED: '已排程',
    ACTIVE: '進行中',
    PAUSED: '已暫停',
    ENDED: '已結束',
  },

  /* ---------------------------------------------------------- 活動類型 */
  types: {
    BIRTHDAY: '生日活動',
    NEW_CUSTOMER: '新客活動',
    SPENDING_THRESHOLD: '滿額活動',
    LIMITED_TIME: '限時活動',
    RECALL: '喚回活動',
    REFERRAL: '推薦活動',
  },

  typeHelp: {
    BIRTHDAY: '針對生日當月的顧客',
    NEW_CUSTOMER: '首次來店的新顧客',
    SPENDING_THRESHOLD: '消費達指定金額觸發',
    LIMITED_TIME: '指定時間內的限時優惠',
    RECALL: '久未來店的老顧客喚回',
    REFERRAL: '推薦新顧客獎勵',
  },

  /** 自動觸發活動的排程說明（原站顯示在活動卡片與確認訊息） */
  autoTriggerHint: {
    BIRTHDAY: '生日當天自動發送票券/點數',
    RECALL: '久未到訪時自動發送票券/點數',
  },

  /** 原站的自動活動預設名稱 */
  presetNames: {
    birthday: '生日祝福',
    recall: '顧客喚回',
  },

  labels: {
    immediately: '立即',
    forever: '永久',
    period: (start: string, end: string) => `${start} ~ ${end}`,
    people: (n: number) => `${n} 人`,
    pushMessage: '推播訊息',
    campaignName: '活動名稱',
    thresholdAmount: '滿額門檻金額',
    /** 後端沒有任何來源表可以算「參加人數」（沒有 campaign_participants，也沒有
     * 帶 campaign_id 的表），這是誠實佔位，不是假資料 —— 見 Issue #23。 */
    participantsUnavailable: '尚未提供',
  },

  /* --------------------------------------------------------------- 動作 */
  actions: {
    create: '新增活動',
    edit: '編輯活動',
    view: '檢視活動',
    publish: '發布',
    pause: '暫停',
    resume: '恢復',
    end: '結束',
    delete: '刪除',
  },

  /* ---------------------------------------------- modal：新增/編輯活動 */
  form: {
    createTitle: '新增活動',
    editTitle: '編輯活動',
    draftNotice: '新建立的活動為「草稿」狀態，需點擊「發布」按鈕才會生效',
    lockedNotice:
      '活動已發布，推播訊息、關聯票券、贈送點數、活動類型、開始時間等已鎖定，僅可修改名稱、描述、結束時間、備註及圖片',

    name: '活動名稱 *',
    namePlaceholder: '例如：新春限時優惠',
    nameRequired: '請輸入活動名稱',

    type: '活動類型 *',
    typeOptions: [
      { value: 'BIRTHDAY', label: '生日活動' },
      { value: 'NEW_CUSTOMER', label: '新客活動' },
      { value: 'SPENDING_THRESHOLD', label: '滿額活動' },
      { value: 'LIMITED_TIME', label: '限時活動' },
      { value: 'RECALL', label: '喚回活動' },
    ],

    startAt: '開始時間',
    startAtHelp: '不填則立即開始',
    endAt: '結束時間',
    endAtHelp: '不填則永久有效',
    endAtInvalid: '結束時間必須晚於開始時間',

    description: '活動描述',
    descriptionPlaceholder: '描述活動內容、優惠方式等...',
    descriptionMax: 500,

    image: '活動圖片',
    imageUploadHint: '點擊上傳圖片（最大 2MB）',
    imageRemove: '移除圖片',

    sectionReward: '推播與獎勵設定',

    pushMessage: '推播訊息 *',
    pushMessagePlaceholder: '發布活動時將推送此訊息給所有 LINE 追蹤者',
    pushMessageHelp: '發布時會透過 LINE 推播通知給所有追蹤者（必填）',
    pushMessageRequired: '請先編輯活動並填寫「推播訊息」後再發布',

    couponId: '關聯票券',
    couponNone: '不關聯票券',
    couponHelp: '發布時自動發放票券給追蹤者',
    couponPrivateLabel: (name: string) => `🔒 ${name}（私密券）`,
    couponPrivateWarning:
      '⚠️ 私密票券：只有「已建立顧客資料」的好友會收到券；沒有資料的好友收到推播後也無法自行領取這張券。',

    bonusPoints: '贈送點數',
    bonusPointsPlaceholder: '0',
    bonusPointsHelp: '排程觸發時自動贈送點數',

    thresholdAmount: '滿額門檻金額 *',
    thresholdAmountPrefix: 'NT$',
    thresholdAmountPlaceholder: '例如：1000',
    thresholdAmountHelp: '顧客消費達此金額時觸發活動',

    recallDays: '未到訪天數門檻',
    recallDaysPlaceholder: '例如：30',
    recallDaysUnit: '天',
    recallDaysHelp: '超過此天數未到訪的顧客將被觸發',

    isAutoTrigger: '啟用排程自動觸發',
    isAutoTriggerHelp: '勾選後系統會依排程自動發送獎勵',
  },

  /* -------------------------------------------------- 自動活動前提檢查 */
  prereq: {
    title: '這個活動目前不會自動發送',
    checkLabel: '請檢查：',
    featureMissing: (featureName: string) => `尚未訂閱「${featureName}」功能（49 點/月）`,
    switchOff: (switchName: string) => `店家設定 → 通知設定的「${switchName}」開關尚未開啟`,
    tail: '活動仍可以建立並保存，補齊上面的條件後就會開始自動發送。',
    /** 自動觸發活動對應的通知設定開關名稱 */
    switchNames: {
      BIRTHDAY: '自動推播生日祝福',
      RECALL: '自動推播喚回訊息',
    },
    goSubscribe: '前往訂閱',
    goSettings: '前往設定',
    loadFailed: '自動活動前提檢查失敗:',
  },

  /* --------------------------------------------------------------- 確認 */
  confirm: {
    deleteTitle: '刪除活動',
    delete: (name: string) => `確定要刪除活動「${name}」嗎？此操作無法復原。`,
    publishTitle: '發布活動',
    publish: '確定要發布此活動嗎？發布後將立即推送 LINE 訊息給所有追蹤者。',
    publishAuto:
      '確定要發布此活動嗎？此為「自動觸發」活動，發布後會於對應時機（生日當天／成為新客／消費滿額／久未到訪）自動發送，不會在發布當下群發。',
    pauseTitle: '暫停活動',
    pause: '確定要暫停此活動嗎？',
    resumeTitle: '恢復活動',
    resume: '確定要恢復此活動嗎？',
    endTitle: '結束活動',
    end: '確定要結束此活動嗎？此操作無法復原。',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    created: '活動已建立（草稿狀態）',
    updated: '活動已更新',
    deleted: '活動已刪除',
    published: '活動已發布，LINE 推播已發送',
    publishedAuto: '活動已啟用，將於對應時機自動觸發推播',
    paused: '活動已暫停',
    resumed: '活動已恢復',
    ended: '活動已結束',
    saveFailedPrefix: '儲存失敗: ',
    saveCampaignFailed: '儲存活動失敗:',
    publishFailedPrefix: '發布失敗: ',
    deleteFailed: '刪除失敗',
    pauseFailed: '暫停失敗',
    resumeFailed: '恢復失敗',
    endFailed: '結束失敗',
    imageTooLarge: '圖片大小不可超過 2MB',
    loadCampaignsFailed: '載入活動失敗:',
    loadDetailFailed: '載入活動詳情失敗',
    loadDetailFailedPrefix: '載入活動詳情失敗:',
    loadCouponsFailed: '載入票券列表失敗:',
    loadQuotaFailed: '載入推送額度失敗:',
    loadFailed: '載入失敗',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '還沒有行銷活動',
    description: '建立第一個活動，綁定票券或點數獎勵，發布時自動推播給所有 LINE 追蹤者。',
  },
} as const;
