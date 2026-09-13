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
    couponHelp: '活動觸發時自動發放給該位顧客（不是發布時、也不是發給全體追蹤者）',
    couponPrivateLabel: (name: string) => `🔒 ${name}（私密券）`,
    couponPrivateWarning:
      '⚠️ 私密票券：只有「已建立顧客資料」的好友會收到券；沒有資料的好友收到推播後也無法自行領取這張券。',

    bonusPoints: '贈送點數',
    bonusPointsPlaceholder: '0',
    bonusPointsHelp: '活動觸發時自動加到該位顧客的點數（1 點 = 1 元）',

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
    tail: '活動仍可以建立並保存。',
    /** 自動觸發活動對應的通知設定開關名稱 */
    switchNames: {
      BIRTHDAY: '自動推播生日祝福',
      RECALL: '自動推播喚回訊息',
    },
    goSubscribe: '前往訂閱',
    goSettings: '前往設定',
    loadFailed: '自動活動前提檢查失敗:',
  },

  /**
   * issue #176 誠實標示：活動頁與「通知設定」頁對生日祝福／顧客喚回**有兩套 UI，
   * 但只有一套會執行**。真正在跑的是每日排程（birthday-greetings 09:00、
   * customer-recall 14:00），它們讀的是 tenant_settings.notify，不是 campaigns。
   *
   * 這裡不移除任何欄位（DELIVERY-CHAIN §5「復原而非取消」——它們是未來要實作的
   * 產品意圖），只把「這一份設定現在不會被送出去」講清楚，並指路到真正生效的頁面。
   */
  truthNotice: {
    /** BIRTHDAY / RECALL：功能真的在跑，但吃的是另一頁的設定 */
    drivenElsewhereTitle: '這裡的訊息內容不會被發送出去',
    drivenElsewhere: (switchName: string) =>
      `這項功能確實每天都在自動執行，但它發送的訊息與天數是讀「店家設定 → 通知設定」裡的「${switchName}」，`
      + '不是這張表單。在這裡修改推播訊息，實際發出去的內容不會改變。',
    goSettingsCta: '前往通知設定修改實際發送的內容',
    /** 後端尚無觸發點的類型 */
    notImplementedTitle: '這個活動類型目前不會自動執行',
    notImplemented:
      '目前後端還沒有這個類型的觸發點，活動可以建立並保存，但不會自動發送訊息、發券或送點數。'
      + '唯一會真的發生的事情是：顧客在 LINE 打出與「活動關鍵字」完全相符的文字時，會收到你設定的回覆內容。',
    /**
     * 發券／送點數在**尚未接觸發點**的類型仍然不會自動發放。
     * issue #176 第 2、3 項已讓 NEW_CUSTOMER / SPENDING_THRESHOLD / LIMITED_TIME
     * 三型真的會發，那三型顯示的是下面的 rewardActive 系列，不是這一句。
     */
    rewardsInert:
      '「贈送票券」與「贈送點數」在這個活動類型還不會自動發放，設定會保存下來，等該類型的觸發點實作後生效。',

    /* -- issue #176 第 2、3 項落地後：這三型的獎勵**真的**會發 -- */
    rewardActiveTitle: '這個活動的獎勵會自動發放',
    /** 逐型說出「什麼時候發」——不寫「發布後就會生效」這種聽起來像但不精確的話 */
    rewardActive: {
      NEW_CUSTOMER:
        '顧客的**第一筆**預約被標記為「已完成」時，系統會自動發放下面設定的票券與點數。',
      SPENDING_THRESHOLD:
        '顧客的預約被標記為「已完成」、且該筆實收金額達到下面設定的門檻時，系統會自動發放票券與點數。',
      LIMITED_TIME:
        '顧客在 LINE 打出上面設定的「活動關鍵字」時領取。需要該顧客的 LINE 已綁定顧客資料，否則只會收到活動說明、不會發放獎勵。',
    } as Record<string, string>,
    /** 冪等是產品決定，必須讓店家看得到，不能只寫在程式註解裡 */
    rewardOncePerCustomer:
      '每位顧客在同一個活動只會發放一次；重複觸發不會重複發放。',
    rewardNeedsActive:
      '活動必須是「進行中」狀態，而且當下在設定的活動期間內，才會發放。草稿、已暫停、已結束都不會。',
    /**
     * 閘門未訂閱時，發放會**整個活動跳過**（只留伺服器日誌，店家在畫面上看不到）。
     * 不寫出來的話，店家只會看到「獎勵會自動發放」然後發現沒發，而且無從得知原因。
     */
    rewardNeedsFeature:
      '贈送點數需要「點數系統」、贈送票券需要「票券系統」的訂閱有效；未訂閱時這個活動會整個略過（不會只發其中一半）。',
    /** 票券限量發完時的行為，寫清楚免得店家以為是系統壞了 */
    rewardCouponExhausted:
      '若選定的票券已達發放總量上限，該次發放會整筆略過（不會只送點數），並記錄在伺服器日誌中。',

    /**
     * 推播訊息目前仍然不會自動送出——issue #176 第 2、3 項只做了「發券／送點數」，
     * 沒有做推播。這一句必須獨立存在：三型的 notImplemented 提示消失之後，
     * 表單上唯一提到推播的就只剩 `form.pushMessageHelp`，而那句話是錯的。
     */
    pushInert:
      '⚠️ 這段推播訊息目前**不會**自動送給顧客。發布活動不會觸發任何 LINE 推播；'
      + '要主動發訊息請用「行銷推播」頁。下面的「贈送票券／贈送點數」則不受影響。',
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
