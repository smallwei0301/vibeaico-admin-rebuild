/**
 * 關鍵字回覆（/tenant/keyword-replies）文案
 * -----------------------------------------------------------------------------
 * 逐字取自原站 docs/specs/keyword-replies.json：兩張卡片的完整說明文字、
 * kwModal 的所有欄位／選項、兩則未訂閱提示 alert，以及 130 餘條 inline JS 訊息
 * （含三組「一鍵建立範本」的完整回覆內容與所有系統內建關鍵字字面值）。
 *
 * ⚠️ 系統內建關鍵字的「分組」在原站是 inline JS 的資料結構，spec 只抓得到扁平的
 *    字串清單；此處依關鍵字語意重建分組（見 systemGroups），字面值本身未改寫。
 */
export const keywordRepliesPage = {
  title: '關鍵字回覆',
  metaTitle: '關鍵字回覆 - 店家後台',
  /** h1 右側的功能商店徽章 */
  priceBadge: '33 點/月・專業版含',

  actions: {
    create: '新增關鍵字',
    createShort: '＋ 新增',
    edit: '編輯',
    delete: '刪除',
  },

  /* ------------------------------------------------------ 我的自訂關鍵字 */
  custom: {
    cardTitle: '我的自訂關鍵字',
    emptyLead: '還沒有自訂關鍵字。顧客最常問的三件事，一鍵建立範本（內容可再修改）：',
    templatePrefix: '建立範本：',
    templates: [
      {
        button: '💰 價格怎麼算',
        keyword: '價格',
        reply:
          '您好！我們的服務價目如下：\n・（服務A）NT$ ___\n・（服務B）NT$ ___\n詳細歡迎點「開始預約」查看所有服務與價格 😊',
      },
      {
        button: '📍 店在哪裡',
        keyword: '地址',
        reply: '我們的店址：___\n🚇 交通方式：___\n🅿️ 停車資訊：___',
      },
      {
        button: '🕐 營業時間',
        keyword: '營業時間',
        reply:
          '我們的營業時間：\n週一～週五 __:__ – __:__\n週六日 ___\n線上預約 24 小時開放喔！',
      },
    ],

    columns: {
      keyword: '關鍵字',
      matchType: '觸發方式',
      action: '動作',
      enabled: '啟用',
      actions: '操作',
    },

    loading: '載入中…',
    loadFailed: '關鍵字列表載入失敗。',
    retry: '重試',
    retryTail: '，或重新整理頁面。',

    /** 卡片下方兩段長提示（原站以 <strong> 斷句） */
    tipLead: '小提醒：顧客「正在預約流程中」時打字仍是操作預約（例如打「取消」是',
    tipStrong: '放棄目前這筆還沒送出的預約、回到主選單',
    tipTail: '，不是取消已成立的預約），不會觸發你的關鍵字。',
    oaTipLead: '另外：若你在 LINE 官方後台（OA Manager）',
    oaTipStrong: '對同一個字也設了自動回應',
    oaTipTail: '，兩邊會同時回覆——建議用本功能取代後，把 OA Manager 那則關閉。',
  },

  /* ------------------------------------------------------ 系統內建關鍵字 */
  system: {
    cardTitle: '系統內建關鍵字（預約、選單、取消…）',
    introLead: '這些是系統預設就會回應的字。一般',
    introStrong: '不需要改動',
    introTail: '——預設全部開啟即可。',
    offLead: '關掉開關＝顧客打這些字 Bot 完全不回（',
    offStrong1: '本系統發布的 Rich Menu 功能按鈕照常可用——走獨立路徑不受影響；',
    offMiddle: '⚠️ 但「',
    offStrong2: '傳送文字',
    offMiddle2: '」類型的格子、或你在 LINE 官方後台自行建立',
    offTail: '的圖文選單「傳送訊息」按鈕，送出的是真文字，會一併沒有回應）；',
    /**
     * 標了 `feature` 的組（例如行程／出團日期屬 TOUR_MODULE）在**未訂閱時仍然顯示**
     * ——因為 webhook 對這些關鍵字沒有 feature 閘門，退訂後 bot 照樣回覆，
     * 店家必須有辦法關掉它（14 分冊 §8.19 擁有者裁決）。
     * 這一句說明它為什麼會出現在這裡，免得店家以為是系統跑錯。
     */
    unsubscribedModuleNote: (moduleName: string) =>
      `此組屬「${moduleName}」，你目前未訂閱該模組——但顧客打這些字 Bot 仍會回應，所以開關保持可用。`,
    moduleNames: {
      TOUR_MODULE: '行程模組',
    } as Record<string, string>,
    overrideLead: '點某個字＝那個字改回你自己寫的內容',
    overrideTail: '，其他字不受影響。',
    campaignNote: '「活動」組請到 LINE 設定頁 → 主選單樣式卡片 的獨立開關管理。',
    /**
     * 14 分冊 §8.16（擁有者裁決）後改寫。原文：
     *   「＊停用/覆蓋屬「自訂關鍵字回覆」功能範圍，需訂閱才會對顧客生效（設定隨時可先存）。」
     * 閘門拆掉後那句立刻變成假的已知——停用現在一律生效，只有「覆蓋」還要訂閱。
     */
    subscribeNote:
      '＊關掉開關（停用內建關鍵字）一律生效，不需訂閱；「覆蓋」是自己寫一則新的回覆內容，屬「自訂關鍵字回覆」功能，需訂閱才能新增。',
    loadFailed:
      '系統關鍵字設定載入失敗——為避免誤覆寫你先前的停用設定，已暫停顯示開關。',
    overridePrefix: '取代內建：',
    disabledSuffix: '（已停用）',
    important: '重要',

    /**
     * 系統內建關鍵字分組。
     * 每組的 keywords 逐字取自 spec 的 jsStrings；分組與組名為依語意重建。
     */
    groups: [
      {
        key: 'BOOKING',
        label: '預約',
        note: '預約流程（完全相符）',
        keywords: ['我想預約', '我要預約', '立即預約', '開始預約', '預約', '預訂', '訂位', '我要訂位'],
      },
      {
        key: 'MY_BOOKING',
        label: '查詢預約',
        note: '',
        keywords: ['我的預約', '查看預約', '查詢預約', '查看我的預約', '我的訂位'],
      },
      {
        key: 'ORDER',
        label: '訂單查詢',
        note: '',
        keywords: ['我的訂單', '查看訂單', '訂單查詢'],
      },
      {
        key: 'MENU',
        label: '選單',
        note: '',
        keywords: ['主選單', '選單', '功能'],
      },
      {
        key: 'HELP',
        label: '說明',
        note: '',
        keywords: ['幫助', '說明'],
      },
      {
        key: 'CANCEL',
        label: '取消',
        note: '',
        keywords: ['取消'],
      },
      {
        key: 'CAMPAIGN',
        label: '活動',
        note: '「活動」組請到 LINE 設定頁 → 主選單樣式卡片 的獨立開關管理。',
        keywords: ['活動', '最新活動', '優惠活動', '促銷'],
      },
      {
        key: 'COUPON',
        label: '票券',
        note: '',
        keywords: [
          '優惠券', '我的優惠券', '我的券', '票券', '我的票券', '領取票券',
          '我的 coupon', '我的coupon',
        ],
      },
      {
        key: 'PRODUCT',
        label: '商品',
        note: '',
        keywords: ['商品', '瀏覽商品', '購買'],
      },
      {
        /** 導遊模組（TOUR_MODULE）；未訂閱該模組的店家不顯示這一組 */
        key: 'TRIP',
        label: '行程',
        feature: 'TOUR_MODULE',
        note: '回覆行程輪播卡片；顧客點「我要預約」進入選方案 → 選團次流程。',
        keywords: ['行程', '有什麼行程', '所有行程', '報名', '我要報名', '揪團', '出團'],
      },
      {
        /** 導遊模組（TOUR_MODULE） */
        key: 'DEPARTURE',
        label: '出團日期',
        feature: 'TOUR_MODULE',
        note: '回覆未來 14 天可報名的團次與剩餘名額。',
        keywords: ['出團日期', '哪天出團', '還有位子嗎', '剩幾位', '名額'],
      },
      {
        key: 'MEMBER',
        label: '會員',
        note: '',
        keywords: ['會員', '會員資訊', '點數'],
      },
      {
        key: 'PORTFOLIO',
        label: '作品',
        note: '',
        keywords: ['作品', '作品展示', '展示'],
      },
      {
        key: 'NOTIFY',
        label: '店家通知',
        note: '',
        keywords: ['開啟店家通知', '關閉店家通知'],
      },
      {
        key: 'MAP',
        label: 'Google 地圖導航',
        note: '',
        keywords: ['Google 地圖導航'],
      },
    ],
  },

  /* -------------------------------------------------- modal：自訂關鍵字 */
  form: {
    createTitle: '新增自訂關鍵字',
    editTitle: '編輯自訂關鍵字',
    /**
     * 原文「可以先把內容設定好存起來，訂閱後立即生效。」是假的已知：
     * POST/PUT /api/settings/line/keyword-replies 帶 requireFeature('KEYWORD_REPLY')，
     * 未訂閱一律 403 FEAT_001（tests/integration/api/keyword-replies.05.test.ts
     * 「自訂關鍵字寫入端點回 403（頁面因此把新增/編輯鎖住，與後端一致）」），
     * 根本存不下來。比照 14 分冊 §6.5 ai-settings 的同型改法。
     */
    unsubscribedLead: '💡 尚未訂閱此功能——自訂關鍵字送出會被擋下（無法儲存），請先',
    unsubscribedLink: '訂閱',
    unsubscribedTail: '。系統內建關鍵字的停用開關不受影響，未訂閱也照樣生效。',

    keyword: '關鍵字',
    keywordPlaceholder: '例：價格、地址、營業時間',
    matchType: '觸發方式',
    matchTypes: {
      EXACT: '訊息就是這個字才回（一字不差）',
      CONTAINS: '訊息裡有這個字就回（建議）',
    },
    matchTypeShort: {
      EXACT: '一模一樣才回',
      CONTAINS: '有此字就回',
    },
    actionType: '動作',
    actionTypes: {
      REPLY_CONTENT: '回覆自訂內容',
      START_PROFILE_COLLECTION: '啟動個資收集（問姓名/手機）',
    },
    actionTypeShort: {
      REPLY_CONTENT: '💬 自訂回覆',
      START_PROFILE_COLLECTION: '📋 個資收集',
    },
    replyText: '回覆文字',
    replyTextPlaceholder: '顧客打此關鍵字時 Bot 回覆的文字',
    image: '附加圖片（選填）',
    imageHelp: '僅支援 JPEG、PNG，最大 5MB。上傳完成後才會隨這則關鍵字回覆儲存。',
    imageUploading: '圖片上傳中…',
    imageUploaded: '圖片已上傳，儲存這則關鍵字回覆後才會正式生效。',
    imageFailed: '圖片上傳失敗，請重新選擇檔案。',
    imagePreviewAlt: '關鍵字回覆圖片預覽',
    imageRemove: '移除',
    linkUrl: '附加連結按鈕（選填）',
    linkUrlPlaceholder: 'https://...',
    linkLabel: '按鈕文字',
    linkLabelPlaceholder: '查看更多',
    enabled: '啟用',

    /** 儲存前的提醒 */
    exactHint: (kw: string) =>
      `⚠️ 顧客必須整句只打「${kw}」才會回；打「請問${kw}多少」不會回覆——顧客常打整句話，建議改選「包含」`,
    containsExample: (kw: string) => `例：顧客打「請問${kw}多少」→ 會回覆`,
    tooShortTitle: '關鍵字太短提醒',
    tooShortLead: '關鍵字「',
    tooShortTail:
      '」很短——顧客訊息只要含這兩個字就會觸發（連閒聊句子都可能中）。\n\n建議改用「訊息就是這個字才回」或更長的關鍵字。仍要儲存嗎？',
    minLength:
      '「訊息裡有這個字就回」的關鍵字至少需 2 個字（單一字元會攔截到大量一般訊息）',
    overrideSystemTitle: '這個字會取代系統功能',
    overrideSystemLead: '注意：顧客打這個字，原本 Bot 會執行「',
    overrideSystemTail: '」相關功能。儲存後會改成回覆你設定的內容。',
    draftHint: '（還沒儲存，可修改）',
  },

  /* ---------------------------------------------------------- 功能訂閱 */
  /*
   * ⚠️ 這一段全部依 14 分冊 §8.16（擁有者裁決）改寫過。原文把「停用內建關鍵字」
   * 也算進付費範圍（hint 甚至逐字寫著「含下方系統內建關鍵字的停用/覆蓋」），
   * 閘門拆掉後那些句子全部變成假的已知。改寫後只講兩件實際量到的事：
   *   1. 未訂閱 → 自訂關鍵字的寫入端點 403（存不下來，不是「存得下但不生效」）
   *   2. 停用開關 → 一律生效，與訂閱狀態無關
   */
  feature: {
    hint: '💡 尚未訂閱「自訂關鍵字回覆」——新增/編輯自訂關鍵字',
    hintStrong: '送出會被擋下（無法儲存）',
    hintTail: '；下方系統內建關鍵字的停用開關不受影響，關掉就立即生效。',
    goToStore: '前往功能商店訂閱 →',
    systemHint: '💡 尚未訂閱也沒關係——下方的停用開關',
    systemHintStrong: '一律生效（關掉後顧客打那些字就完全沒有回應）',
    systemHintTail: '；但「覆蓋」（點關鍵字改成你自己寫的內容）要訂閱後才能新增。',
  },

  /* --------------------------------------------------------------- 確認 */
  confirm: {
    deleteTitle: '刪除關鍵字',
    deleteLead: '確定刪除關鍵字「',
    deleteTail: '」？',
    disableSystemTitle: '⚠️ 停用前請確認',
    disableEscape: (kw: string) =>
      `「${kw}」是顧客在對話中的逃生口（流程卡住時用的）。\n\n確定要停用嗎？`,
    /**
     * 這句現在對「已訂閱／未訂閱」都成立，所以確認視窗不再有訂閱分支。
     * 已刪除的 disableUnsubscribedLead/Tail（原文：「這個停用設定會先儲存但
     * 『不會生效』…訂閱後此設定才會讓顧客打這些字時完全沒有回應」）在 §8.16
     * 之後是**反過來**的謊言：停用一律生效，再警告一次就是嚇阻使用者去用一個
     * 其實已經可用的功能。
     */
    disableNoReply: (kw: string) => `關鍵字「${kw}」將完全沒有回應！`,
  },

  /* --------------------------------------------------------------- 訊息 */
  /*
   * ⚠️ 已刪除的五個鍵（§8.16 之後全部是假的已知，不要再加回來）：
   *   savedNotActive        '已儲存（尚未生效——訂閱「自訂關鍵字回覆」後立即生效）'
   *   savedUnknownSubscription '已儲存（無法確認訂閱狀態，請重新整理頁面確認是否生效）'
   *   savedDisabled         '已儲存停用設定（尚未生效——訂閱「自訂關鍵字回覆」後立即生效）'
   *   savedDisabledUnknown  '已儲存停用設定（無法確認訂閱狀態，請重新整理頁面確認是否生效）'
   *   enabledNotActive      '已啟用（尚未生效——訂閱「自訂關鍵字回覆」後立即生效）'
   *
   * 兩條理由，都是「我們其實知道」：
   * 1. 停用設定（savedDisabled*）→ §8.16 拆掉閘門後一律生效，沒有「尚未生效」這種狀態。
   * 2. 自訂關鍵字（savedNotActive / enabledNotActive / savedUnknownSubscription）→
   *    寫入端點帶 requireFeature，**回 200 這件事本身就是訂閱有效的量測結果**
   *    （未訂閱一律 403 走 catch 分支）。再說一次「無法確認訂閱狀態」是捏造的
   *    不確定性，和捏造確定性一樣是假的已知（CLAUDE.md：不知道才顯示不知道）。
   */
  messages: {
    saved: '已儲存',
    saveFailed: '儲存失敗',
    deleted: '已刪除',
    enabled: '已啟用',
    disabled: '已停用',
    systemGroupDisabled: '已停用該組系統關鍵字',
    systemGroupRestored: '已恢復該組系統關鍵字',
    keywordRequired: '請輸入關鍵字',
    replyRequired: '請輸入回覆文字',
    imageUploadFailedPrefix: '圖片上傳失敗：',
    imageTooLarge25: '圖片過大（超過 25MB），請改用較小的圖片',
    imageStillTooLarge: '圖片壓縮後仍超過 5MB，請改用較小的圖片',
    imageFormat: '無法處理此圖片格式，請改用 JPG/PNG',
    retryLater: '請稍後再試',
    connectionError: '連線錯誤，請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '還沒有自訂關鍵字',
    description: '顧客最常問的三件事，一鍵建立範本（內容可再修改）。',
  },
} as const;
