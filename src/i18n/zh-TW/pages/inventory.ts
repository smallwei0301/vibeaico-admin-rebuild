/**
 * 庫存異動（/tenant/inventory）文案
 * 表格欄位、異動類型徽章、功能鎖提示與所有 toast 均逐字取自原站 DOM 與 inline JS。
 */
export const inventoryPage = {
  title: '庫存異動歷史',
  metaTitle: '庫存異動 - 店家後台',
  tableTitle: '異動記錄',

  /* ------------------------------------------------------------------ 表格 */
  columns: {
    time: '時間',
    product: '商品',
    type: '異動類型',
    quantity: '數量',
    before: '異動前',
    after: '異動後',
    reason: '原因',
    operator: '操作者',
  },

  /* -------------------------------------------------------------- 異動類型 */
  types: {
    PURCHASE_IN: '進貨入庫',
    SALE_OUT: '銷售出庫',
    STOCKTAKE: '盤點調整',
    MANUAL: '手動調整',
    DAMAGE: '損耗報廢',
    RETURN_IN: '退貨入庫',
    ORDER_CANCELLED: '訂單取消',
  },

  /* ---------------------------------------------------- 功能訂閱提示（鎖） */
  feature: {
    title: '庫存管理',
    lead: '未訂閱時',
    strong: '看不到庫存異動記錄、也不能調整庫存',
    tail: '（本頁的「載入失敗」就是因為這個，不是系統故障）。',
    learnMore: '了解',
  },

  /* ------------------------------------------------------------------ 篩選 */
  filter: {
    typeLabel: '異動類型：',
    typeAll: '全部',
    productLabel: '商品：',
    productAll: '全部',
  },

  /* ------------------------------------------------------------------ 動作 */
  actions: {
    /**
     * 原站沒有庫存匯出端點（`docs/specs/inventory.json` 的 jsApiCalls 只有
     * /api/inventory/logs），這一支是 issue #28 ⑤ 新增的，依擁有者裁決同時提供
     * CSV 與 Excel 兩個選項（格式在確認視窗裡選，所以按鈕不再寫死 CSV）。
     */
    export: '匯出',
    exporting: '匯出中…',
    /**
     * 兩個選項產出的都是 UTF-8 加 BOM 的 CSV（專案沒有 xlsx 產生器，把 CSV
     * 命名成 .xlsx 就是謊報檔案格式）——標籤照 reports 頁的作法寫明實際格式。
     */
    exportExcelCsv: '匯出 Excel 可開啟的 CSV',
    exportCsv: '匯出 CSV',
  },

  confirm: {
    exportTitle: '匯出異動記錄',
    export: '確定要匯出目前篩選的異動記錄嗎？',
    formatLabel: '格式：',
  },

  /* ------------------------------------------------------------------ 訊息 */
  messages: {
    exported: '異動記錄匯出成功',
    /**
     * 檔名一律取自伺服器回的 `Content-Disposition`（issue #28 ⑤）。原本這裡
     * 搭配的是 `exportFile.filename()`——前端用當天日期拼出「庫存異動_20260825.csv」
     * 再報成功，既沒有端點也沒有檔案。該函式已刪除。
     */
    exportedAs: (fileName: string) => `異動記錄匯出成功：${fileName}`,
    /** 示範資料模式沒有伺服器可打，沒有檔案產生——不得顯示成功 */
    exportNotDownloaded: '示範資料模式不會產生檔案，未匯出任何異動記錄；請切換到實際店家後再匯出',
    exportFailedPrefix: '匯出失敗:',
    loadLogsFailed: '載入異動記錄失敗:',
    loadFailed: '載入失敗',
    connectionError: '連線錯誤，請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '暫無異動記錄',
    description: '進貨、銷售、盤點或手動調整庫存後，異動會逐筆記錄在這裡。',
  },

  labels: {
    totalCount: (n: number) => `共 ${n} 筆資料`,
    system: '系統',
  },
} as const;
