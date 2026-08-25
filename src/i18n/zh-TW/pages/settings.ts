/**
 * 店家設定（/tenant/settings）文案
 * -----------------------------------------------------------------------------
 * 逐字取自原站 DOM 與 inline JS（docs/specs/settings.json 的
 * headings / tabs / cards.bodyText / forms.fields / alerts / buttons / jsStrings）。
 * 對應的資料 schema 見 src/config/tenant-settings.ts。
 */
export const settingsPage = {
  title: '店家設定',
  metaTitle: '店家設定 - 店家後台',

  /* ------------------------------------------------------------------ tabs */
  tabs: {
    basic: '基本資訊',
    business: '營業設定',
    notification: '通知設定',
    points: '點數設定',
    calendarSync: '行事曆同步',
    security: '帳號安全',
  },

  /* ------------------------------------------------------------ 基本資訊 */
  basic: {
    heading: '基本資訊',

    publicUrl: {
      title: '公開預約網址',
      copy: '複製',
      openLabel: '開啟公開預約頁',
      help: '分享此連結，顧客即可直接在網頁上預約（不需 LINE）',
    },

    tenantName: '店家名稱',
    tenantNamePlaceholder: '請輸入店家名稱',
    tenantNameInvalid: '請輸入店家名稱',

    tenantPhone: '聯絡電話',
    tenantPhonePlaceholder: '例如：02-1234-5678',
    tenantPhoneInvalid: '請輸入有效的電話號碼',

    tenantEmail: '電子郵件',
    tenantEmailPlaceholder: 'contact@example.com',
    tenantEmailHelp: '用於接收系統通知',
    tenantEmailInvalid: '請輸入有效的電子郵件',

    tenantAddress: '地址',
    tenantAddressPlaceholder: '店家地址',
    tenantAddressHelp: '顯示於預約確認通知中',

    tenantDescription: '店家簡介',
    tenantDescriptionPlaceholder: '簡單介紹您的店家特色...',
    tenantDescriptionMax: 500,

    save: '儲存變更',
    saving: '儲存中...',
    saved: '基本資訊已儲存',
  },

  /* ------------------------------------------------------------ 營業設定 */
  business: {
    heading: '營業設定',
    intro: '設定營業時間會影響顧客可預約的時段',

    perDayMode: '每天營業時間不同',
    perDayModeHelp:
      '開啟後可逐日設定不同營業時段（甚至同一天分上、下午多段）。系統會自動換算成營業時間與封鎖時段，無須手動設定封鎖。',
    perDayNotice:
      '逐日設定後，系統會自動把「沒開放的時段」建立成 每週封鎖時段 （在「封鎖時段」頁會看到「自動產生」標記，請勿手動刪除——要調整請回此頁）。下方「預約間隔／可提前預約／截止日」設定仍適用於所有日子。',
    /** 逐日編輯器（原站以 inline JS 動態產生，字串取自 jsStrings） */
    perDayOpen: '營業',
    perDayTo: '至',
    perDayAddSlot: '新增時段',
    perDayRemoveSlot: '移除時段',
    perDayClosed: '公休',

    businessStart: '營業開始時間',
    businessStartInvalid: '請選擇營業開始時間',
    businessEnd: '營業結束時間',
    businessEndInvalid: '結束時間必須晚於開始時間',
    breakStart: '休息開始時間',
    breakStartInvalid: '休息開始時間不正確',
    breakStartHelp: '設定午休時間，該時段不可預約（選填）',
    breakEnd: '休息結束時間',
    breakEndHelp: '休息結束後恢復可預約',

    slotInterval: '預約時段間隔',
    slotIntervalHelp: '顧客可選擇的預約時間間隔',
    slotIntervalOptions: [
      { value: '30', label: '30 分鐘' },
      { value: '60', label: '60 分鐘' },
      { value: '90', label: '90 分鐘' },
      { value: '120', label: '120 分鐘' },
    ],

    advanceBooking: '可提前預約時間',
    advanceBookingUnits: [
      { value: 'MONTH', label: '月' },
      { value: 'DAY', label: '天' },
    ],
    advanceBookingHelpMonth: (n: number) => `顧客最多可提前 ${n} 個月預約`,
    advanceBookingHelpDay: (n: number) => `顧客最多可提前 ${n} 天預約`,

    bookingCutoffDate: '預約截止日期 (選填)',
    bookingCutoffClear: '清除',
    bookingCutoffHelp:
      '固定截止日：不管今天幾號，顧客最遠只能預約到此日期（與提前天數取較早者）。留白＝不啟用。',
    bookingCutoffSummary: (date: string) => `顧客最遠只能預約到 ${date}`,
    bookingCutoffSummarySuffix: '（與提前天數限制取較早者）',
    bookingCutoffExpired:
      '⚠️ 截止日已過 — 顧客目前無法透過 LINE / 公開頁面預約任何日期！請更新或清除截止日。',

    minAdvanceBookingDays: '最快可預約 (前置時間)',
    minAdvanceBookingDaysHelp: '顧客下單當下起算，最少要提前幾天才能預約（0＝當天可預約）',

    closedDays: '公休日',
    closedDaysHelp: '勾選的日子不開放預約',

    save: '儲存變更',
    saving: '儲存中...',
    saved: '營業設定已儲存',

    /* 驗證（原站 inline JS） */
    validation: {
      endAfterStart: '營業結束時間必須晚於開始時間',
      breakPair: '休息時間請同時填寫開始和結束時間，或都不填',
      breakEndAfterStart: '休息結束時間必須晚於開始時間',
      breakStartTooEarly: '休息開始時間不能早於營業開始時間',
      breakEndTooLate: '休息結束時間不能晚於營業結束時間',
      advanceRange: '可提前預約時間最少 1 天，最多 6 個月',
      atLeastOneOpenDay: '請至少設定一天的營業時段（不能全部公休）',
      perDayOrder: (day: string) => `${day} 的時段開始時間必須早於結束時間`,
      perDayOverlap: (day: string) => `${day} 的營業時段互相重疊`,
      checkPrefix: '請檢查：',
    },

    /* 儲存後的附帶訊息 */
    autoBlockCreated: (n: number) =>
      `已依你的營業時段自動建立 ${n} 筆封鎖時段（可在「封鎖時段」頁查看，請勿手動刪除，要調整請回此頁）`,
    conflictWarning: (n: number) =>
      `⚠️ 注意：有 ${n} 筆既有預約落在新的公休日或非營業時段。\n\n設定已儲存，但這些預約「不會」自動取消。請至「預約列表」確認是否需要調整時間或通知顧客。`,
    conflictWarningHours: (n: number) =>
      `⚠️ 注意：有 ${n} 筆既有預約落在新的非營業時段。\n\n設定已儲存，但這些預約「不會」自動取消。請至「預約列表」確認是否需要調整或通知顧客。`,
    manualBlockKept: (n: number) =>
      `ℹ️ 偵測到 ${n} 筆你「手動建立的每週封鎖」，已保留（不會自動刪除）。\n\n若這些封鎖是用來塑形舊的營業時段，可能與新的逐日營業時間重疊，請至「封鎖時段」頁確認是否要刪除。`,
  },

  /* ------------------------------------------------------------ 通知設定 */
  notification: {
    heading: '通知設定',
    intro: '設定何時要收到系統通知',

    quotaTipTitle: '省額度提示：',
    quotaTipBody:
      '每則 LINE 推播消耗 1 則 push 額度。關閉不需要的通知可節省額度，特別是 LINE 免費方案每月只有 200 則。',

    /** 未訂閱功能時的提醒（原站 inline JS 動態插入） */
    featureLock: {
      reminder: '未訂閱時不會發送任何提醒（LINE 與 Email 都不會），此處設定不會生效。',
      birthday: '未訂閱時不會發送任何生日祝福，此處設定不會生效。',
      recall: '未訂閱時不會發送任何喚回訊息，此處設定不會生效。',
      names: {
        reminder: '自動預約提醒',
        birthday: '生日祝福',
        recall: '顧客喚回',
      },
    },

    /* --- 顧客通知 --- */
    customerSection: '顧客通知',
    bookingReminder: '預約提醒',
    bookingReminderHelp: '自動提醒顧客即將到來的預約（LINE / Email 自動切換）',
    reminderHoursBefore: '提醒時間',
    reminderHoursOptions: [
      { value: '1', label: '預約前 1 小時' },
      { value: '2', label: '預約前 2 小時' },
      { value: '3', label: '預約前 3 小時' },
      { value: '6', label: '預約前 6 小時' },
      { value: '12', label: '預約前 12 小時' },
      { value: '24', label: '預約前 1 天' },
      { value: '48', label: '預約前 2 天' },
    ],

    /* --- 生日祝福與顧客喚回 --- */
    birthdaySection: '生日祝福與顧客喚回',
    birthdayGreeting: '生日祝福',
    birthdayGreetingHelp: '每天早上 9:00 自動發送給當天生日的顧客',
    birthdayMessage: '祝福訊息',
    birthdayMessagePlaceholder: '例：🎂 生日快樂！本月來店消費享專屬優惠',
    customerRecall: '顧客喚回',
    customerRecallHelp: '每天下午 2:00 自動發送給久未到訪的顧客（每家店每天最多 50 位）',
    customerRecallDays: '多久沒來就喚回',
    customerRecallDaysUnit: '天',
    customerRecallMessage: '喚回訊息',
    customerRecallMessagePlaceholder: '例：好久不見！最近推出新服務，歡迎回來看看 😊',

    /* --- LINE 預約狀態推播 --- */
    lineSection: 'LINE 預約狀態推播',
    bookingConfirmed: '預約已確認',
    bookingConfirmedHelp: '確認預約時推播 LINE 通知顧客',
    bookingCompleted: '預約已完成',
    bookingCompletedHelp: '服務完成時推播 LINE 通知顧客（預設關閉）',
    bookingCancelled: '預約已取消',
    bookingCancelledHelp: '取消預約時推播 LINE 通知顧客',
    bookingModified: '預約被修改',
    bookingModifiedHelp: '預約時間、人員等變更時推播 LINE 通知顧客',
    bookingNoShow: '顧客爽約',
    bookingNoShowHelp: '標記爽約時推播 LINE 通知顧客（預設關閉）',

    /* --- Email 預約通知 --- */
    emailSection: 'Email 預約通知',
    emailLocked: '此功能需訂閱「Email 預約通知」或輕量版/專業版方案。',
    emailLockedCta: '前往開通（49 點/月）',
    newBooking: '店家：新預約 / 確認通知',
    newBookingHelp: '新預約建立和確認時，Email 通知店家',
    bookingCancel: '店家：取消預約通知',
    bookingCancelHelp: '預約被取消時，Email 通知店家',
    staffBooking: '員工：預約 Email 通知',
    staffBookingHelp: '員工被指派預約時，Email 通知該員工（需在員工管理填寫 Email）',
    productOrder: '店家：商品訂單 Email 通知',
    productOrderHelp: 'LINE Bot / 公開頁 / 購物車建立商品訂單時，Email 通知店家（預設開啟）',

    /* --- 預約自動確認 --- */
    autoConfirmSection: '預約自動確認',
    autoConfirm: '自動確認預約',
    autoConfirmHelp:
      '開啟後，顧客預約將自動確認，無需手動操作。適合一人店家或不需審核預約的情境。',
    autoConfirmHelpExtra:
      '（若你有服務設定了「線上收款」，此開關也決定 顧客付款完成後要不要自動確認 ——關閉時付款後仍停在待確認，由你手動確認。）',
    autoConfirmOffHint: '關閉時走原本手動確認流程',

    /* --- 商品訂單線上收款 --- */
    productPaymentSection: '商品訂單線上收款',
    productOnlinePayment: '顧客下單必須線上刷卡付款才成立',
    productOnlinePaymentHelp:
      '開啟後，顧客在公開頁 / LINE 自助下單會拿到付款連結： 付全額成功 → 訂單自動變「已確認」 ； 15 分鐘沒付 → 自動取消並把庫存還回來 。取貨/出貨後仍由你按「完成」。',
    productOnlinePaymentPrereq: '前提：你已在「收款方式」設定並開通線上刷卡金流。',
    /** 金流狀態提示（原站依 /api/payment-methods 動態顯示） */
    paymentGatewayNone:
      '目前沒有線上刷卡金流，此開關開了也不會生效（顧客照舊免付款下單）。',
    paymentGatewayDemo:
      '目前是示範測試金流：顧客會被要求付款且有 15 分鐘倒數，但測試卡付款不會自動確認訂單（示範付款可偽造，刻意不觸發出貨）。正式收款請改綁自己的金流帳號。',
    paymentGatewayPending:
      '線上刷卡金流尚未開通（未通過小額實刷測試，或剛改過金鑰被重置），此開關目前不會生效。',
    paymentGatewayReady: (provider: string) =>
      `線上刷卡金流已開通（${provider}），開關開啟即生效。`,

    /* --- 強制指定服務人員 --- */
    staffMandatorySection: '強制指定 服務人員',
    staffMandatory: '預約時強制顧客指定 服務人員',
    staffMandatoryHelp:
      '開啟後，顧客在 LINE、公開頁、後台代客建單預約時， 必須選擇一位 服務人員 ，沒選就無法送出（不再由系統自動分配）。適合多人店家、希望每筆預約都指定誰來服務。',
    staffMandatoryOffHint: '關閉：沿用「可不指定，系統自動安排」。',
    staffMandatoryNotice:
      '注意 ：開啟前請先確認每個服務項目都有可服務的人員，否則顧客會找不到可選的 服務人員。',

    /* --- 隱私防護 --- */
    privacySection: '隱私防護',
    privacyProtection: '隱私防護模式',
    privacyProtectionHelp:
      '開啟後，LINE 個資收集改用網頁表單，顧客資料不會留在 LINE chat 紀錄裡。建議多人共用 OA 的店家開啟。',
    privacyProtectionExtra:
      '關閉時走原本 LINE 對話收集流程；開啟時顧客會看到一張卡片含「點此填寫個資」按鈕。',
    collectEmail: '預約時收集顧客 Email',
    collectEmailHelp:
      '開啟（預設）：LINE 預約個資收集會多問一步 Email（顧客可跳過）；隱私表單也會顯示 Email 欄位。',
    collectEmailExtra: '關閉：LINE 不再詢問 Email、隱私表單不顯示 Email 欄位，縮短預約流程。',
    collectEmailTip: '提示 ：未訂閱 Email 通知功能時，收集到的 Email 不會用於寄送預約通知。',
    collectBirthday: '預約時收集顧客生日',
    collectBirthdayHelp: '開啟（預設）：LINE 預約 / 隱私表單會請顧客填生日。關閉：不再詢問生日。',
    collectBirthdayExtra:
      '生日主要用於「生日祝福」「生日優惠活動」（需訂閱對應功能），沒在用可關閉、縮短預約流程。',
    collectGender: '預約時收集顧客性別',
    collectGenderHelp: '開啟（預設）：LINE 預約 / 隱私表單會請顧客選性別。關閉：不再詢問性別。',
    deferProfile: '加好友時先不收集資料（延後到預約時）',
    deferProfileHelp: '關閉（預設）：新好友加入 LINE 當下就會被要求填寫手機等資料。',
    deferProfileExtra:
      '開啟：加好友只顯示歡迎訊息，顧客可先詢問商品、瀏覽功能；等顧客真的要預約時才收集資料。適合「顧客多半先詢問、少數才預約」的店家（如代購、諮詢型服務）。',

    /* --- 加好友歡迎訊息 --- */
    welcomeSection: '加好友歡迎訊息',
    welcomeMessageText: '加好友歡迎訊息（自訂）',
    welcomeMessageTextPlaceholder: '例：嗨！感謝您加入本店的官方帳號',
    welcomeMessageTextHelp: '留白＝系統預設（嗨 OO！感謝您加入本店的官方帳號 👋）',
    welcomeCardTitle: '歡迎卡片標題（自訂）',
    welcomeCardTitlePlaceholder: '例：歡迎加入！',
    welcomeCardTitleHelp: '留白＝系統預設（歡迎加入！）',
    welcomeCardImage: '歡迎卡片圖片（自訂）',
    welcomeCardImageUpload: '上傳圖片',
    welcomeCardImageRemove: '移除圖片',
    welcomeCardImageUpdated: '歡迎卡片圖片已更新',
    welcomeCardImageRemoved: '已移除歡迎卡片圖片',
    welcomeFeatureListText: '歡迎卡片功能介紹清單（自訂）',
    welcomeFeatureListTextPlaceholder: '一行一項，例：預約到店試穿',
    welcomeFeatureListTextHelp:
      '一行一項，最多 8 行。例：👗 預約到店試穿、📦 詢問代購商品、💬 直接留言客服',
    profileCollectIntroText: '個資收集開場白（自訂）',
    profileCollectIntroTextPlaceholder: '例：請先完成基本資料，即可開始使用預約服務',
    profileCollectIntroTextHelp:
      '留白＝系統預設（歡迎加入！🎉 請先完成基本資料，即可開始使用預約服務。）',
    profileCollectDoneText: '個資收集完成招呼語（自訂）',
    profileCollectDoneTextPlaceholder: '例：資料收到囉！有想找的款式隨時跟我說 😊',
    profileCollectDoneTextHelp: '留白＝系統預設（🎉 資料設定完成！）',

    /* --- 預約自訂欄位 --- */
    customFieldsSection: '預約自訂欄位',
    bookingCustomFields: '預約自訂欄位',
    bookingCustomFieldsPlaceholder: '一行一個欄位，行尾加 * 表必填\n例：\n車型*\n特殊需求',
    bookingCustomFieldsHelp:
      '一行一個欄位（最多 5 個、每個 20 字），行尾加 * 表必填。例：「車型*」「特殊需求」',

    save: '儲存變更',
    saving: '儲存中...',
    saved: '通知設定已儲存',

    validation: {
      customFieldsTooMany: (n: number) => `預約自訂欄位最多 5 個，目前有 ${n} 個，請刪減後再儲存`,
      customFieldNameTooLong: '預約自訂欄位每個名稱最多 20 字，請縮短後再儲存',
      welcomeFeatureTooMany: (n: number) =>
        `歡迎卡片功能介紹清單最多 8 行，目前有 ${n} 行，請刪減後再儲存`,
      uploadFailedPrefix: '上傳失敗：',
      removeFailedPrefix: '移除失敗：',
    },
  },

  /* ------------------------------------------------------------ 點數設定 */
  points: {
    heading: '顧客點數累積設定',
    intro: '設定顧客完成預約後如何累積點數。',
    featureLock:
      '未訂閱時顧客完成預約/訂單不會自動累積點數（不會報錯，就是靜靜地不加），此處設定不會生效。',
    featureLockName: '集點系統',

    earnEnabled: '啟用點數累積',
    earnEnabledHelp: '開啟後，顧客完成預約可自動獲得點數',

    earnRate: '點數累積比例',
    earnRatePrefix: '每消費 NT$',
    earnRateSuffix: '元累積 1 點',
    earnRateHelp: '例如填 100，代表顧客消費 NT$100 可獲得 1 點',

    roundingTitle: '進位方式',
    roundingFloor: '無條件捨去',
    roundingFloorTag: '（推薦）',
    roundingFloorExample: '消費 NT$95（比例 10）→ 9 點',
    roundingRound: '四捨五入',
    roundingRoundExample: '消費 NT$95（比例 10）→ 10 點',
    roundingCeil: '無條件進位',
    roundingCeilExample: '消費 NT$91（比例 10）→ 10 點',

    calculatorTitle: '點數試算',
    calculatorAmount: '消費金額',
    calculatorCurrency: 'NT$',
    calculatorResult: (n: number) => `${n} 點`,

    save: '儲存變更',
    saving: '儲存中...',
    saved: '點數設定已儲存',
    rateInvalid: '點數累積比例需在 1-1000 之間',
  },

  /* ---------------------------------------------------------- 行事曆同步 */
  calendarSync: {
    heading: '行事曆同步',
    intro: '把 VibeAI 的預約同步到 Google Calendar / Apple 行事曆（唯讀訂閱）。',
    urlLabel: '訂閱網址（ICS）',
    google: '加入 Google Calendar',
    copy: '複製訂閱網址',
    regenerate: '重新產生網址',
    moreLinkText: '前往「行事曆同步」頁管理外部行事曆',

    /**
     * ⚠️ 誠實化文案（CLAUDE.md「Never fabricate a known」）。
     * ICS 訂閱端點 `/ics/{shopCode}/{token}.ics` 在 src/app 底下並不存在，
     * 也沒有 `/api/settings/calendar` 可以發或撤 token。
     * 舊實作把一個硬編碼陣列（REGENERATED_ICS_TOKENS）輪替當成「新 token」，
     * 按下去就 toast「已產生新網址」——店家會以為舊網址已失效（假的安全操作），
     * 實際上沒有任何東西被撤銷，因為根本沒有任何網址是有效的。禁止復原。
     */
    notBuilt: {
      title: 'ICS 訂閱端點尚未建置，此處無法提供可用的訂閱網址',
      body:
        '系統目前沒有 ICS 輸出端點，因此無法產生訂閱網址，Google Calendar 也訂閱不到任何預約；「重新產生網址」一併停用——在端點建置完成前，系統無從撤銷或換發任何網址，保留該按鈕只會讓你誤以為舊連結已失效。',
      urlUnavailable: '尚未開通',
      disabledHint: 'ICS 訂閱端點尚未建置，目前沒有可用的訂閱網址',
    },
  },

  /* ------------------------------------------------------------ 帳號安全 */
  security: {
    heading: '更改密碼',
    warning: '更改密碼後需要重新登入',

    currentPassword: '目前密碼',
    newPassword: '新密碼',
    confirmPassword: '確認新密碼',
    newPasswordHelp: '建議 8 碼以上，混合英文與數字',

    submit: '更改密碼',
    submitting: '處理中...',
    confirmTitle: '更改密碼',
    confirmMessage: '更改密碼後需要重新登入，確定要繼續嗎？',

    incomplete: '請確認所有密碼欄位已填寫，且新密碼與確認密碼一致',
    wrongCurrent: '目前密碼不正確',
    wrongPassword: '密碼錯誤',
    changed: '密碼已更改，請重新登入',
    failedPrefix: '更改密碼失敗：',
  },

  /* ------------------------------------------------------------------ 共用 */
  messages: {
    loadFailed: '載入設定失敗，請重新整理頁面',
    loadFailedPrefix: '載入設定失敗:',
    saveFailedPrefix: '儲存失敗：',
    unknownError: '未知錯誤',
    networkError: '連線錯誤，請稍後再試',
    tryLater: '請稍後再試',
    copied: '已複製',
    copiedPublicUrl: '已複製預約網址',
  },
} as const;
