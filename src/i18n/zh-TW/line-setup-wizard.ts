/**
 * LINE 開通精靈（/tenant/line-settings/onboarding，Issue #47）文案。
 * -----------------------------------------------------------------------------
 * 與 `src/i18n/zh-TW/pages/line-settings.ts`（既有 LINE 設定頁）是兩個獨立頁面
 * 各自的文案，不共用——精靈頁面向「完全不懂 Channel Token／Webhook／
 * Messaging API 是什麼」的導遊型店家，用字刻意比設定頁更白話、更少術語；
 * 設定頁本身維持既有的技術用字給熟手使用者。
 *
 * 放在 `src/i18n/zh-TW/` 頂層而不是 `pages/` 底下：跟 `common.ts`／`nav.ts` 同一類
 * ——雖然目前只有一個頁面（`onboarding/page.tsx`）在用，但這份文案描述的是
 * 「LINE 開通」這個跨步驟流程本身，未來若拆成多個路由（例如把能力摘要獨立成
 * 一頁）仍會共用同一份 key，因此不掛在單一 `pages/<page>.ts` 底下。
 */
export const lineSetupWizardPage = {
  title: 'LINE 開通精靈',
  metaTitle: 'LINE 開通精靈 - 店家後台',
  subtitle: '不用懂 Channel Token、Webhook 是什麼——跟著步驟填，系統會直接幫你檢查有沒有連上。',
  backToLineSettings: '回到 LINE 設定（進階）',

  messages: {
    loadFailed: '讀取設定失敗：',
    unknownError: '未知錯誤',
    saveFailedPrefix: '儲存失敗：',
    verifyFailedPrefix: '檢查失敗：',
    copyFailed: '複製失敗，請手動複製',
    copied: '已複製',
  },

  /** 步驟導覽列（畫面上方的 1→7 進度條） */
  steps: {
    CREDENTIALS_INPUT: '① 填入 LINE 資料',
    CONNECTION: '② 基本連線',
    BOT_MODE_WEBHOOK: '③ 回應方式與 Webhook',
    WEBHOOK_TEST: '④ Webhook 連線測試',
    AUTO_REPLY_CONFIRM: '⑤ 關閉自動回應',
    CAPABILITIES: '⑥ 進階功能總覽',
    DONE: '⑦ 完成',
  },

  stepStatus: {
    notChecked: '尚未檢查',
    pass: '通過',
    fail: '未通過',
    info: '待確認',
  },

  nav: {
    prev: '上一步',
    next: '下一步',
    retryCheck: '重新檢查',
    checking: '檢查中...',
    goToCapabilities: '查看進階功能',
    finish: '完成，回到 LINE 設定',
  },

  /* --------------------------------------------------- 步驟一：填入資料 */
  credentials: {
    title: '第一步：把 LINE 官方帳號的三組資料貼過來',
    intro:
      '這三組資料要到 LINE Official Account Manager（管理你的官方帳號）跟 LINE Developers（管理 Messaging API）兩個網站去找，如果還沒開好帳號，請先點下方連結去建立。',
    helpLinks: {
      manager: '前往 LINE Official Account Manager',
      developers: '前往 LINE Developers Console',
    },
    channelId: 'Channel ID（頻道 ID）',
    channelIdHelp: '一串純數字，例如 2005459361；在 LINE Developers → Messaging API 分頁可以找到。',
    channelIdPlaceholder: '例如：2005459361',
    channelIdRequired: '請先填寫 Channel ID',
    channelIdIsUrl: '這欄要填純數字的 Channel ID，不是網址，請確認貼對欄位',
    channelIdNotNumber: 'Channel ID 應該是一串數字，請確認是否貼錯欄位',
    channelSecret: 'Channel Secret（頻道密鑰）',
    channelSecretHelp: '32 個英數字，同樣在 LINE Developers → Messaging API 分頁；請小心保管，不要外流。',
    channelSecretPlaceholder: '貼上 Channel Secret',
    channelSecretIsUrl: '這欄要填 Channel Secret，不是網址，請確認貼對欄位',
    channelSecretTooShort: (len: number) => `Channel Secret 通常是 32 碼，目前只有 ${len} 碼，請確認有沒有貼全`,
    channelAccessToken: 'Channel Access Token（存取權杖）',
    channelAccessTokenHelp:
      '在 LINE Developers → Messaging API 分頁「Channel access token」按「Issue」產生，長度較長（約 100 碼以上）。',
    channelAccessTokenPlaceholder: '貼上 Channel Access Token',
    channelAccessTokenIsUrl: '這欄要填 Access Token，不是網址，請確認貼對欄位',
    channelAccessTokenTooShort: (len: number) => `Access Token 通常超過 100 碼，目前只有 ${len} 碼，請確認有沒有貼全`,
    secretShow: '顯示',
    secretHide: '隱藏',
    secretReenter: '重新輸入',
    secretCancelReenter: '取消重新輸入',
    secretKeepHint: '已經填過的話，這裡只會顯示遮罩；不重新輸入就會保留原本存的值。',
    secretMaskedPlaceholder: '（已設定，保留原值）',
    alreadyConfiguredHint: '偵測到你之前已經填過這三組資料，這裡先幫你帶出目前的狀態。',
    save: '儲存並進入下一步',
    saving: '儲存中...',
    saved: '已儲存，接下來幫你檢查連線',
  },

  /* --------------------------------------------------- 步驟二：基本連線 */
  connection: {
    title: '第二步：基本連線檢查',
    intro: '系統會拿你剛剛填的資料，實際去問 LINE 官方伺服器三件事：',
    items: [
      '三組資料是不是都有填',
      'Access Token 是不是有效（沒被刪除或重發過）',
      'Channel ID 跟 Channel Secret 是不是同一組帳號的（配對正確）',
    ],
    runCheck: '開始檢查',
    checking: '檢查中...',
    allPass: '三項都通過了！',
    somethingWrong: '有項目沒通過，請看下面的說明修正後再檢查一次',
    checkNames: {
      CREDENTIALS: '資料都有填',
      TOKEN: 'Access Token 有效',
      ID_SECRET_PAIR: 'Channel ID 與 Secret 配對正確',
    },
  },

  /* --------------------------------------- 步驟三：回應方式與 Webhook */
  botWebhook: {
    title: '第三步：回應方式與 Webhook',
    intro: '這一步決定「顧客傳訊息給你的 LINE，會不會被系統收到」，是最容易漏掉的一步。',
    checkNames: {
      BOT_MODE: 'LINE 後台「回應方式」是 Bot 模式',
      WEBHOOK: 'Webhook 網址已設定且開啟',
    },
    botModeFailHint:
      '請到 LINE Official Account Manager →「設定」→「回應設定」，把「回應方式」改成「Bot」，不要選「聊天」。',
    webhookFailHint: '沒關係，下面這顆按鈕可以幫你直接把 Webhook 網址設定好並打開，不用自己去 LINE 後台設定。',
    webhookUrlLabel: '你的 Webhook 網址（系統自動產生）',
    copyWebhookUrl: '複製網址',
    fixWebhook: '一鍵幫我設定並開啟 Webhook',
    fixing: '設定中...',
    fixSucceeded: 'Webhook 已設定並開啟',
    fixFailedPrefix: '自動設定失敗：',
    recheck: '重新檢查',
    checking: '檢查中...',
    allPass: '兩項都通過了！',
  },

  /* --------------------------------------------- 步驟四：Webhook 測試 */
  webhookTest: {
    title: '第四步：讓 LINE 官方主動測試一次連線',
    intro:
      '前面的檢查只是「讀設定值」，這一步會請 LINE 官方伺服器真的送一個測試請求過來，確認你的系統真的收得到——這跟顧客傳訊息時的情況一模一樣。',
    runTest: '開始測試',
    testing: '測試中...',
    passMessage: '測試通過！LINE 官方確認收得到你的系統回應。',
    failHint: '測試沒過通常代表網站還沒部署好，或 Webhook 網址設定錯誤，可以回上一步重新設定後再測試一次。',
    checkName: 'Webhook 實際連線測試',
  },

  /* --------------------------------------------- 步驟五：關閉自動回應 */
  autoReplyConfirm: {
    title: '第五步：手動確認一件事（LINE 沒有開放系統自動檢查）',
    infoTitle: 'LINE 沒有公開的方式讓系統讀取這個開關',
    infoBody:
      '「自動回應訊息」是 LINE 官方帳號後台自己的一個開關，跟本系統的 Bot 完全無關。LINE 沒有提供任何 API 讓外部系統知道這個開關現在是開是關，所以這一步無法由系統幫你檢查——需要你自己去確認一次。',
    steps: [
      '前往 LINE Official Account Manager →「設定」→「回應設定」',
      '找到「自動回應訊息」這個開關',
      '把它關閉（不要勾選）',
    ],
    whyItMatters: '如果沒關閉，LINE 會自己攔截顧客的訊息、直接用罐頭訊息回覆，你的系統永遠不會收到，Bot 就會像壞掉一樣。',
    cta: '前往確認並關閉',
    ackLabel: '我已經到 LINE 後台確認並關閉「自動回應訊息」',
    ackHint: '這是給你自己記錄用的提醒勾選，系統無法驗證這個開關的真實狀態，所以不會因為勾選而顯示「已通過」。',
  },

  /* --------------------------------------------- 步驟六：進階功能總覽 */
  capabilities: {
    title: '第六步：接下來還可以做這些（非必要，可以晚點再設定）',
    intro: '基本的訊息收發已經打通了，以下是目前系統已經支援、你可以視需要另外設定的功能：',
    richMenu: {
      title: 'Rich Menu（聊天室底部選單）',
      available: '這個功能已經可以使用',
      configured: '你已經設定過主題／背景，顧客加好友後就會看到',
      notConfigured: '還沒設定，顧客目前看到的是 LINE 預設畫面',
      cta: '前往設定 Rich Menu',
    },
    flexMenu: {
      title: 'Flex 主選單（文字關鍵字選單）',
      available: '這個功能已經可以使用',
      enabled: '目前是開啟狀態',
      disabled: '目前是關閉狀態',
      cta: '前往設定 Flex 主選單',
    },
    testMessage: {
      title: '傳一則測試訊息給自己',
      notReadyTitle: '這個功能目前還沒開放',
      notReadyBody:
        '傳送測試訊息需要系統另一個還在建置中的通知派送機制，目前尚未完成，所以這裡誠實顯示「尚未提供」，不會假裝已經傳送成功。',
    },
    notificationLedger: {
      title: '通知紀錄／老闆提醒',
      body: '如果想在有新預約時收到 LINE 通知，可以到 LINE 設定頁的「老闆通知」區塊另外綁定，跟本精靈是各自獨立的設定。',
      cta: '前往老闆通知設定',
    },
  },

  /* ------------------------------------------------------- 步驟七：完成 */
  done: {
    title: '設定完成！',
    intro: '恭喜，你的 LINE 官方帳號已經跟系統連上了。以下是目前的狀態總結：',
    workingTitle: '系統已經確認可以運作的部分',
    manualTitle: '需要你自己確認、系統無法檢查的部分',
    manualItem: '「自動回應訊息」開關是否已在 LINE 後台關閉',
    manualItemAcked: '（已勾選確認）',
    deferredTitle: '尚未開放的部分',
    deferredItem: '傳送測試訊息（等系統的通知派送機制完成後才會開放）',
    backToSettings: '回到 LINE 設定，查看完整選項',
    runAgain: '重新走一次精靈',
  },

  progressLabel: '目前進度',
} as const;
