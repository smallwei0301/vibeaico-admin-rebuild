/**
 * 作品展示（/tenant/portfolio）文案
 * -----------------------------------------------------------------------------
 * 逐字取自原站 docs/specs/portfolio.json：統計卡、雙排序模式說明卡、
 * portfolioModal 的所有欄位／help、空狀態與 60 餘條 inline JS 訊息。
 * 本功能屬功能商店的 PORTFOLIO_SHOWCASE，未訂閱時無法新增或修改作品。
 */
export const portfolioPage = {
  title: '作品展示',
  metaTitle: '作品展示 - 店家後台',
  subtitle: '管理公開頁與 LINE 上展示的作品',

  /* --------------------------------------------------------------- 統計 */
  stats: {
    total: '作品數量',
    active: '啟用中',
    inactive: '停用中',
  },

  /* --------------------------------------------------------- 排序模式卡 */
  sort: {
    modeLabel: '排序模式：',
    lineMode: 'LINE 顯示順序',
    publicMode: '公開頁順序',
    syncToPublic: '套用此順序到公開頁',
    syncToLine: '套用此順序到 LINE',
    /** 兩個排序互不影響的說明（原站以 <strong> 斷句） */
    introLead: '兩個排序',
    introStrong: '互不影響',
    introTail: '，分別調整',
    lineHintLead: 'LINE 作品瀏覽',
    lineHintStrong: '最多顯示 11 件',
    lineHintTail: '（第 12 格放「看全部」連結）。',
    lineHintToggle: '右上角',
    lineHintToggleStrong: '切換',
    lineHintToggleTail: 'LINE 顯示；拖曳卡片調整',
    lineHintOrderStrong: 'LINE 顯示順序',
    lineFeaturedCount: (n: number) => `目前 LINE 精選：${n} 件`,
    lineOverLimit: '⚠ 超過 11 件，LINE 只會顯示前 11 件',
    lineMaxFeatured: 11,
    publicHintLead: '公開頁順序',
    publicHintMiddle: '影響顧客在 /shop 作品 Tab 看到的排序。拖曳卡片調整',
    publicHintStrong: '公開頁順序',
    publicHintTail: '。',
    /** 套用排序前的確認：${fromLabel} → ${toMode} */
    syncConfirm: (fromLabel: string, toMode: string) =>
      `將目前的「${fromLabel}」套用到 ${toMode} 排序？\n\n會覆蓋現有 ${toMode} 排序。`,
    syncDone: (toMode: string) => `已套用到${toMode}排序`,
    lineOrderUpdated: 'LINE 順序已更新',
    publicOrderUpdated: '公開頁順序已更新',
    publicLabel: '公開頁',
  },

  /* --------------------------------------------------------------- 動作 */
  actions: {
    create: '新增作品',
    edit: '編輯作品',
    delete: '刪除',
    enable: '啟用',
    disable: '停用',
    lineShown: '在 LINE 顯示中（點擊隱藏）',
    lineHidden: '已從 LINE 隱藏（點擊顯示）',
  },

  labels: {
    active: '啟用中',
    inactive: '已停用',
    noDescription: '無描述',
    /** `${n} 張` —— 作品的額外圖片張數 */
    imageCountSuffix: ' 張',
    lineShown: '已在 LINE 顯示',
    lineHiddenBadge: '已從 LINE 隱藏',
  },

  /* --------------------------------------------------- modal：新增/編輯 */
  form: {
    createTitle: '新增作品',
    editTitle: '編輯作品',
    titleLabel: '標題',
    titlePlaceholder: '請輸入標題',
    description: '描述',
    coverImage: '作品主圖',
    coverImageHelp: '支援 JPG、PNG，最大 2MB，寬度超過 800px 會自動縮小',
    extraImages: '其他圖片（選填，最多 8 張）',
    extraImagesHelp: '可一次選多張，讓作品展示更豐富',
    extraImagesMax: 8,
    sortOrder: '排序',
    sortOrderHelp: '數字越小排越前面',
    enabled: '啟用',
  },

  /* ---------------------------------------------------------- 功能訂閱 */
  feature: {
    lockedHtmlLead: '未訂閱時',
    lockedStrong: '無法新增或修改作品',
    lockedTail: '，公開頁與 LINE 的作品展示入口也不會出現。',
    goToStore: '前往功能商店訂閱 →',
    limitReachedPrefix: '已達上限 ',
  },

  /* --------------------------------------------------------------- 確認 */
  confirm: {
    deleteTitle: '刪除作品',
    delete: '確定要刪除此作品嗎？此操作無法復原。',
    toggleTitle: '變更狀態',
    toggle: (action: string) => `確定要${action}此作品嗎？`,
    syncTitle: '套用排序',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    created: '作品已新增',
    updated: '作品已更新',
    deleted: '作品已刪除',
    toggled: (action: string) => `已${action}`,
    lineShown: '已在 LINE 顯示',
    lineHidden: '已從 LINE 隱藏',
    saveFailed: '儲存失敗',
    saveFailedPrefix: '儲存作品失敗：',
    deleteFailed: '刪除失敗',
    deleteWorkFailed: '刪除作品失敗',
    toggleFailed: '切換失敗',
    toggleFailedPrefix: '切換失敗：',
    syncFailed: '同步失敗',
    syncFailedPrefix: '同步失敗：',
    reorderFailed: '排序失敗，重新整理後恢復',
    operationFailed: '操作失敗',
    notFound: '找不到該作品',
    titleRequired: '請輸入標題',
    coverImageRequired: '新增作品前請先上傳作品主圖',
    imageTooLarge: '圖片大小不能超過 2MB',
    imageTooLargePrefix: '超過 2MB：',
    imageUnreadablePrefix: '無法讀取（可能是 HEIC 格式，請改存成 JPG/PNG），已略過：',
    imageReadFailedPrefix: '讀取失敗，已略過：',
    loadFailed: '載入失敗',
    loadFailedRefresh: '載入失敗，請重新整理',
    loadPortfolioFailed: '載入作品失敗',
    loadPortfolioDataFailed: '載入作品資料失敗',
    networkError: '網路錯誤',
    retryLater: '請稍後再試',
    connectionError: '連線錯誤，請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '尚未建立任何作品，點擊「新增作品」開始吧',
    description: '作品會顯示在公開預約頁的作品 Tab，以及 LINE 的作品瀏覽選單。',
    notAdded: (max: number) => `尚未新增（0 / ${max}）`,
  },
} as const;
