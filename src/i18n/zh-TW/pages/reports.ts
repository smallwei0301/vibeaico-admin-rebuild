import { nav } from '@/i18n/zh-TW/nav';

/**
 * 營運報表（/tenant/reports）文案
 * 內容依 docs/specs/reports.json 的 headings / cards / statCards / tables /
 * buttons / emptyStates / jsStrings 逐字收錄，措辭與原站一致。
 */
export const reportsPage = {
  title: '營運報表',
  metaTitle: '營運報表 - 店家後台',
  eyebrow: nav.navBooking,

  /* -------------------------------------------------------- GUIDE 報表狀態 */
  guideUnavailable: {
    eyebrow: '行程營運',
    title: 'GUIDE 專屬報表尚未建置',
    description:
      '目前不顯示通用店家報表，避免把示範或非旅遊領域的數字當成旅遊營運結果。待團次、訂單、付款與來源的旅遊口徑完成後，這裡會提供可追溯的 GUIDE 報表。',
    action: '前往行程與方案',
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
    fileName: (date: string, ext: string) => `營運報表_${date}.${ext}`,
    success: '報表匯出成功',
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
