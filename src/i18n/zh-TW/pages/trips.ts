/**
 * 行程管理（/tenant/trips、/tenant/trips/[id]）文案
 * -----------------------------------------------------------------------------
 * 導遊模組（TOUR_MODULE）。欄位語意對應 Midao 的 activities / activity_plans /
 * activity_plan_seasons / activity_addons，規格見 docs/integration/10-TOUR-DOMAIN.md。
 *
 * 兩條可見性通道彼此獨立，文案務必說清楚，避免導遊誤解：
 *   status       → VibeAI 公開商店頁（導遊自己決定）
 *   midaoListing → Midao 前台（需 Midao 管理者審核）
 */
export const tripsPage = {
  title: '行程管理',
  metaTitle: '行程管理 - 店家後台',
  detailTitle: '行程編輯',

  /* --------------------------------------------------------------- 列表頁 */
  tableTitle: '全部行程',
  actions: {
    create: '新增行程',
    edit: '編輯',
    duplicate: '複製',
    delete: '刪除',
    publish: '發布到商店頁',
    unpublish: '從商店頁下架',
    requestMidao: '申請上架 Midao',
    viewShop: '預覽商店頁',
    manageDepartures: '團次與名額',
    back: '返回行程列表',
    save: '儲存',
    importJson: '匯入行程 JSON',
    exportJson: '匯出行程 JSON',
  },
  columns: {
    trip: '行程',
    plans: '方案',
    departures: '近期團次',
    price: '最低價',
    status: '商店頁',
    midao: 'Midao 前台',
    actions: '操作',
  },
  filters: {
    keywordPlaceholder: '搜尋行程名稱 / 地區',
    statusAll: '全部狀態',
    midaoAll: '全部 Midao 狀態',
  },

  /* ----------------------------------------------------- 狀態（兩條通道） */
  status: {
    DRAFT: '草稿',
    PUBLISHED: '已發布',
    ARCHIVED: '已封存',
  },
  midaoListing: {
    NONE: '未申請',
    PENDING: '審核中',
    LISTED: '已上架',
    REJECTED: '已退回',
  },
  midaoHint: {
    NONE: '尚未申請上架 Midao 前台；行程仍可在你的商店頁與 LINE 販售。',
    PENDING: '已送出申請，等待 Midao 管理者審核。審核期間商店頁照常販售。',
    LISTED: '已在 Midao 前台曝光，旅客可從 Midao 直接下單。',
    REJECTED: 'Midao 管理者退回，請依說明修改後重新申請。',
  },
  midaoRejectLabel: '退回原因',

  /* ------------------------------------------------------------ 空 / 提示 */
  empty: {
    title: '還沒有任何行程',
    description: '建立第一個行程，設定方案與價格後即可在商店頁、LINE 與 Midao 販售。',
  },
  tips: {
    title: '行程與方案怎麼設定',
    items: [
      { term: '行程', text: '＝旅客看到的「這趟旅程是什麼」：介紹、集合地點、費用包含與注意事項。' },
      { term: '方案', text: '＝同一個行程的不同賣法（例：兩人成行、包團、含接送），價格與人數限制設在方案上。' },
      { term: '團次', text: '＝實際出團的日期與名額。固定團次型的方案一定要先開團次，旅客才能下單。' },
      { term: '加購', text: '＝下單時可勾選的附加項目（例：保險、器材租借、接送）。' },
    ],
  },
  channelNote: {
    title: '兩個上架通道是分開的',
    text: '「發布到商店頁」由你自己決定，按下去旅客立刻能從你的公開商店頁與 LINE 訂購；「上架 Midao」需要 Midao 管理者審核通過才會在 Midao 前台曝光。兩者互不影響。',
  },

  /* ----------------------------------------------------- 新增行程（列表頁） */
  createForm: {
    title: '新增行程',
    hint: '先填行程名稱就能建立，其餘欄位（簡介、集合地點、費用包含…）建立後在編輯頁補齊。',
    submit: '建立行程',
  },

  /* --------------------------------------------------------------- 分頁籤 */
  tabs: {
    basic: '基本資料',
    plans: '方案與定價',
    departures: '團次與名額',
    addons: '加購項目',
  },

  /* ------------------------------------------------------ 基本資料表單 */
  form: {
    titleLabel: '行程名稱',
    titlePlaceholder: '例：龜山島賞鯨半日遊',
    slugLabel: '網址代稱',
    slugPlaceholder: '僅限小寫英文、數字、連字號',
    slugHelp: '公開商店頁網址會用到，建立後盡量不要更動。',
    taglineLabel: '一句話標語',
    taglinePlaceholder: '例：跟著在地船長，找到那群飛旋海豚',
    summaryLabel: '簡介',
    summaryHelp: '顯示在商店頁與 LINE 卡片，建議 60 字內。',
    descriptionLabel: '詳細行程',
    descriptionHelp: '顯示在 Midao 前台與商店頁的行程詳情，可分段描述每個時段。',
    regionLabel: '地區',
    regionPlaceholder: '例：宜蘭 頭城',
    categoryLabel: '分類',
    coverLabel: '封面圖片',
    coverHelp: '建議 1200×800 以上，會用在列表卡片與 LINE 訊息。',
    galleryLabel: '其他照片',
    galleryHelp: (max: number) => `最多 ${max} 張，可拖曳調整順序。`,
    meetingPointLabel: '集合地點',
    meetingPointPlaceholder: '例：烏石港遊客中心大門口',
    meetingMapLabel: '集合地點地圖連結',
    inclusionsLabel: '費用包含',
    exclusionsLabel: '費用不包含',
    noticesLabel: '注意事項',
    listHelp: '一行一項。',
    safetyLabel: '安全須知',
    refundLabel: '退款政策',
    refundOptions: {
      STANDARD: '標準（出發前 7 天全額退，3 天內不退）',
      FLEXIBLE: '彈性（出發前 24 小時皆可全額退）',
      STRICT: '嚴格（訂購後不退款）',
    },
    uploadCta: '上傳圖片',
    removeImage: '移除',
  },

  /* --------------------------------------------------------------- 方案 */
  plans: {
    sectionTitle: '方案',
    sectionHint: '同一個行程可以有多個方案。旅客下單時先選方案，再選出團日期。',
    create: '新增方案',
    editTitle: (name: string) => `編輯方案「${name}」`,
    createTitle: '新增方案',
    empty: {
      title: '還沒有方案',
      description: '至少要有一個方案，旅客才能下單。',
    },
    columns: {
      name: '方案名稱',
      price: '價格',
      party: '人數',
      bookingType: '預約型態',
      deposit: '收款',
      season: '販售期間',
      review: '審核',
      status: '狀態',
      actions: '操作',
    },
    fields: {
      nameLabel: '方案名稱',
      namePlaceholder: '例：兩人成行、包船專案',
      descriptionLabel: '方案說明',
      durationLabel: '行程時長（分鐘）',
      priceTypeLabel: '計價方式',
      basePriceLabel: '售價',
      childPriceLabel: '兒童價',
      childPriceHelp: '留空代表不分大小人同價。',
      minLabel: '最少人數',
      maxLabel: '最多人數',
      partyHelp: '每筆訂單可訂購的人數範圍。',
      bookingTypeLabel: '預約型態',
      depositLabel: '線上收款方式',
      depositValueLabel: '定金金額',
      depositPercentLabel: '定金比例（%）',
      depositHelp: {
        NONE: '不透過線上收款，旅客下單後由你另行收款。',
        DEPOSIT_FIXED: '線上先收固定金額定金，尾款出團當日現場收。',
        DEPOSIT_PERCENT: '線上先收訂單金額的一定比例，尾款出團當日現場收。',
        FULL: '線上一次收足全額。',
      },
      depositPerPersonNote: '每人計價的方案，定金會乘以人數。',
      activeLabel: '啟用此方案',
      yearRoundLabel: '全年販售',
      yearRoundHelp: '關閉後可設定只在特定季節販售，並為各季節設不同售價。',
    },
    priceType: {
      PER_PERSON: '每人計價',
      PER_GROUP: '每團計價',
    },
    depositMode: {
      NONE: '不線上收款',
      DEPOSIT_FIXED: '固定定金',
      DEPOSIT_PERCENT: '比例定金',
      FULL: '全額收款',
    },
    priceTypeSuffix: {
      PER_PERSON: '／人',
      PER_GROUP: '／團',
    },
    bookingType: {
      INSTANT: '即時確認',
      REQUEST: '需我確認',
      SCHEDULED: '固定團次',
    },
    bookingTypeHint: {
      INSTANT: '旅客下單並付款後直接成立，適合名額充足的固定行程。',
      REQUEST: '旅客送出訂單後由你確認才成立，適合需要先討論細節的包團。',
      SCHEDULED: '旅客只能選你事先開好的團次，適合有固定出團日的行程。',
    },
    review: {
      NONE: '—',
      PENDING: '審核中',
      CHANGES_REQUESTED: '已退回',
      pendingHint: '此方案的異動正在等 Midao 管理者審核，審核期間 Midao 前台仍以原內容販售。',
      changesHint: '管理者要求修改，請調整後重新儲存送審。',
      noteLabel: '管理者說明',
      submitNotice: '方案內容與定價的異動會送 Midao 管理者審核；未上架 Midao 的行程不受影響。',
    },
    seasonSummary: {
      yearRound: '全年',
      count: (n: number) => `${n} 個季節`,
      none: '未設定',
    },
  },

  /* --------------------------------------------------------------- 季節 */
  seasons: {
    sectionTitle: '販售季節',
    sectionHint: '設定這個方案在一年中的哪些期間可以販售，並可為各季節設定不同售價。',
    add: '新增季節',
    empty: '尚未設定季節，目前不會出現在任何日期。',
    fields: {
      nameLabel: '季節名稱',
      namePlaceholder: '例：賞鯨旺季',
      rangeLabel: '販售期間',
      priceLabel: '此季節售價',
      pricePlaceholder: '留空 = 用方案基本價',
    },
    rangeText: (s: string, e: string) => `${s} ～ ${e}`,
    crossYearNote: '結束日期早於開始日期時視為跨年（例：11/01 ～ 02/28）。',
    monthDay: (m: number, d: number) => `${m}/${d}`,
  },

  /* --------------------------------------------------------------- 團次 */
  departures: {
    sectionTitle: '團次與名額',
    sectionHint: '每個團次是一個實際出團的日期與名額。名額售完會自動停止銷售。',
    create: '新增團次',
    batchCreate: '批次開團',
    empty: {
      title: '還沒有團次',
      description: '固定團次型的方案必須先開團次，旅客才能在商店頁與 Midao 下單。',
    },
    columns: {
      date: '出團日期',
      plan: '方案',
      seats: '名額',
      status: '狀態',
      note: '備註',
      actions: '操作',
    },
    fields: {
      planLabel: '方案',
      dateLabel: '出團日期',
      timeLabel: '出發時間',
      capacityLabel: '名額',
      capacityHelp: '調整名額時不可低於已售出的人數。',
      noteLabel: '備註',
      notePlaceholder: '只有你看得到，例：船班已確認',
    },
    batch: {
      title: '批次開團',
      fromLabel: '開始日期',
      toLabel: '結束日期',
      weekdaysLabel: '星期',
      weekdaysHelp: '只在勾選的星期開團。',
      preview: (n: number) => `將建立 ${n} 個團次`,
      confirm: '建立團次',
    },
    seatsText: (booked: number, capacity: number) => `${booked} / ${capacity}`,
    remaining: (n: number) => `剩 ${n} 位`,
    soldOut: '已額滿',
    status: {
      OPEN: '銷售中',
      CLOSED: '已停售',
      CANCELLED: '已取消',
    },
    closeAction: '停止銷售',
    reopenAction: '恢復銷售',
    cancelAction: '取消團次',
    cancelConfirm: '取消團次後，已成立的訂單需要你另行聯繫旅客處理。確定要取消嗎？',
    capacityTooLow: (booked: number) => `名額不可低於已售出的 ${booked} 位`,
  },

  /* --------------------------------------------------------------- 加購 */
  addons: {
    sectionTitle: '加購項目',
    sectionHint: '旅客下單時可以額外勾選的項目，價格會加在訂單金額上。',
    create: '新增加購',
    empty: {
      title: '還沒有加購項目',
      description: '例如保險、器材租借、接送服務，可以讓客單價更高。',
    },
    columns: {
      name: '項目',
      price: '價格',
      unit: '計價',
      stock: '庫存',
      status: '狀態',
      actions: '操作',
    },
    fields: {
      nameLabel: '項目名稱',
      namePlaceholder: '例：專業攝影紀錄',
      priceLabel: '價格',
      unitLabel: '計價方式',
      stockLabel: '庫存',
      stockHelp: '留空代表不限量。',
      activeLabel: '啟用',
    },
    unlimited: '不限量',
  },

  /* ------------------------------------------------------------ 確認 / 訊息 */
  confirm: {
    deleteTitle: '刪除行程',
    delete: (name: string) => `確定要刪除行程「${name}」嗎？已有訂單的行程會改為封存而不是刪除。`,
    deletePlan: (name: string) => `確定要刪除方案「${name}」嗎？`,
    deleteAddon: (name: string) => `確定要刪除加購項目「${name}」嗎？`,
    unpublishTitle: '從商店頁下架',
    unpublish: '下架後旅客無法再從商店頁與 LINE 看到這個行程，已成立的訂單不受影響。',
    requestMidaoTitle: '申請上架 Midao',
    requestMidao: '送出後由 Midao 管理者審核，通過後行程會出現在 Midao 前台。審核期間你的商店頁照常販售。',
  },
  messages: {
    created: '行程已建立',
    updated: '行程已更新',
    deleted: '行程已刪除',
    archived: '行程已封存',
    duplicated: '已複製行程',
    published: '行程已發布到商店頁',
    unpublished: '行程已從商店頁下架',
    midaoRequested: '已送出 Midao 上架申請',
    planSaved: '方案已儲存',
    planSubmitted: '方案已儲存並送出審核',
    planDeleted: '方案已刪除',
    seasonSaved: '季節已儲存',
    seasonDeleted: '季節已刪除',
    departureCreated: '團次已建立',
    departureBatchCreated: (n: number) => `已建立 ${n} 個團次`,
    departureUpdated: '團次已更新',
    departureDeleted: '團次已刪除',
    addonSaved: '加購項目已儲存',
    addonDeleted: '加購項目已刪除',
    slugTaken: '這個網址代稱已被使用',
    needPlan: '請先建立至少一個方案',
    loadFailed: '載入失敗，請稍後再試',
    imported: '行程已匯入',
    importInvalid: 'JSON 檔案格式無效',
    importNotDownloaded: '示範模式未匯入任何資料',
    exported: '行程 JSON 已下載',
    exportNotDownloaded: '示範模式未匯出任何檔案',
    /** 端點回了錯誤訊息就顯示那一句；連訊息都沒有時才用這句 */
    actionFailed: '操作失敗，請稍後再試',
    /**
     * 批次開團的結果一律照實說：跳過的是「同方案同日同時間已有團次」，
     * 把 skipped 併進 created 報成「已建立 N 個」就是在虛報。
     */
    departureBatchPartial: (created: number, skipped: number) =>
      `已建立 ${created} 個團次，${skipped} 個日期已有團次而略過`,
  },
} as const;
