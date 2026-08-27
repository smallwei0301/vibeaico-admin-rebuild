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
    /**
     * 前半句（發布時推播給所有追蹤者）**是真的**：`/api/campaigns/:id/publish`
     * 會 multicast 給本店 followed=true 的 line_users 並扣推播額度
     * （14 分冊 §8.6 擁有者裁決，本輪補齊）。
     *
     * 後半句「並自動發放獎勵」**是假的**，因此改寫：發布不會發券、也不會給點數，
     * 全站沒有任何一處會依 campaigns 發放獎勵（grep「發放票券」只在 coupons 頁的
     * 手動發放；兩支 cron 讀 tenant_settings.notify，從頭到尾不看 campaigns 表）。
     */
    leadTail: '，發布時會自動推播 LINE 訊息給所有追蹤者。（綁定的票券與點數目前只會存下來，還沒有接上自動發放。）',
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

  /**
   * 自動觸發活動的說明（原站顯示在活動卡片）。
   *
   * ⚠️ 原站寫的是「生日當天自動發送票券/點數」「久未到訪時自動發送票券/點數」，
   * 那是**對一個不存在的排程做出的承諾**：`src/app/api/cron/birthday-greetings`
   * 與 `customer-recall` 讀的是 `tenant_settings.notify` 的開關與文案，
   * **從頭到尾不看 campaigns 表**，而且它們只推一則文字訊息，不發券也不給點數。
   * 這與 messages.publishedAuto 的註解是同一件事——那裡改對了，這裡先前漏改。
   */
  autoTriggerHint: {
    BIRTHDAY: '生日當天觸發（自動發送尚未接上）',
    RECALL: '久未到訪時觸發（自動發送尚未接上）',
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
    /**
     * 「參與人數」在真實模式是**還不知道**，不是 0（issue #7 (乙)）。
     * `campaigns` 表沒有這個欄位，也沒有任何一張表把「顧客參加了哪個活動」記下來
     * （自動觸發發的是票券與點數，兩者都沒有回指活動）。顯示 0 會讓「沒有人參加」
     * 與「我們沒有在算」長得一模一樣——CLAUDE.md 點名的捏造已知。
     */
    unknownValue: '--',
    participantsUnknown: '尚未統計',
    participantsUnknownHint: '尚未統計：目前沒有任何一張表把「顧客參加了哪個活動」記下來，這裡的「--」是還不知道，不是 0 人。',
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
    /**
     * ⚠️ 一併刪除兩個宣稱「上傳能力」而該能力不存在的鍵（issue #7 (乙)）：
     * imageUploadHint（點擊上傳圖片（最大 2MB））、imageRemove（移除圖片）。
     * 這一頁從來沒有上傳程式碼，「最大 2MB」這種限制描述只會讓人以為背後有一條
     * 上傳鏈路。禁止復原。
     */
    imageUploadNotWired: '活動圖片上傳尚未接上，選檔不會有作用，也不會隨活動送出。',

    sectionReward: '推播與獎勵設定',

    pushMessage: '推播訊息 *',
    /**
     * 這兩句原站文案**保留原文**——它們現在是真的：發布會 multicast 給本店
     * followed=true 的追蹤者（14 分冊 §8.6）。help 只補上「自動觸發活動除外」，
     * 因為原站的確認視窗自己就說那類活動「不會在發布當下群發」。
     */
    pushMessagePlaceholder: '發布活動時將推送此訊息給所有 LINE 追蹤者',
    pushMessageHelp: '發布時會透過 LINE 推播通知給所有追蹤者（必填）；勾選「啟用排程自動觸發」的活動不會在發布當下群發',
    pushMessageRequired: '請先編輯活動並填寫「推播訊息」後再發布',

    couponId: '關聯票券',
    couponNone: '不關聯票券',
    /**
     * ⚠️ 原站寫「發布時自動發放票券給追蹤者」——**沒有任何實作**。
     * 發布端點只做狀態轉換與 LINE 推播，一張券都不會發；全站唯一的發券入口是
     * 「票券」頁的手動發放。這是本輪 grep 出來、與 §8.6 無關的另一筆假宣稱。
     */
    couponHelp: '關聯後會記錄在活動裡，但發布時不會自動發券——票券目前要到「票券」頁手動發放',
    couponPrivateLabel: (name: string) => `🔒 ${name}（私密券）`,
    couponPrivateWarning:
      '⚠️ 私密票券：只有「已建立顧客資料」的好友會收到券；沒有資料的好友收到推播後也無法自行領取這張券。',

    bonusPoints: '贈送點數',
    bonusPointsPlaceholder: '0',
    /** 同 couponHelp：沒有任何一支排程會依 campaigns 贈點（兩支 cron 不看這張表） */
    bonusPointsHelp: '會記錄在活動裡，但排程自動贈點尚未接上',

    thresholdAmount: '滿額門檻金額 *',
    thresholdAmountPrefix: 'NT$',
    thresholdAmountPlaceholder: '例如：1000',
    thresholdAmountHelp: '顧客消費達此金額時觸發活動',

    recallDays: '未到訪天數門檻',
    recallDaysPlaceholder: '例如：30',
    recallDaysUnit: '天',
    recallDaysHelp: '超過此天數未到訪的顧客將被觸發',

    isAutoTrigger: '啟用排程自動觸發',
    /**
     * 原站：「勾選後系統會依排程自動發送獎勵」——假的（沒有排程讀 campaigns）。
     * 勾選**真正會發生的事**只有一件：發布時不會群發推播。照實寫。
     */
    isAutoTriggerHelp: '勾選後這個活動不會在發布當下群發推播；排程自動發送獎勵尚未接上',
  },

  /* -------------------------------------------------- 自動活動前提檢查 */
  prereq: {
    title: '這個活動目前不會自動發送',
    checkLabel: '請檢查：',
    featureMissing: (featureName: string) => `尚未訂閱「${featureName}」功能（49 點/月）`,
    switchOff: (switchName: string) => `店家設定 → 通知設定的「${switchName}」開關尚未開啟`,
    /**
     * 原句尾是「補齊上面的條件後就會開始自動發送」——會開始發送的是
     * `tenant_settings.notify` 那一則生日／喚回文字推播，**與這個活動無關**
     * （兩支 cron 不讀 campaigns，也不發券、不給點）。改成只講真的會發生的事。
     */
    tail: '活動仍可以建立並保存。補齊上面的條件後開始自動發送的是「LINE 設定 → 通知」的生日／喚回文字推播，不是這個活動綁定的票券與點數。',
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
    /**
     * ⚠️ **確認視窗是動作「之前」的承諾：它說了什麼，端點就要做什麼。**
     *
     * 原站第一句「發布後將立即推送 LINE 訊息給所有追蹤者」現在**成立**
     * （§8.6 補齊的實作），所以原文保留為首句；後面補的兩句不是修飾，是把端點
     * 真正會發生的另外兩件事講出來：會扣推播額度、額度不足或未設定 LINE 時
     * 「活動照發、推播不送」（理由見 /api/campaigns/:id/publish 檔頭）。
     * 少了它們，使用者會以為推播是必然的，而那正是 §8.6 要清掉的那種落差。
     */
    publish:
      '確定要發布此活動嗎？發布後將立即推送 LINE 訊息給所有追蹤者，'
      + '每位追蹤者計 1 則本月推播額度。'
      + '若本月額度不足或尚未設定 LINE Channel，活動仍會發布，但推播不會送出。',
    /**
     * ⚠️ 原站第二句承諾「發布後會於對應時機（生日當天／…）自動發送」——
     * **那個排程不存在**（兩支 cron 不讀 campaigns，見 autoTriggerHint 的註解）。
     * 一句在動作前做出的承諾，如果動作不會兌現它，比事後的假成功更難察覺。
     * 保留原站真正成立的那半句（不會在發布當下群發），把假的那半句改成實情。
     */
    publishAuto:
      '確定要發布此活動嗎？此為「自動觸發」活動，不會在發布當下群發推播。'
      + '⚠️ 對應時機（生日當天／成為新客／消費滿額／久未到訪）的自動發送目前尚未接上，'
      + '發布的效果是顧客在 LINE 查得到這一筆活動。',
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
    /**
     * ⚠️ 這一組文案的來歷，讀之前先看完（14 分冊 §11）：
     *
     * issue #7 (乙) 那一輪把 published 從原站的「活動已發布，**LINE 推播已發送**」
     * 改成只講可見度，並在這裡註明「禁止復原」。**那個處置與擁有者裁決相反**——
     * 14 分冊 §8.6 明文寫著：
     *
     *   > 文案「活動已發布，LINE 推播已發送」保留，`POST /api/campaigns/:id/publish`
     *   > 要補上實際的推播與額度扣減。**缺的是實作而不是文案。**
     *
     * 所以本輪依 §8.6 **復原那句文案並補上實作**，同時移除那句「禁止復原」的註記
     * （它是在沒有查過既有裁決的情況下寫下的）。
     *
     * 但 §8.6 只管「推播」這一件事，它**沒有**推翻當時另一項正確的發現：
     * `publishedAuto` 的「將於對應時機自動觸發推播」仍然是對一個不存在的排程
     * 做出的承諾——生日祝賀與顧客喚回兩支 cron（src/app/api/cron/birthday-greetings、
     * customer-recall）讀的是 `tenant_settings.notify` 的開關與文案，
     * **從頭到尾不看 campaigns 表**。那一句因此維持誠實版本，
     * 要恢復必須先有真的會讀 campaigns 的觸發器。
     *
     * ── 為什麼是一句話拆成六句 ─────────────────────────────────────
     * 「發布」與「推播」是兩件會分開發生的事（端點檔頭有完整理由），
     * 所以成功訊息不能只有一句。端點回 `pushed` / `sentCount` / `pushSkipReason`，
     * 頁面照它挑下面對應的那一句。**沒送出的時候絕不可以顯示 published**。
     */
    /** 真的 multicast 出去之後才顯示（§8.6 的原句保留為首段） */
    published: (recipients: number) => `活動已發布，LINE 推播已發送給 ${recipients} 位追蹤者`,
    /** 發布成立、但這一次沒有送出推播——與下面 noPush* 其中一句組合使用 */
    publishedNoPush: '活動已發布：顧客在 LINE 輸入「活動」或這個活動的關鍵字時就查得到了',
    noPushNoRecipients: '。目前沒有任何 LINE 追蹤者，所以沒有送出推播。',
    noPushQuota: '。但本月推播額度已用完，這一則推播沒有送出；補足額度後可到「行銷推播」手動補送。',
    noPushLineNotConfigured: '。尚未設定 LINE Channel，所以沒有送出推播。',
    noPushNoMessage: '。這個活動沒有推播訊息，所以沒有送出推播。',
    /**
     * 額度已扣、LINE 平台回錯。**用 danger 色顯示**：這一句同時報告一個成功
     * （活動發布了）與一個失敗（推播沒送成），不能混在綠色的成功訊息裡。
     */
    publishedPushFailed: (detail: string) =>
      `活動已發布，但 LINE 推播送出失敗：${detail}。活動本身已生效（顧客在 LINE 查得到），`
      + '推播可到「行銷推播」重送。',
    publishedAuto:
      '活動已發布：顧客在 LINE 輸入「活動」時查得到，依規格不會在發布當下群發推播。'
      + '注意「自動觸發」目前只會存下來、還沒有接上自動發送——生日祝賀與顧客喚回的推播'
      + '是由「LINE 設定 → 通知」的開關獨立控制的，與這個活動無關。',
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
