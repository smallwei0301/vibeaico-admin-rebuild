import { nav } from '@/i18n/zh-TW/nav';
import { tourOrdersPage } from '@/i18n/zh-TW/pages/tour-orders';

/**
 * 營運報表（/tenant/reports）文案
 * 內容依 docs/specs/reports.json 的 headings / cards / statCards / tables /
 * buttons / emptyStates / jsStrings 逐字收錄，措辭與原站一致。
 */
export const reportsPage = {
  title: '營運報表',
  metaTitle: '營運報表 - 店家後台',
  eyebrow: nav.navBooking,

  /* ----------------------------------------------------- GUIDE 導遊營運報表 */
  guideReport: {
    eyebrow: '行程營運',
    rangeLabel: '日期區間',
    apply: '套用',
    loading: '載入中…',
    from: '開始日期',
    to: '結束日期',
    presets: { last7: '近 7 天', last30: '近 30 天', last90: '近 90 天' },
    compareLine: (prevFrom: string, prevTo: string) => `與上一期（${prevFrom} ～ ${prevTo}）比較`,
    asOfLine: (at: string) => `資料截至 ${at}`,
    timeZoneLine: (zone: string) => `日期界線採店家時區：${zone}`,
    noData: '尚無足夠資料',
    truncatedWarning: '資料筆數超過上限，數字可能不完整，請縮短日期區間後重新查詢。',
    truncatedHint: '數字可能不完整',
    sep: '　',
    reasonPrefix: '：',
    noDataPrevious: '上一期無資料可比較',
    emptyTitle: '這段期間沒有旅遊訂單',
    emptyDescription: '換一個日期區間，或先到旅遊訂單建立訂單；沒有訂單時不會顯示任何推算數字。',
    emptyAction: '前往旅遊訂單',
    unit: { orders: '筆', people: '人' },
    change: {
      up: (pct: string) => `較上一期增加 ${pct}`,
      down: (pct: string) => `較上一期減少 ${pct}`,
      flat: '與上一期持平',
      previousValue: (v: string) => `上一期：${v}`,
      pointsUp: (pts: string) => `較上一期上升 ${pts} 個百分點`,
      pointsDown: (pts: string) => `較上一期下降 ${pts} 個百分點`,
    },
    cards: {
      orders: '旅遊訂單數',
      revenue: '實收營收',
      avgOrderValue: '平均客單',
      cancelled: '取消率',
    },
    cardHints: {
      revenueRefunded: (amount: string) => `已退款 ${amount}（已自實收扣除）`,
      refundPending: (n: number) => `另有 ${n} 筆退款處理中（尚未退出，仍計入實收）`,
      cancelledCount: (n: number, total: number) => `已取消 ${n} 筆，共 ${total} 筆訂單`,
      avgBasis: (n: number) => `分母：非取消且實收大於 0 的 ${n} 筆訂單`,
    },
    sourceCard: {
      title: '訂單來源',
      description: '非取消訂單依來源分列訂單數與實收營收；點選來源可查看該期間該來源的訂單；清單同樣不含已取消訂單，筆數與此處一致。',
      // 來源名稱與旅遊訂單頁共用同一份文案，兩頁不會對不上
      names: { ...tourOrdersPage.source, OTHER: '其他' },
      line: (orders: number, revenue: string) => `${orders} 筆　${revenue}`,
      previous: (orders: number) => `上一期：${orders} 筆`,
      viewSourceOrders: (name: string) => `查看來源「${name}」的訂單`,
    },
    repeatCard: {
      title: '重複旅客',
      customers: '本期旅客數',
      repeatCustomers: '重複旅客數',
      rate: '重複率',
      viewOrders: (n: number) => `查看重複旅客本期的訂單（${n} 筆，不含已取消）`,
      unlinked: (n: number) => `未綁定旅客的訂單 ${n} 筆（不計入旅客數與重複率）`,
    },
    drilldown: { viewOrders: '查看訂單', viewTripOrders: (name: string) => `查看「${name}」的訂單` },
    statusBreakdownTitle: '各狀態訂單數',
    status: {
      PENDING: '待確認',
      CONFIRMED: '已確認',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
    },
    ranking: {
      title: '熱門行程與方案',
      dimension: { trip: '依行程', plan: '依方案' },
      metric: { orders: '依訂單數', people: '依人數', revenue: '依實收營收' },
      columns: { rank: '名次', name: '名稱', orders: '訂單數', people: '人數', revenue: '實收營收' },
      empty: '這段期間沒有可排序的資料',
      linkNote: '連結說明：名稱與「訂單數」「人數」欄的連結列出不含已取消的訂單，筆數與表內一致；「實收營收」欄的連結含已取消訂單（已收款項仍計入實收），所以筆數可能多於訂單數。',
      cellTitles: {
        orders: (name: string) => `查看「${name}」的訂單（不含已取消）`,
        people: (name: string) => `查看「${name}」人數所屬的訂單（不含已取消）`,
        revenue: (name: string) => `查看「${name}」實收營收所屬的訂單（含已取消訂單的已收款）`,
      },
      tieRule: '同分時依名稱排序，再依編號排序，結果每次相同。',
    },
    defs: {
      title: '指標定義',
      scope: '期間歸屬：以訂單「建立時間」落在所選日期（店家時區）內為準，含結束當天。',
      orders: '旅遊訂單數：期間內建立的旅遊訂單，依待確認、已確認、已完成、已取消分開計數。',
      revenue:
        '實收營收：已實際收到的金額加總，扣掉已退款金額。部分付款只算已收的部分，未收尾款不算；退款處理中尚未退出，仍算在內並另行提示。',
      avgOrderValue:
        '平均客單：非取消訂單的實收金額 ÷ 非取消且有實收的訂單數（已取消訂單，含退款處理中，分子分母皆不計）；分母為 0 時顯示「尚無足夠資料」，不以 0 代替。',
      cancelled:
        '取消率：已取消訂單數 ÷ 該期訂單總數（含已取消），四捨五入到小數點後 1 位；沒有訂單時顯示「尚無足夠資料」。與上一期的比較以「百分點」表示（本期取消率減上一期取消率）。目前資料沒有記錄取消是旅客、導遊或系統逾期造成，所以只顯示總取消率，不拆分原因。',
      ranking:
        '熱門排行：訂單數與人數不含已取消訂單；實收營收用上方同一口徑。三種排序分開呈現，指標為 0 的項目不列入，最多顯示 10 名。',
      source:
        '訂單來源：非取消訂單依下單來源（Midao 前台、商店頁、LINE、手動建立）分列訂單數與實收營收，四個來源皆列出（0 為實際筆數）；來源不在已知清單者歸「其他」。',
      repeat:
        '重複旅客：本期有非取消訂單、且已綁定旅客的人（同一旅客只算一次）中，本期內有 2 筆以上非取消訂單，或本期開始之前（任何時間）已有非取消訂單者。重複率＝重複旅客數 ÷ 本期旅客數，無旅客時顯示「尚無足夠資料」。未綁定旅客的訂單不計入，另行列出筆數。',
      comparison: '上一期：與所選期間天數相同、緊接在前的期間；上一期為 0 時不計算增減百分比。',
    },
    notEnabled: {
      title: '尚未啟用的指標',
      description: '以下指標需要資料模型支援，目前不顯示數字，避免用 0 或示範值冒充已計算。',
      items: [
        { name: '取消原因（旅客／導遊／系統逾期）', reason: '訂單目前沒有取消來源欄位，只有自由文字理由。' },
        { name: '未付款率', reason: '尚未記錄「進入付款階段」的時間點，分母無法可靠算出。' },
        { name: '成團表現', reason: '尚未彙整公開團次與成團狀態快照。' },
        { name: '導遊與加購業績', reason: '需使用完成時凍結的業績快照，尚未接入報表。' },
        { name: '詢問到成交', reason: '尚未啟用詢問追蹤，沒有可靠的詢問事件，不顯示成交率。' },
      ],
    },
    forbidden: { title: '需要店長或管理者權限', description: '營運報表包含營收數字，僅店長或管理者可查看。請聯絡店家管理者開通權限。' },
    errors: { loadFailed: '載入 GUIDE 報表失敗，請稍後再試', loadFailedHint: '可能是暫時性的網路或伺服器問題，按下重試即可重新載入，不需要整頁重新整理。', retry: '重試', invalidRange: '結束日期不可早於開始日期', futureDate: '日期不可晚於今天（店家時區）' },
  },

  /* ------------------------------------------------------------ 日期區間 */
  range: {
    week: '本週',
    month: '本月',
    quarter: '本季',
  },

  /* -------------------------------------------------------------- 匯出 */
  export: {
    label: '匯出',
    excel: '匯出 Excel',
    csv: '匯出 CSV',
    /* issue #246：移除 fileName(date, ext)。它讓頁面自己拼一個與實際下載檔案
       無關的名字，是 14-GAP-AUDIT §7 判準要抓的「捏造檔名」。檔名一律由後端
       Content-Disposition 提供，前端只負責顯示。 */
    success: '報表匯出成功',
    successAs: (fileName: string) => `報表匯出成功：${fileName}`,
    failed: '匯出失敗，請稍後再試',
    failedPrefix: '匯出失敗:',
  },

  /* ------------------------------------------------------------ 營運總覽 */
  summary: {
    totalBookings: '總預約數',
    totalRevenue: '總營收',
    completionRate: '完成率',
    completionRateHint: '完成/總數',
    newCustomers: '新客戶',
  },

  /* -------------------------------------------------------------- 圖表 */
  dailyTrend: {
    title: '每日預約與營收趨勢',
    bookingCount: '預約數',
    revenue: '營收',
    revenueAxis: '營收 (NT$)',
  },

  serviceDistribution: {
    title: '熱門服務分布',
    empty: '暫無資料',
  },

  /* ------------------------------------------------------------ 排行表格 */
  topServices: {
    title: '熱門服務 TOP 5',
    columns: {
      rank: '排名',
      name: '服務名稱',
      bookings: '預約數',
      revenue: '營收',
    },
    empty: '暫無資料',
  },

  topStaff: {
    title: '員工業績 TOP 5',
    columns: {
      rank: '排名',
      name: '員工姓名',
      services: '服務數',
      revenue: '營收',
    },
    empty: '暫無資料',
  },

  topProducts: {
    title: '熱門商品 TOP 10',
    note: '僅計算已完成訂單',
    columns: {
      rank: '排名',
      name: '商品名稱',
      quantity: '銷售數量',
      revenue: '營收',
      share: '佔比',
    },
    empty: '此期間無已完成商品訂單',
  },

  /* ------------------------------------------------------------ 時段分析 */
  hourly: {
    title: '預約時段分布',
    empty: '暫無資料',
    peak: '尖峰',
    tooltip: (hourLabel: string, count: number) => `${hourLabel}: ${count} 筆預約`,
  },

  /* ------------------------------------------------------------ 進階報表 */
  advanced: {
    retentionRate: '顧客保留率',
    retentionRateHint: '活躍顧客 / 總顧客',
    activeCustomers: '活躍顧客數',
    activeCustomersHint: '期間內有預約的顧客',
    avgVisitCycle: '平均來客週期',
    avgVisitCycleUnit: '天',
    avgCustomerValue: '平均顧客價值',
    avgCustomerValueHint: '完成預約 / 活躍顧客',
    serviceTrends: {
      title: '服務趨勢分析',
      columns: {
        name: '服務名稱',
        bookings: '當期預約數',
        growth: '成長率',
      },
      flat: '持平',
      empty: '暫無服務趨勢資料',
    },
    locked: {
      title: '解鎖進階報表分析',
      body: '訂閱進階報表功能，獲取顧客保留率、活躍顧客分析、服務趨勢等深度數據',
      action: '前往功能商店',
    },
  },

  /* ------------------------------------------------------------ 載入失敗 */
  errors: {
    summary: '載入報表摘要失敗:',
    daily: '載入每日趨勢失敗:',
    topServices: '載入熱門服務失敗:',
    topStaff: '載入員工業績失敗:',
    topProducts: '載入熱門商品失敗:',
    hourly: '載入時段分布失敗:',
    advanced: '載入進階報表失敗:',
    advancedSubscription: '檢查進階報表訂閱失敗:',
    loadFailed: '載入失敗',
    loadFailedRetry: '載入失敗，請重新整理',
  },
} as const;
