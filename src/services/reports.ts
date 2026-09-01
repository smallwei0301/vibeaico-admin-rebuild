import { adapt, request } from '@/lib/api';
import type { DashboardAlerts, DashboardStats, StaffPerformance } from '@/lib/types';
import {
  MOCK_DASHBOARD_ALERTS, MOCK_DASHBOARD_STATS, MOCK_STAFF_PERFORMANCE, byMode,
} from '@/mock';

export const getDashboardStats = () =>
  adapt<DashboardStats>(() => MOCK_DASHBOARD_STATS, () => request<DashboardStats>('/api/reports/dashboard'));

export const getDashboardAlerts = () =>
  adapt<DashboardAlerts>(() => MOCK_DASHBOARD_ALERTS, () => request<DashboardAlerts>('/api/reports/dashboard-alerts'));

export const getStaffPerformance = () =>
  adapt<StaffPerformance[]>(() => MOCK_STAFF_PERFORMANCE, () => request<StaffPerformance[]>('/api/reports/staff-performance'));

/* ========================================================================== */
/* 營運報表（/tenant/reports）— 04 分冊 §B-6                                    */
/* ========================================================================== */

export type ReportRange = 'week' | 'month' | 'quarter';
/** ?from&to = YYYY-MM-DD（台北日界線，含 to 當天） */
export type ReportQuery = { from: string; to: string };

export type DailyPoint = { label: string; bookings: number; revenue: number };
export type NamedCount = { name: string; count: number };
export type TopService = { name: string; bookings: number; revenue: number };
export type TopProduct = { name: string; quantity: number; revenue: number };
export type HourlyPoint = { hourLabel: string; count: number; isPeak: boolean };
export type ServiceTrend = { name: string; bookings: number; growth: number };

export type ReportData = {
  summary: {
    totalBookings: number;
    totalRevenue: number;
    completedBookings: number;
    newCustomers: number;
  };
  daily: DailyPoint[];
  serviceDistribution: NamedCount[];
  topServices: TopService[];
  topProducts: TopProduct[];
  hourly: HourlyPoint[];
  advanced: {
    totalCustomers: number;
    activeCustomers: number;
    avgVisitCycle: number;
    avgCustomerValue: number;
    serviceTrends: ServiceTrend[];
  };
};

/* ------------------------------------------------------------------------ */
/* mock 分支：原 reports 頁的決定性假資料產生器（自頁面搬入，行為不變）           */
/* ------------------------------------------------------------------------ */

const SERVICE_NAMES_LOCAL_SHOP = ['精緻剪髮', '全頭染髮', '深層護髮', '瀏海修剪', '頭皮養護'];
const SERVICE_NAMES_GUIDE = ['龜山島賞鯨半日遊', '花蓮砂婆礑溯溪體驗', '九份山城夜訪散策', '包船專案', '台南早餐吃透透'];
const SERVICE_NAMES_CLINIC = ['初診（含健康評估）', '複診', '成人健康檢查', '流感疫苗接種', '勞工體檢'];

const PRODUCT_NAMES_LOCAL_SHOP = [
  '修護洗髮精 500ml', '護髮油 100ml', '定型噴霧', '頭皮精華液', '深層修護髮膜',
  '免沖洗護髮素', '造型髮蠟', '柔順護色洗髮精', '蓬鬆粉', '寬齒梳',
];
const PRODUCT_NAMES_GUIDE = [
  '防水袋 20L', '寬簷防曬帽', '祕島明信片組（6 入）', '手繪路線地圖', '防曬袖套',
  '快乾運動毛巾', '登山杖（單支）', '防水手機袋', '不鏽鋼保溫瓶', '頭燈',
];
const PRODUCT_NAMES_CLINIC = [
  '綜合維他命（90 錠）', '益生菌沖劑（30 包）', '醫用口罩（50 入）', '電子血壓計', '血糖試紙（50 片）',
  '透氣 OK 繃', '電子體溫計', '看護墊（10 片）', '酒精棉片（100 片）', '兒童綜合維他命',
];

const RANGE_POINTS: Record<ReportRange, number> = { week: 7, month: 30, quarter: 13 };
const RANGE_SCALE: Record<ReportRange, number> = { week: 1, month: 4.2, quarter: 12.5 };

