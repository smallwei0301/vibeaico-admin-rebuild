/**
 * 會員等級（/tenant/membership-levels）文案
 * 表格、等級 modal（含折扣／倍率注意事項）與所有 toast 均逐字取自原站 DOM 與 inline JS。
 */
export const membershipLevelsPage = {
  title: '會員等級',
  metaTitle: '會員等級 - 店家後台',
  tableTitle: '等級列表',

  /* ------------------------------------------------------------ 頁面提示 */
  helpTip: {
    prefix: '提示：',
    text: '設定不同會員等級，依消費金額自動升級，並給予專屬折扣與優惠。',
  },

  /** 未訂閱「會員系統」時的警語 */
  featureWarning: {
    lead: '未訂閱時',
    strong: '顧客預約仍會被收原價、集點也不會加倍',
    tail: '——等級可以設定並保存，但折扣與倍率完全不會套用。',
  },

  /* --------------------------------------------------------------- 動作 */
  actions: {
    create: '新增等級',
    edit: '編輯會員等級',
    delete: '刪除',
  },

  /* --------------------------------------------------------------- 表格 */
  columns: {
    sortOrder: '排序',
    name: '等級名稱',
    threshold: '升級門檻',
    discount: '折扣 (%)',
    pointMultiplier: '點數倍率',
    status: '狀態',
    actions: '操作',
  },

  labels: {
    default: '預設',
    active: '啟用',
    inactive: '停用',
    customerCount: (n: number) => `${n} 位顧客`,
    multiplier: (n: number) => `${n} 倍`,
  },

  /* -------------------------------------------------------- 等級 modal */
  form: {
    createTitle: '新增會員等級',
    editTitle: '編輯會員等級',
    name: '等級名稱 *',
    nameLabel: '等級名稱',
    namePlaceholder: '例：銀卡會員',
    nameInvalid: '請輸入等級名稱',
    threshold: '升級門檻 (累計消費金額)',
    thresholdPrefix: 'NT$',
    thresholdHelp: '顧客累計消費達此金額自動升級',
    discount: '折扣比例 (%)',
    discountHelp: '0 表示無折扣；填 10 = 該等級顧客預約一律 9 折 （建立當下套用）',
    pointMultiplier: '點數倍率',
    pointMultiplierHelp: '1 = 正常，2 = 雙倍點數（預約完成自動集點）',
    color: '等級顏色',
    colorHelp: '顯示在顧客列表的等級標籤上',
    description: '等級說明',
    descriptionPlaceholder: '此等級的專屬權益說明',
    sortOrder: '排序',
    sortOrderHelp: '數字越小排越前面',
    isActive: '啟用此等級',
    isDefault: '設為預設等級（新顧客自動套用）',
    notice: {
      scopeLead: '折扣與倍率',
      scopeStrong: '僅適用預約',
      scopeTail: '（不含商品訂單／POS）。',
      stackLead: '會員折扣與票券折扣會',
      stackStrong: '疊加（折上折）',
      stackTail: '：例如 9 折會員再用 9 折券 = 81 折，發券前請評估利潤。',
      effectLead: '設定變更只影響',
      effectStrong: '之後新建立',
      effectTail: '的預約，已建立預約的金額不會變動。',
    },
  },

  /* --------------------------------------------------------------- 確認 */
  confirm: {
    deleteTitle: '刪除',
    delete: '確定要刪除此會員等級嗎？',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    created: '新增成功',
    updated: '更新成功',
    deleted: '刪除成功',
    saveFailedPrefix: '儲存失敗：',
    loadFailed: '載入失敗，請重新整理',
    unknownError: '未知錯誤',
    retryLater: '請稍後再試',
    connectionError: '連線錯誤，請稍後再試',
  },

  empty: {
    title: '還沒有會員等級',
    description: '建立第一個等級後，顧客的累計消費達到門檻就會自動升級並套用折扣與點數倍率。',
  },
} as const;
