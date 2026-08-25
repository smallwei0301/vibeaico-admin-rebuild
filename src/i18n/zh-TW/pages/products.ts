/**
 * 商品管理（/tenant/products）文案
 * 使用小提醒卡、篩選／排序列、表格、4 個 modal 與所有 toast／確認訊息
 * 均逐字取自原站 DOM 與 inline JS。
 */
export const productsPage = {
  title: '商品管理',
  metaTitle: '商品管理 - 店家後台',
  tableTitle: '商品列表',

  /* ---------------------------------------------------------- 使用小提醒卡 */
  tips: {
    title: '使用小提醒',
    items: [
      {
        term: 'LINE 精選',
        text: '：點星星控制商品是否在 LINE 顯示（黃色＝顯示），LINE 最多顯示 11 件，多的請關掉。',
      },
      {
        term: '拖曳排序',
        text: '：拖住左側圖示上下移動，放開自動儲存。LINE 和公開頁各自獨立排序。',
      },
      {
        term: '套用順序',
        text: '：排好一邊後，一鍵複製到另一邊（省得排兩次）。',
      },
      {
        term: '上架/下架',
        text: '：控制商品在公開頁面是否可見，下架後顧客看不到。',
      },
    ],
  },

  /* -------------------------------------------------- 功能訂閱提示（功能鎖） */
  feature: {
    productSales: '商品銷售',
    productSalesLead: '未訂閱時',
    productSalesStrong: '無法新增/修改商品，也無法上架',
    productSalesTail: '，公開頁與 LINE 的商品入口不會出現。既有商品資料會保留。',
    inventory: '庫存管理',
    inventoryLead: '庫存管理是',
    inventoryStrong: '獨立於「商品銷售」的另一個功能',
    inventoryTail: '。未訂閱時無法調整庫存、也看不到庫存異動記錄。',
    learnMore: '了解',
  },

  /* ------------------------------------------------------- 篩選 / 排序工具列 */
  toolbar: {
    filterLabel: '篩選分類：',
    filterAll: '全部',
    filterCount: (n: number) => `${n}`,
    uncategorized: '未分類',
    sortModeLabel: '排序模式：',
    sortModeLine: 'LINE 顯示順序',
    sortModePublic: '公開頁順序',
    lineLabel: 'LINE 顯示順序',
    publicLabel: '公開頁順序',
    lineShort: 'LINE',
    publicShort: '公開頁',
    syncToPublic: '套用此順序到公開頁',
    syncToLine: '套用此順序到 LINE',
    lineFeaturedLead: '目前 LINE 精選：',
    lineFeaturedCount: (n: number) => `${n} 件`,
    lineFeaturedMax: '（最多顯示 11 件）',
    lineFeaturedOver: '⚠ 超過 11 件，請點星星關掉不需要的',
    publicOrderHint: '此排序影響顧客在公開頁商品 Tab 看到的順序',
    totalCount: (n: number) => `共 ${n} 筆資料`,
  },

  /* ------------------------------------------------------------------- 表格 */
  columns: {
    name: '商品名稱',
    category: '分類',
    price: '售價',
    stock: '庫存',
    status: '狀態',
    line: 'LINE',
    actions: '操作',
  },

  labels: {
    moveUp: '上移',
    moveDown: '下移',
    active: '上架中',
    soldOut: '售完',
    inactive: '已下架',
    draft: '草稿',
    enabled: '啟用',
    disabled: '停用',
    notTracked: '不追蹤',
    stockUntracked: '未追蹤',
    notSet: '未設定',
    lineShown: '在 LINE 顯示中（點擊隱藏）',
    lineHidden: '已從 LINE 隱藏（點擊顯示）',
    clickPublish: '點擊上架',
    clickUnpublish: '點擊下架',
    safetyStock: '安全庫存',
    remove: '移除',
  },

  /* ------------------------------------------------------------------- 動作 */
  actions: {
    lowStock: (n: number) => `低庫存 ${n}`,
    manageCategory: '管理分類',
    create: '新增商品',
    edit: '編輯商品',
    delete: '刪除商品',
    adjustStock: '調整庫存',
    publish: '上架',
    unpublish: '下架',
  },

  /* ------------------------------------------------ modal 1：新增 / 編輯商品 */
  form: {
    createTitle: '新增商品',
    editTitle: '編輯商品',
    name: '商品名稱',
    namePlaceholder: '請輸入商品名稱',
    nameInvalid: '請輸入商品名稱',
    category: '分類',
    categoryManage: '管理分類',
    categoryPlaceholder: '請選擇分類',
    categoryInvalid: '請選擇商品分類',
    categoryHelp: '分類由店家自訂，可依行業特性自由建立（如：咖啡豆、毛巾、周邊商品）',
    price: '售價',
    priceUnit: 'NT$',
    priceInvalid: '請輸入有效的價格',
    stockQuantity: '庫存數量',
    stockQuantityHelp: '不填則不追蹤庫存',
    safetyStock: '安全庫存量',
    safetyStockPlaceholder: '低於此數量會提醒',
    safetyStockHelp: '庫存低於此數量會顯示警示',
    trackInventoryTitle: '是否追蹤庫存',
    trackInventory: '啟用庫存追蹤',
    maxPerOrder: '單次最多購買數量',
    maxPerOrderPlaceholder: '留空不限，以庫存為上限',
    maxPerOrderHelp: '每個顧客單筆訂單的上限（例：限購 5 件）',
    sortOrder: '排序（公開頁面顯示順序）',
    sortOrderHelp: '數字越小越前面（例：0 最前面），相同時依名稱排序',
    mainImage: '主圖（第一張，必填）',
    mainImageRemove: '移除主圖',
    mainImageHelp: '支援 JPG / PNG，建議尺寸 800x800，最大 2MB',
    extraImages: '其他圖片（選填，最多 8 張）',
    extraImagesHelp: '可一次選多張，用於商品細節/不同角度展示',
    extraImagesEmpty: (used: number, max: number) => `尚未新增其他圖片（已有 ${used} / ${max} 張）`,
    extraImagesCount: (used: number, max: number) => `已有 ${used} / ${max} 張`,
    description: '商品描述',
    limitReachedPrefix: '已達上限 ',
    limitReachedSuffix: ' 張，請先移除再新增',
    imageTooLarge: '圖片大小不可超過 2MB',
    imageOversizeSkipped: ' 超過 2MB，跳過',
    imageUnreadable: ' 無法讀取（可能是 HEIC 格式，請改存成 JPG/PNG），已略過',
    imageReadFailed: ' 讀取失敗，已略過',
  },

  /* ------------------------------------------------------ modal 2：調整庫存 */
  stock: {
    title: '調整庫存',
    productName: '商品名稱',
    currentStock: '目前庫存',
    safetyStock: '安全庫存',
    belowSafety: '目前庫存低於安全庫存',
    adjustQty: '調整數量',
    quickMinus10: '-10',
    quickMinus1: '-1',
    quickPlus1: '+1',
    quickPlus10: '+10',
    afterAdjust: '調整後庫存：',
    afterAdjustEmpty: '-',
    reason: '調整原因',
    reasonPlaceholder: '請選擇原因',
    reasonOptions: [
      { value: '進貨補充', label: '進貨補充' },
      { value: '銷售出貨', label: '銷售出貨' },
      { value: '盤點調整', label: '盤點調整' },
      { value: '損耗報廢', label: '損耗報廢' },
      { value: '退貨入庫', label: '退貨入庫' },
      { value: '其他', label: '其他' },
    ],
    otherReason: '其他原因',
    otherReasonPlaceholder: '請輸入原因',
    otherValue: '其他',
    submit: '確認調整',
    submitting: '處理中...',
    qtyInvalid: '請輸入有效的調整數量',
    negativeStock: '調整後庫存不能為負數',
    success: (delta: string, stock: number) => `庫存調整成功！${delta}，目前庫存：${stock}`,
    adjustFailedPrefix: '調整失敗: ',
    adjustStockFailed: '調整庫存失敗:',
  },

  /* -------------------------------------------------- modal 3：商品分類管理 */
  category: {
    title: '商品分類管理',
    intro: '依行業自由建立分類（如咖啡豆/器具/書籍/寵物用品等），最多 50 個。',
    name: '分類名稱',
    namePlaceholder: '例：熱門商品',
    nameRequired: '請填寫分類名稱',
    sortOrder: '排序',
    active: '啟用',
    create: '新增',
    clear: '清除',
    dragHint: '拖曳左側圖示可調整分類順序',

    /* -------------------------------------------------- 編輯分類（issue #28 ⑭）
     * 先前這一列的「編輯」是鉛筆圖示 + common.edit 標籤，按下去卻只切換啟用狀態
     * ——圖示與行為不符。依擁有者方針「對齊原站功能，缺少功能用補齊取代刪除」，
     * 補成真正的編輯 modal（名稱／說明／啟用三欄），快速切換另外給自己的圖示與標籤。
     * 排序刻意不放進 modal：排序走 reorder 端點，兩條寫入路徑會打架。 */
    editTitle: '編輯分類',
    description: '說明',
    descriptionPlaceholder: '選填',
    editActive: '啟用此分類',
    editActiveHelp: '停用後顧客端不會看到這個分類，底下的商品不會被刪除',
    /** 快速切換鈕的 tooltip：依目前狀態顯示按下去會發生什麼事 */
    enableAction: '啟用分類',
    disableAction: '停用分類',
    /** 什麼都沒改就按儲存：沒有送出任何請求，所以不能報「已更新」 */
    noChange: '沒有變更任何欄位，未送出更新',
    columns: {
      name: '名稱',
      description: '說明',
      status: '狀態',
      actions: '操作',
    },
    empty: '尚無分類',
    deleteConfirm: '確定刪除此分類？（若還有商品使用會拒絕刪除）',
    created: '分類已新增',
    updated: '分類已更新',
    deleted: '分類已刪除',
    reordered: '分類順序已更新',
    max: 50,
  },

  /* --------------------------------------------------- modal 4：各種確認彈窗 */
  confirm: {
    deleteTitle: '刪除商品',
    delete: '確定要刪除此商品嗎？',
    toggleTitle: '上架 / 下架',
    toggle: (actionText: string) => `確定要將此商品${actionText}嗎？`,
    syncOrder: (fromLabel: string, toMode: string) =>
      `將目前的「${fromLabel}」套用到 ${toMode} 排序？會覆蓋現有 ${toMode} 排序。`,
  },

  /* ------------------------------------------------------------------- 訊息 */
  messages: {
    created: '商品建立成功',
    updated: '商品更新成功',
    deleted: '商品已刪除',
    toggled: (actionText: string) => `商品已${actionText}`,
    lineShown: '已在 LINE 顯示',
    lineHidden: '已從 LINE 隱藏',
    lineOrderUpdated: 'LINE 順序已更新',
    publicOrderUpdated: '公開頁順序已更新',
    orderApplied: (toMode: string) => `已套用到${toMode}排序`,
    checkFields: '請檢查標示紅色的欄位（名稱、分類、價格等）',
    saveFailed: '儲存失敗',
    saveFailedPrefix: '儲存失敗: ',
    saveProductFailed: '儲存商品失敗:',
    deleteFailed: '刪除失敗',
    deleteFailedPrefix: '刪除失敗：',
    deleteProductFailed: '刪除商品失敗:',
    toggleFailed: '切換失敗',
    toggleFailedPrefix: '切換失敗：',
    syncFailed: '同步失敗',
    syncFailedPrefix: '同步失敗：',
    sortFailed: '排序失敗',
    actionFailedPrefix: (actionText: string) => `${actionText}失敗: `,
    actionProductFailed: (actionText: string) => `${actionText}商品失敗:`,
    loadProductsFailed: '載入商品失敗:',
    loadDetailFailed: '載入商品詳情失敗',
    loadDetailFailedPrefix: '載入商品詳情失敗:',
    loadFailed: '載入失敗',
    networkError: '網路錯誤',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '還沒有商品',
    description: '建立第一件商品後，顧客就能在公開頁與 LINE 看到並下單。',
  },

  lowStock: {
    title: '低庫存商品',
    description: '目前沒有低於安全庫存的商品。',
  },
} as const;