/** 決定性假資料產生器（避免 SSR / CSR 不一致，僅在 adapt 的 mock callback 內呼叫） */
function buildReport(range: ReportRange, serviceNames: string[], productNames: string[]): ReportData {
  const points = RANGE_POINTS[range];
  const scale = RANGE_SCALE[range];
  const stepDays = range === 'quarter' ? 7 : 1;

  const daily: DailyPoint[] = Array.from({ length: points }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (points - 1 - i) * stepDays);
    const bookings = 4 + ((i * 7 + points) % 12);
    return {
      label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
      bookings,
      revenue: bookings * 1180 + ((i * 13) % 5) * 420,
    };
  });

  const totalBookings = daily.reduce((s, d) => s + d.bookings, 0);
  const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0);

  const serviceDistribution: NamedCount[] = serviceNames.map((name, i) => ({
    name,
    count: Math.max(Math.round((totalBookings * (5 - i)) / 18), 1),
  }));

  const topServices: TopService[] = serviceDistribution
    .slice(0, 5)
    .map((s, i) => ({ name: s.name, bookings: s.count, revenue: s.count * (600 + i * 340) }));

  const topProducts: TopProduct[] = productNames.map((name, i) => {
    const quantity = Math.max(Math.round((28 - i * 2) * (scale / 4.2)), 1);
    return { name, quantity, revenue: quantity * (880 - i * 55) };
  });

  const hourly: HourlyPoint[] = Array.from({ length: 11 }, (_, i) => {
    const hour = 10 + i;
    const count = Math.max(Math.round((3 + ((i * 5) % 9)) * (scale / 2)), 0);
    return { hourLabel: `${String(hour).padStart(2, '0')}:00`, count, isPeak: false };
  });
  const peak = Math.max(...hourly.map((h) => h.count));
  hourly.forEach((h) => { h.isPeak = h.count === peak; });

  const activeCustomers = Math.round(totalBookings * 0.62);

  return {
    summary: {
      totalBookings,
      totalRevenue,
      completedBookings: Math.round(totalBookings * 0.86),
      newCustomers: Math.round(totalBookings * 0.21),
    },
    daily,
    serviceDistribution,
    topServices,
    topProducts,
    hourly,
    advanced: {
      totalCustomers: 246,
      activeCustomers,
      avgVisitCycle: range === 'week' ? 34 : range === 'month' ? 38 : 42,
      avgCustomerValue: activeCustomers ? Math.round(totalRevenue / activeCustomers) : 0,
      serviceTrends: serviceNames.map((name, i) => ({
        name,
        bookings: Math.max(Math.round((totalBookings * (5 - i)) / 18), 1),
        growth: [12.4, -6.8, 0, 24.1, -3.2][i] ?? 0,
      })),
    },
  };
}

/* ------------------------------------------------------------------------ */

/**
 * 營運報表整組資料。
 * mock：沿用原頁內建的決定性假資料（依 range 產生，byMode 於 callback 內呼叫）。
 * real：一次打 §B-6 各端點（summary/daily/hourly/top-services/top-products/advanced）；
 *       serviceDistribution 沒有獨立端點，由 top-services 的 bookings 映射
 *       （mock 也是同一份數字，形狀一致）。
 */
export const getReportData = (range: ReportRange, q: ReportQuery) =>
  adapt<ReportData>(
    () => buildReport(
      range,
      byMode({
        LOCAL_SHOP: SERVICE_NAMES_LOCAL_SHOP, GUIDE: SERVICE_NAMES_GUIDE, CLINIC: SERVICE_NAMES_CLINIC,
      }),
      byMode({
        LOCAL_SHOP: PRODUCT_NAMES_LOCAL_SHOP, GUIDE: PRODUCT_NAMES_GUIDE, CLINIC: PRODUCT_NAMES_CLINIC,
      }),
    ),
    async () => {
      const [summary, daily, hourly, topServices, topProducts, advanced] = await Promise.all([
        request<ReportData['summary']>('/api/reports/summary', { query: q }),
        request<DailyPoint[]>('/api/reports/daily', { query: q }),
        request<HourlyPoint[]>('/api/reports/hourly', { query: q }),
        request<TopService[]>('/api/reports/top-services', { query: q }),
        request<TopProduct[]>('/api/reports/top-products', { query: q }),
        request<ReportData['advanced']>('/api/reports/advanced', { query: q }),
      ]);
      return {
        summary,
        daily,
        hourly,
        topServices,
        topProducts,
        advanced,
        serviceDistribution: topServices.map((s) => ({ name: s.name, count: s.bookings })),
      };
    },
  );

/** 員工排行 TOP 5（real 已排序取前 5；mock 沿用 MOCK_STAFF_PERFORMANCE，頁面自行 slice） */
export const getTopStaff = (q: ReportQuery) =>
  adapt<StaffPerformance[]>(
    () => MOCK_STAFF_PERFORMANCE,
    () => request<StaffPerformance[]>('/api/reports/top-staff', { query: q }),
  );

/* ------------------------------------------------------------------ 匯出 */

/**
 * 匯出端點不走 { success, data } 信封，是檔案下載：real 分支以 fetch 讀取
 * Content-Disposition，再建立瀏覽器下載；mock 分支明確回報沒有檔案。
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const exportCustomersExcel = () =>
  adapt<void>(
    () => undefined,
    async () => { window.location.assign(`${API_BASE}/api/export/customers/excel`); },
  );

export const exportBookingsCsv = (q?: ReportQuery) =>
  adapt<void>(
    () => undefined,
    async () => {
      const qs = q ? `?${new URLSearchParams(q).toString()}` : '';
      window.location.assign(`${API_BASE}/api/export/bookings${qs}`);
    },
  );

export type ExportReportsResult = { downloaded: boolean; fileName: string };

function safeDownloadFileName(disposition: string, fallback: string): string {
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let candidate = fallback;
  if (encoded) {
    try { candidate = decodeURIComponent(encoded); } catch { /* use fallback */ }
  } else if (plain) {
    candidate = plain;
  }
  return candidate.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 120) || fallback;
}

/** 下載目前報表頁的統計；mock 模式明確回報沒有產生檔案。 */
export const exportReports = (format: 'csv' | 'excel', q?: ReportQuery) =>
  adapt<ExportReportsResult>(
    () => ({ downloaded: false, fileName: '' }),
    async () => {
      const qs = q ? `?${new URLSearchParams(q).toString()}` : '';
      const res = await fetch(`${API_BASE}/api/export/reports/${format}${qs}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('匯出失敗');
      if (!(res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/csv')) {
        throw new Error('匯出回應格式錯誤');
      }

      const blob = await res.blob();
      if (blob.size === 0) throw new Error('匯出檔案為空');
      const disposition = res.headers.get('content-disposition') ?? '';
      const fileName = safeDownloadFileName(
        disposition,
        `reports-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      return { downloaded: true, fileName };
    },
  );
