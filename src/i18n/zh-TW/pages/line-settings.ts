/**
 * LINE 設定（/tenant/line-settings）文案
 * -----------------------------------------------------------------------------
 * 多租戶客製化的關鍵頁：店家在這裡填自己的 LINE Channel ID / Secret / Access Token，
 * 存進 tenant_settings（見 src/config/tenant-settings.ts），而不是平台的 .env。
 *
 * 逐字取自原站 DOM 與 inline JS（docs/specs/line-settings.json 的
 * headings / cards.bodyText / alerts / forms.fields / looseFields / buttons / jsStrings）。
 * 註：spec 的 cards.bodyText 在「步驟三」之後被截斷，步驟三～五的內文改由同一份
 * spec 的 jsStrings（圖文教學逐字稿）還原，語意與原站一致。
 */
export const lineSettingsPage = {
  title: 'LINE 設定',
  metaTitle: 'LINE 設定 - 店家後台',

  /* ---------------------------------------------------------------- 頁首 */
  viewTutorial: '查看教學',

  /* --------------------------------------------- 🔴 設定完成後必做（警示） */
  mustDo: {
    title: '設定完成後必做！否則 Bot 不會回應',
    lead: '請到 LINE Official Account Manager 關閉「聊天」：',
    steps: [
      '進入您的官方帳號 → 設定 → 回應設定',
      '「回應功能」區塊找到「 聊天 」，把「開啟聊天畫面」關掉',
      '畫面最上方會顯示「 聊天：關閉 」才算設定成功',
      '確認「Webhook」顯示為 啟用',
    ],
    ctaLead: '點擊下方按鈕直接前往您的回應設定頁面，把「 聊天 」關掉：',
    cta: '一鍵前往關閉聊天',
    ctaHref: 'https://manager.line.biz/',
    footer: '如果不關閉，LINE 會攔截所有訊息，您的 Bot 完全不會收到也不會回應。',
  },

  /* -------------------------------------------------------------- 教學卡 */
  tutorial: {
    cardTitle: 'LINE Official Account 設定',
    tipTitle: '設定教學',
    tipBody: '看不懂文字？右邊改看圖文步驟 →',
    detailBtn: '查看詳細教學',
    imageBtn: '看圖文教學',
    modalTitle: 'LINE 設定圖文教學（跟著紅框做）',
    legendRed: '紅框 = 點／填這裡',
    legendMosaic: '馬賽克 = 你自己的機密資料',
    legendGray: '灰罩 = 範例帳號，請忽略',

    steps: [
      {
        title: '步驟一：建立 LINE 官方帳號',
        lines: [
          '1. 前往 LINE Official Account Manager ，使用 LINE 帳號登入',
          '2. 點擊「 建立 」，填寫帳號名稱、email、業種等資訊',
          '3. 確認資料後選擇「 稍後進行認證（前往管理畫面） 」',
          '4. 系統會跳出「開始經營帳號前」對話框，點「 下一步 」→ 進入主頁',
        ],
        note: '',
      },
      {
        title: '步驟二：啟用 Messaging API',
        lines: [
          '1. 在主頁右上角點擊「 設定 」',
          '2. 左側選單點擊「 Messaging API 」',
          '3. 點擊「 啟用 Messaging API 」',
          '4. 選擇或建立 服務提供者 （Provider），按「 同意 」',
          '5. 隱私權政策和服務條款 兩行留空 ，按「 確定 」',
          '6. 確認資訊後再按「 同意 」完成啟用',
        ],
        note: '注意：一旦與服務提供者連動 即無法變更或解除',
      },
      {
        title: '步驟三：取得 Channel ID 與 Channel Secret',
        lines: [
          '1. 啟用後，Messaging API 頁面的狀態會顯示「 使用中 」',
          '2. 複製 Channel ID 和 Channel secret 兩個，貼到下方對應欄位',
          '3. Channel ID 是純數字（例如 2005459361），Channel secret 是 32 字元的英數字串',
        ],
        note: '',
      },
      {
        title: '步驟四：取得 Access Token',
        lines: [
          '1. 複製好金鑰後，點頁面下方「 LINE Developers Console 」藍色連結',
          '2. Providers 點你的提供者（你的店名），再點進 Messaging API 頻道',
          '3. 切到「 Messaging API 」分頁，往下捲找「 Channel access token 」',
          '4. 在「Channel access token (long-lived)」按黑色「 Issue 」產生',
          '5. 複製這串長長的 Token（等一下要貼到 VibeAI）',
        ],
        note: '',
      },
      {
        title: '步驟五：儲存並啟用',
        lines: [
          '1. 回到 VibeAI 後台 LINE 設定，把剛剛複製的 Channel ID、Channel Secret、Channel Access Token 貼到對應欄位',
          '2. 按「 儲存設定 」，Webhook 網址會自動帶入',
          '3. 回 LINE 官方帳號管理後台 → 設定 → 回應設定 → 把「 聊天 」關掉',
        ],
        note: '',
      },
    ],

    mustDoThree: {
      title: '必做三件事！',
      body: '缺一不可，否則 Bot 不會回應：',
      items: [
        '① 回應設定 → 回應功能 →「聊天」關閉（畫面顯示「聊天：關閉」）',
        '② Messaging API → Webhook URL 已填入',
        '③ LINE Developers Console →「Use webhook」已啟用',
      ],
    },

    verifyWebhook: {
      title: '驗證 Webhook：',
      body: '儲存設定後，系統會自動將 Webhook URL 設定到 LINE 並發送驗證請求。LINE 會向此 URL 發送測試訊號，收到 200 回應即代表驗證成功。如果驗證失敗，請回到本系統重新點「儲存設定」再試一次。',
    },

    consoleLink: '前往 LINE Developers Console',
    consoleHref: 'https://developers.line.biz/console/',
    managerLink: '前往 LINE 官方帳號管理後台',
    managerHref: 'https://manager.line.biz/',
  },

  /* -------------------------------------------------------------- 設定表單 */
  form: {
    intro:
      '以下三個欄位的資料都要從 LINE 後台 取得，再複製貼到這裡。 不知道怎麼取得？請點擊右上角「查看教學」按步驟操作。',

    channelId: 'Channel ID',
    channelIdBadge: '從 LINE 後台複製',
    channelIdPlaceholder: '純數字，例如：2005459361',
    channelIdNotNumber: 'Channel ID 通常是純數字。請確認是否複製正確。',
    channelIdIsUrl:
      '這不是 Channel ID！您貼的是網址。Channel ID 是純數字（例如 2005459361），請從 LINE 官方帳號管理後台的 Messaging API 頁面複製。',
    channelIdRequired: '請填寫 Channel ID',

    channelSecret: 'Channel Secret',
    channelSecretBadge: '從 LINE 後台複製',
    channelSecretPlaceholder: '32 字元英數字，例如：ab2d0a47249da385b1dfda6d5adcb865',
    channelSecretTooShort: (n: number) =>
      `Channel Secret 通常是 32 字元。您目前只有 ${n} 字元，請確認是否複製完整。`,
    channelSecretIsUrl:
      '這不是 Channel Secret！您貼的是網址。Channel Secret 是 32 字元的英數字串，請從 LINE 官方帳號管理後台的 Messaging API 頁面複製。',

    channelAccessToken: 'Channel Access Token',
    channelAccessTokenBadge: '從 LINE Developers Console 複製',
    channelAccessTokenPlaceholder:
      '很長的一串英數字（約 170 字元），例如：G6e//SU+Bv9k00q2cidc...',
    channelAccessTokenTooShort: (n: number) =>
      `Access Token 通常約 170 字元。您目前只有 ${n} 字元，可能沒有複製完整，或是貼錯欄位了。`,
    channelAccessTokenIsUrl:
      '這不是 Access Token！您貼的是網址。Access Token 是一串很長的英數字（約 170 字元），不是 http 開頭的網址。請到 LINE Developers Console（不是 LINE 官方帳號管理後台）→ Messaging API Tab → 頁面最下方 → 點「Issue」產生 → 複製貼到這裡。',

    /* 🔐 遮罩欄位：已儲存的密文只顯示遮罩，使用者按「重新輸入」才變成可編輯空欄位 */
    secretMaskedPlaceholder: '••••••••（已儲存，留空則不更新）',
    secretReenter: '重新輸入',
    secretCancelReenter: '取消重新輸入',
    secretKeepHint: '不重新輸入就維持原本的值（送出空字串代表不變更）',
    secretShow: '顯示',
    secretHide: '隱藏',

    webhookUrl: 'Webhook URL',
    webhookCopy: '複製',
    webhookHelp: 'Webhook 不用自己填，存好金鑰後 VibeAI 會自動設定。',
    webhookEmpty: 'Webhook URL 尚未產生',

    lineBasicId: 'LINE 官方帳號基本 ID',
    lineBasicIdOptional: '（選填）',
    lineBasicIdPlaceholder: '例如：@abc1234x',
    lineBasicIdHelp: '填了之後，下方會產生顧客加好友用的連結與 QR Code。',

    save: '儲存設定',
    saving: '儲存中...',
    saved: 'LINE 設定已儲存',
    saveFailed: '儲存設定失敗，請重試',
    saveFailedPrefix: '儲存失敗：',
  },

  /* ------------------------------------------------------------ 連線狀態 */
  connection: {
    title: '連線狀態',
    notConfigured: '未設定',
    connected: '已啟用',
    test: '測試連線',
    testing: '測試中...',
    verify: '完整檢查',
    verifying: '檢查中...',
    hintLead: '「測試連線」只看 Token 對不對；',
    hintTail: '「 完整檢查 」會跑 5 項檢測找出「為什麼按 Bot 沒反應」',
    testSuccessThenVerify: '連線測試成功！繼續執行完整檢查...',
    testFailedPrefix: '連線測試失敗：',
    verifyFailedPrefix: '檢查失敗：',
    checkSettings: '請檢查 LINE 設定',
  },

  /* -------------------------------------------------------- 設定檢查報告 */
  verifyReport: {
    title: 'LINE 設定檢查報告',
    allPass: '✅ 全部通過',
    failCount: (n: number) => `❌ 有 ${n} 項失敗`,
    warnCount: (n: number) => `⚠️ 有 ${n} 項警告`,
    close: '關閉',
    checkNames: {
      TOKEN: 'Channel Access Token',
      WEBHOOK: 'Webhook URL',
      AUTO_REPLY: 'LINE 自動回應訊息',
      RICH_MENU: 'Rich Menu',
      QUOTA: '推播額度',
    },
    culprit: '👉 這就是「按 Bot 沒反應」的元兇',
    webhookOffHint:
      'Webhook 沒開啟 → LINE 不會把使用者點選/訊息送到本系統 → 看起來 Bot 像在睡覺。修好後馬上活過來。',
    gotoLineConsole: '直接前往 LINE 後台',

    /**
     * 各檢查項失敗時的「怎麼修」指引 + 可以直接點過去的連結。
     * AUTO_REPLY 與 RICH_MENU 兩項光看訊息不知道要去哪裡設定，是使用者實測
     * 回報的痛點——前者更是「按 Bot 沒反應」最常見的元兇。
     */
    fixHints: {
      AUTO_REPLY: {
        steps: '在 LINE 官方帳號管理後台依序點：左側「設定」→「回應設定」→「回應功能」區塊的' +
          '「聊天」欄位，把「開啟聊天畫面」關掉（畫面最上方會顯示「聊天：關閉」）。' +
          '「回應方式：手動聊天／手動聊天＋自動回應訊息」是聊天開啟時才生效的子選項，' +
          '不會讓這項變綠——一定要關掉「聊天」本身。',
        linkText: '前往 LINE 官方帳號管理後台 → 回應設定',
        href: 'https://manager.line.biz/',
      },
      RICH_MENU: {
        steps: '圖文選單要先在本系統設計並發布，顧客的 LINE 聊天室下方才會出現選單。' +
          '我們已依你的營運模式預設好一組範本，套用後即可發布。',
        linkText: '前往圖文選單設計',
        href: '/tenant/rich-menu-design',
      },
    } as Record<string, { steps: string; linkText: string; href: string }>,
  },

  /* ------------------------------------------------------- 加好友 QR Code */
  /**
   * QR Code：issue #16（補齊-1）已補上真的產生與下載，經 src/lib/qr.ts
   * （擁有者裁決安裝 `qrcode` 套件，不得自寫編碼器——見 14 分冊 §8.2）。
   * 內容＝下方 addFriendUrl（`https://line.me/R/ti/p/{lineBasicId}`）逐字編碼，
   * 與 promote 頁的公開商店頁 QR 是兩個不同的網址、不同的用途。
   */
  botInfo: {
    title: '您的 LINE 官方帳號',
    subtitle: '顧客加好友後即可線上預約、購物、收通知',
    qrTitle: '掃描加好友',
    qrHelp: '請顧客用 LINE 掃描此 QR Code 加入好友',
    addFriend: '加入好友',
    copyLink: '複製連結',
    downloadQr: '下載 QR Code',
    copiedLink: '已複製加好友連結！',
    noQr: '尚未取得 QR Code',
    noLink: '尚未取得加好友連結',
    qrGenerating: 'QR Code 產生中...',
    qrGenerateFailed: 'QR Code 產生失敗',
    qrDownloaded: 'QR Code 已下載',
    qrDownloadFailed: 'QR Code 下載失敗，請稍後重試',
    qrAlt: 'LINE 加好友 QR Code',
    qrFilename: 'LINE加好友QRcode.png',
    downloadDisabledHint: '請先在上方設定「LINE Basic ID」，才會有可下載的加好友 QR Code',
  },

  /* ------------------------------------------------------ 如何讓顧客加入 */
  promotion: {
    title: '如何讓顧客加入？',
    /**
     * issue #16（補齊-1）補上真的 QR 產生與下載後，第 1、3 項改回指引使用
     * 上方那顆「下載 QR Code」按鈕（本站產生，內容＝加好友連結），不再繞去
     * LINE Official Account Manager 後台。
     */
    items: [
      {
        no: '1',
        title: '店內張貼 QR Code',
        desc: '按上方「下載 QR Code」下載後，印出張貼在店內',
      },
      { no: '2', title: '分享加好友連結', desc: '複製連結分享到社群媒體或官網' },
      {
        no: '3',
        title: '名片或傳單',
        desc: '在名片、傳單上印製同一張 QR Code',
      },
      { no: '4', title: '搜尋 ID 加入', desc: '顧客在 LINE 搜尋 @xxx 加入' },
    ],
  },

  /* ------------------------------------------------------------ 自動回覆 */
  autoReply: {
    title: '自動回覆設定',
    enable: '啟用自動回覆',
    offHint:
      '關閉後 bot 不會主動回覆客人閒聊；若沒有 Rich Menu，請告知顧客 傳「 選單 」「 預約 」「 票券 」「 商品 」「 會員 」「 作品 」等關鍵字即可叫出對應功能（按鈕點擊永遠可用）。',
    keywordTip:
      '💬 想讓顧客打「價格」「地址」等文字時 Bot 自動回覆？請到 店家營運 → 關鍵字回覆 設定（含系統內建關鍵字的停用/覆蓋管理）。',
    keywordTipHref: '/tenant/keyword-replies',
    welcomeTip:
      '想自訂「加好友歡迎訊息」？請到 店家設定 → 通知設定 →「加好友歡迎訊息（自訂）」 設定（會顯示在顧客加入好友時的歡迎卡片上）。',
    welcomeTipHref: '/tenant/settings',
    defaultReply: '預設回覆',
    defaultReplyPlaceholder: '無法識別訊息時的預設回覆...',
    defaultReplyHelp: '當 Bot 無法理解顧客訊息時的回覆',
    defaultReplyMax: 500,
    save: '儲存設定',
    saving: '儲存中...',
    saved: '自動回覆設定已儲存',
  },

  /* --------------------------------------------------------- Flex 主選單 */
  flexMenu: {
    title: '主選單樣式（Flex Message）',
    designLink: '前往選單設計',
    designHref: '/tenant/rich-menu-design',
    intro: '自訂顧客在 LINE 聊天室看到的主選單外觀，包含按鈕顏色、圖示和標題。',

    enable: '啟用 Flex 主選單',
    enableOffHint:
      '關閉後：顧客輸入任何文字（含「選單」）都 不會 再彈出主選單，只會收到下方選擇的回應（提示文字或完全靜默）。',
    enableOffHint2:
      '底部 Rich Menu 仍正常運作 ，所有功能（預約/商品/票券）不受影響——請確認已發布底部選單，否則顧客將沒有任何操作入口。',
    fallbackTitle: '關閉時，顧客打閒聊文字的回應：',
    fallbackHint: '回提示文字「請點選下方選單使用 👇」（避免 Bot 看起來像死掉）',
    fallbackSilent: '完全靜默（店家在 LINE OA Manager 自己手動回覆）',
    enabledToast: 'Flex 主選單已啟用',
    disabledToast: 'Flex 主選單已關閉（顧客只能透過 Rich Menu 操作）',
    fallbackHintToast: '已設為純文字提示模式',
    fallbackSilentToast: '已設為完全靜默模式',

    campaignKeyword: '顧客打「活動」等文字時自動回覆活動列表',
    campaignKeywordOn:
      '開啟（預設）：顧客輸入含「活動 / 優惠活動 / 最新活動 / 促銷」的文字時，系統自動回覆活動列表。',
    campaignKeywordOff:
      '關閉：這類文字系統完全不回應——適合已在 LINE OA Manager 自設「本月活動」等關鍵字回覆的店家（避免兩邊同時回覆）。Rich Menu「查看活動」按鈕不受影響。',
    campaignKeywordWarning:
      '⚠️ 關閉前請先確認已在 LINE OA Manager 設好對應的關鍵字自動回覆， 否則顧客打「活動」相關文字會 完全沒有任何回應 。',
    campaignKeywordOnToast: '已開啟活動關鍵字自動回覆',
    campaignKeywordOffToast:
      '已關閉活動關鍵字自動回覆（改由您在 LINE OA Manager 自設的回覆接手）',

    headerColor: 'Header 顏色',
    headerTitle: 'Header 標題',
    headerTitlePlaceholder: '例：✨ {shopName}',
    headerTitleHelp: '{shopName} 會自動替換為您的店名',
    headerSubtitle: '歡迎語',
    headerSubtitlePlaceholder: '歡迎光臨！請問需要什麼服務呢？',
    showTip: '顯示使用提示',
    /**
     * issue #19 已接線（2026-08-26）。原本這裡是一句「此開關尚未生效」的誠實標註
     * （14 分冊 §8.22-b／§8.22-c：開關切得動、存得進 DB，但 `src/server/` 零引用），
     * 現在 `src/server/flex-menu.ts` 的 `buildFlexMenuOutcome()` 真的讀它了，
     * 所以那句話反過來變成不誠實——功能已生效、畫面卻說沒有。
     * `tests/unit/flex-show-tip-honest.test.ts` 就是設計來在這一刻翻面的那條守門測試。
     *
     * ⚠️ 這句話要**逐字描述真實行為**：開了會多送第幾則、哪些情況下不會出現。
     * 寫成「開啟後顧客會收到使用提示」這種模糊句，店家在 SILENT 模式下切開它、
     * 什麼都沒發生，又會回到同一種困惑。
     *
     * ⚠️ 語意本身是**我們選的，不是還原原站的**（06 分冊 §6.2.10）。這件事寫在
     * 分冊與程式註解裡，不寫進店家看的文案——店家要知道的是「切了會怎樣」，
     * 不是我們的考據過程。
     */
    showTipHelp: '開啟後，顧客打「選單」收到主選單卡片時，卡片之後會**再多收到一則**純文字使用提示。'
      + '以下三種情況不會出現：Flex 主選單已關閉（回提示文字或完全靜默時，本來就只有一則）、'
      + '以及你一張卡片都還沒新增的時候。',

    save: '儲存主選單樣式',
    saving: '儲存中...',
    saved: '主選單樣式已儲存！顧客下次開啟聊天時會看到新樣式',
    reset: '恢復預設（預覽）',
    resetDone: '已恢復預設樣式（尚未儲存）',
    resetToast: '主選單已恢復預設',
  },

  /* ------------------------------------------------------------ Rich Menu */
  richMenu: {
    title: 'Rich Menu 快捷選單',
    notConfigured: '未設定',
    isDefault: '已設為預設顯示',
    advancedDesign: '進階選單設計',
    advancedDesignHref: '/tenant/rich-menu-design',

    previewTitle: '即時預覽效果',
    previewChatArea: '顧客聊天區域',
    previewItems: [
      '開始預約',
      '我的預約',
      '瀏覽商品',
      '作品展示',
      '領取票券',
      '我的票券',
      '會員資訊',
      '聯絡店家',
    ],

    themeTitle: '選擇主題配色',
    themes: {
      LINE_GREEN: 'LINE 綠',
      OCEAN_BLUE: '海洋藍',
      ROYAL_PURPLE: '皇家紫',
      SUNSET_ORANGE: '日落橘',
      DARK: '暗黑',
    },

    customBg: '或上傳自訂背景',
    customBgHelp: '上傳背景圖片；目前會以原圖直接發布，系統不會在圖上加字或圖示',
    customBgUrlPlaceholder: '貼上圖片網址（https://...）',
    noOverlay: '直接使用背景圖（不疊加系統文字圖示）',
    noOverlayHelp: '目前一律以原圖發布，所以這個選項不會有任何作用',
    overlayNotBuilt: '文字與圖示疊圖尚未建置，選單一律以底圖原圖發布，因此這裡的疊圖選項與文字顏色調了也不會改變顧客看到的畫面。六格的文字是「按下去會送出的訊息」，不會被畫進圖裡。',
    overlayNotBuiltHint: '疊圖功能尚未建置，調整不會影響發布結果',

    textColor: '文字顏色',
    textColors: {
      white: '白色',
      black: '黑色',
      gold: '金色',
      pink: '粉紅',
      skyblue: '天藍',
    },

    create: '建立主題選單',
    creating: '建立中...',
    created: 'Rich Menu 已發布到 LINE，顧客現在可以看到快捷選單了',
    /* ⚠️ 舊文案是「已使用自訂背景搭配描邊文字」，但 create 端點是把底圖原圖直接
     * 上傳，沒有任何文字／圖示合成（見該 route 開頭的 MVP 說明）。六格文字是
     * 「點下去會送出的訊息」，不會被畫進圖裡——文案不可以宣稱做了沒做的事。 */
    createdCustomBg: 'Rich Menu 已發布到 LINE，使用你上傳的背景圖（原圖，圖上不會疊加文字）',
    createFailedPrefix: '建立失敗：',
    imageFormat: '請上傳 PNG 或 JPG 格式的圖片',

    footnote:
      'Rich Menu 是顧客打開聊天室時，顯示在底部的快捷按鈕選單，可讓顧客快速操作預約、查詢等功能。',
    chatBgNote:
      'LINE 聊天室背景是 LINE 平台功能，由每位用戶自行在 LINE App「設定 → 聊天 → 背景主題」中更改，無法透過 API 統一設定。',
  },

  /* -------------------------------------------------------------- 使用說明 */
  help: {
    title: '使用說明',
    canDoTitle: 'LINE Bot 可以做什麼？',
    canDo: ['接收顧客預約訊息', '自動回覆預約確認', '發送預約提醒通知', '行銷訊息推播'],
    faqTitle: '常見問題',
    faq: [
      {
        q: 'Q: 連線失敗怎麼辦？',
        a: '請確認 Channel ID、Secret 和 Token 是否正確。儲存後系統會自動設定 Webhook URL 並測試連線。',
      },
      {
        q: 'Q: Bot 不回應訊息？',
        a: '1. 請先重新點一次「儲存設定」觸發自動連線 2. 到 LINE 官方帳號管理後台 →「設定」→「回應設定」→ 回應功能區塊把「聊天」關掉（顯示「聊天：關閉」） 3. 「回應方式：手動聊天／自動回應訊息」是聊天開啟時的子選項，不影響此項，重點是「聊天」本身要關',
      },
      {
        q: 'Q: Webhook 驗證是什麼？',
        a: '儲存設定後，系統會自動將 Webhook URL 設定到 LINE 並發送驗證請求。LINE 會向此 URL 發送測試訊號，收到 200 回應即代表驗證成功。如果驗證失敗，請重新點「儲存設定」再試一次。',
      },
      {
        q: 'Q: 按選單沒反應？',
        a: 'Rich Menu 按鈕需要 Bot 連線正常才會回應。請先確認上方「連線狀態」為已啟用，再用「完整檢查」找出問題。',
      },
    ],
  },

  /* -------------------------------------------------------------- 解除綁定 */
  disconnect: {
    title: '解除 LINE 帳號綁定',
    /* ⚠️ 這兩段字要跟 POST /api/settings/line/disconnect 真正做的事一致（06 分冊 §6：
       只清 Channel ID 與兩個 *_enc 欄位）。原文寫「完全清除所有 LINE 設定，包含
       Rich Menu、主選單配置」，但那些外觀偏好其實留著、LINE 官方帳號上已發布的
       選單也不會被刪除——描述比實際做的多，屬鐵則 12 的假宣稱。 */
    body1:
      '解除綁定會清除本店的 Channel ID、Channel Secret 與 Channel Access Token，Bot 隨即停止回應。',
    body2:
      '顧客的 LINE 對話記錄不受影響。自動回覆內容、選單主題等外觀設定會保留，重新填入金鑰即可再次啟用；'
      + 'LINE 官方帳號上已發布的圖文選單不會被自動刪除（金鑰已清除，系統無法再代為呼叫 LINE），如需移除請自行到 LINE Developers 後台操作。',
    action: '解除綁定',
    processing: '處理中...',
    confirmTitle: '解除 LINE 綁定',
    confirmMessage:
      '確定要解除 LINE 帳號綁定嗎？\n\n此操作會清除 Channel ID、Channel Secret 與 Channel Access Token，且無法復原，Bot 將立即停止回應。\n\n自動回覆內容與選單外觀設定會保留；如需重新啟用，請重新填入這三項金鑰。',
    done: 'LINE 帳號已解除綁定',
    doneRichMenuLeft:
      'LINE 帳號已解除綁定，但 Rich Menu 無法自動刪除（Token 已失效）。\n\n請到 LINE Developer Console 手動刪除 Rich Menu，否則顧客仍會看到舊選單。',
    failedPrefix: '解除綁定失敗：',
  },

  /* ------------------------------------------------------------------ 共用 */
  messages: {
    loadFailed: '載入 LINE 設定失敗:',
    loadRichMenuFailed: '載入 Rich Menu 資訊失敗:',
    loadFlexFailed: '載入 Flex 主選單狀態失敗:',
    loadCampaignKeywordFailed: '載入活動關鍵字設定失敗:',
    copied: '已複製到剪貼簿',
    copyFailed: '複製失敗，請手動複製',
    networkError: '連線錯誤，請稍後再試',
    unknownError: '未知錯誤',
    tryLater: '請稍後再試',
    checkSettings: '請檢查設定是否正確',
  },
} as const;
