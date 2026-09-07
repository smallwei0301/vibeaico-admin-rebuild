import { adapt, request } from '@/lib/api';
import {
  NOT_DOWNLOADED,
  downloadAttachment,
  type AttachmentDownloadResult,
} from '@/services/download';
import type { Booking, DashboardAlerts, DashboardStats, StaffPerformance } from '@/lib/types';
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
/* Dashboard 首頁三塊真實資料區塊（Issue #7）— 本週趨勢／本月來源／最近活動        */
/* ========================================================================== */

export type WeeklyTrendPoint = { weekday: number; bookings: number; revenue: number };
export type MonthSourcePoint = { source: Booking['source']; count: number };

export type DashboardActivityType =
  | 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'BOOKING_COMPLETED'
  | 'CUSTOMER_CREATED' | 'ORDER_CREATED';

export type RecentActivity = { id: string; type: DashboardActivityType; name: string; target: string; at: string };

/* ------------------------------------------------------------------------ */
/* mock 分支：搬自原 dashboard 頁的骨架假資料，行為不變（byMode 於 callback 內呼叫） */
/* ------------------------------------------------------------------------ */

/** 本週預約趨勢：weekday 對應 common.weekdays 的索引（0 = 週日） */
const TREND_LOCAL_SHOP: WeeklyTrendPoint[] = [
  { weekday: 1, bookings: 6, revenue: 8400 },
  { weekday: 2, bookings: 9, revenue: 15600 },
  { weekday: 3, bookings: 4, revenue: 5200 },
  { weekday: 4, bookings: 11, revenue: 21800 },
  { weekday: 5, bookings: 14, revenue: 28600 },
  { weekday: 6, bookings: 17, revenue: 34200 },
  { weekday: 0, bookings: 8, revenue: 14600 },
];

/** 嚮導出團集中在週末與連假，平日以諮詢、整裝為主 */
const TREND_GUIDE: WeeklyTrendPoint[] = [
  { weekday: 1, bookings: 1, revenue: 3200 },
  { weekday: 2, bookings: 2, revenue: 6400 },
  { weekday: 3, bookings: 1, revenue: 2800 },
  { weekday: 4, bookings: 3, revenue: 18600 },
  { weekday: 5, bookings: 5, revenue: 42800 },
  { weekday: 6, bookings: 9, revenue: 96400 },
  { weekday: 0, bookings: 7, revenue: 78200 },
];

/** 診所平日門診量高，週末僅半日看診 */
const TREND_CLINIC: WeeklyTrendPoint[] = [
  { weekday: 1, bookings: 46, revenue: 32400 },
  { weekday: 2, bookings: 52, revenue: 38600 },
  { weekday: 3, bookings: 44, revenue: 30800 },
  { weekday: 4, bookings: 50, revenue: 36200 },
  { weekday: 5, bookings: 58, revenue: 41400 },
  { weekday: 6, bookings: 22, revenue: 15600 },
  { weekday: 0, bookings: 0, revenue: 0 },
];

/** 本月預約來源分布 */
const SOURCES_LOCAL_SHOP: MonthSourcePoint[] = [
  { source: 'LINE', count: 84 },
  { source: 'PUBLIC_PAGE', count: 41 },
  { source: 'MANUAL', count: 18 },
  { source: 'RECURRING', count: 7 },
];

const SOURCES_GUIDE: MonthSourcePoint[] = [
  { source: 'PUBLIC_PAGE', count: 38 },
  { source: 'LINE', count: 26 },
  { source: 'MANUAL', count: 14 },
  { source: 'RECURRING', count: 0 },
];

const SOURCES_CLINIC: MonthSourcePoint[] = [
  { source: 'LINE', count: 612 },
  { source: 'PUBLIC_PAGE', count: 204 },
  { source: 'RECURRING', count: 96 },
  { source: 'MANUAL', count: 48 },
];

const ACTIVITY_LOCAL_SHOP: RecentActivity[] = [
  { id: 'a_1', type: 'BOOKING_CREATED', name: '王小明', target: '精緻剪髮', at: '2026-08-20T09:12:00+08:00' },
  { id: 'a_2', type: 'ORDER_CREATED', name: '陳雅婷', target: '護髮油 100ml', at: '2026-08-20T08:40:00+08:00' },
  { id: 'a_3', type: 'BOOKING_COMPLETED', name: '陳雅婷', target: '深層護髮', at: '2026-08-19T15:45:00+08:00' },
  { id: 'a_4', type: 'CUSTOMER_CREATED', name: '林佳蓉', target: '', at: '2026-08-19T11:02:00+08:00' },
  { id: 'a_5', type: 'BOOKING_CANCELLED', name: '陳雅婷', target: '全頭染髮', at: '2026-08-17T10:20:00+08:00' },
];

const ACTIVITY_GUIDE: RecentActivity[] = [
  { id: 'a_1', type: 'BOOKING_CREATED', name: '黃思穎', target: '花蓮砂婆礑溯溪體驗', at: '2026-08-20T09:12:00+08:00' },
  { id: 'a_2', type: 'ORDER_CREATED', name: '林巧薇', target: '防水袋 20L', at: '2026-08-20T08:40:00+08:00' },
  { id: 'a_3', type: 'BOOKING_COMPLETED', name: '陳彥廷', target: '龜山島賞鯨半日遊', at: '2026-08-19T15:45:00+08:00' },
  { id: 'a_4', type: 'CUSTOMER_CREATED', name: '吳孟儒', target: '', at: '2026-08-19T11:02:00+08:00' },
  { id: 'a_5', type: 'BOOKING_CANCELLED', name: '張家豪', target: '九份山城夜訪散策', at: '2026-08-17T10:20:00+08:00' },
];

const ACTIVITY_CLINIC: RecentActivity[] = [
  { id: 'a_1', type: 'BOOKING_CREATED', name: '許文彥', target: '流感疫苗接種', at: '2026-08-20T09:12:00+08:00' },
  { id: 'a_2', type: 'ORDER_CREATED', name: '蔡淑芬', target: '綜合維他命（90 錠）', at: '2026-08-20T08:40:00+08:00' },
  { id: 'a_3', type: 'BOOKING_COMPLETED', name: '劉建國', target: '複診', at: '2026-08-19T15:45:00+08:00' },
  { id: 'a_4', type: 'CUSTOMER_CREATED', name: '周佩琪', target: '', at: '2026-08-19T11:02:00+08:00' },
  { id: 'a_5', type: 'BOOKING_CANCELLED', name: '蔡淑芬', target: '成人健康檢查', at: '2026-08-17T10:20:00+08:00' },
];

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * ?from&to = YYYY-MM-DD，「本週」＝台北時區的週一～週日日曆週（不是滾動 7 天）。
 *
 * 兩個理由必須用日曆週：dashboard 這張圖的標題是「本週預約趨勢」，且 X 軸畫的是
 * 週一～週日的星期名稱（common.weekdays）；滾動區間會讓軸從星期中間開始繞一圈，
 * 也會把上週的日子算進「本週」。mock 分支的 TREND_* 同樣是週一～週日排列，
 * real 分支必須給出一樣的順序。
 *
 * 日期一律以台北牆上時鐘（固定 +08:00）計算，不用瀏覽器本地時區 —— 後端
 * /api/reports/daily 是以台北日界線分桶的（見 src/server/tz.ts），瀏覽器在別的
 * 時區時，用本地日期會在跨日前後送出偏一天的區間。
 */
function weekQuery(): { from: string; to: string } {
  const now = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const [y, m, d] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
  const sinceMonday = (now.getUTCDay() + 6) % 7; // getUTCDay: 0=週日 → 週一為 0
  const fmt = (offsetDays: number) => {
    const t = new Date(Date.UTC(y, m, d + offsetDays));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  };
  return { from: fmt(-sinceMonday), to: fmt(-sinceMonday + 6) };
}

/**
 * 本週預約趨勢（台北時區的週一～週日日曆週，與畫面星期軸一致；本週尚未到來的
 * 日子由 /api/reports/daily 補 0）。
 * real：打既有 /api/reports/daily?from&to，逐日換算成 weekday（0=週日）。
 */
export const getWeeklyTrend = () =>
  adapt<WeeklyTrendPoint[]>(
    () => byMode({ LOCAL_SHOP: TREND_LOCAL_SHOP, GUIDE: TREND_GUIDE, CLINIC: TREND_CLINIC }),
    async () => {
      const q = weekQuery();
      const daily = await request<{ label: string; bookings: number; revenue: number }[]>(
        '/api/reports/daily', { query: q },
      );
      const [y, m, d] = q.from.split('-').map(Number);
      return daily.map((point, i) => {
        const weekday = new Date(Date.UTC(y, m - 1, d + i)).getUTCDay();
        return { weekday, bookings: point.bookings, revenue: point.revenue };
      });
    },
  );

/** 本月預約來源分布。real：新端點 /api/reports/booking-sources（本月，無 from/to）。 */
export const getMonthSources = () =>
  adapt<MonthSourcePoint[]>(
    () => byMode({ LOCAL_SHOP: SOURCES_LOCAL_SHOP, GUIDE: SOURCES_GUIDE, CLINIC: SOURCES_CLINIC }),
    () => request<MonthSourcePoint[]>('/api/reports/booking-sources'),
  );

/** 最近活動（最新 10 筆，跨預約/顧客/訂單四種事件合併）。real：新端點 /api/reports/dashboard-activity。 */
export const getRecentActivity = () =>
  adapt<RecentActivity[]>(
    () => byMode({ LOCAL_SHOP: ACTIVITY_LOCAL_SHOP, GUIDE: ACTIVITY_GUIDE, CLINIC: ACTIVITY_CLINIC }),
    () => request<RecentActivity[]>('/api/reports/dashboard-activity'),
  );

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
 * 匯出端點不走 { success, data } 信封，是檔案下載：real 分支直接導向端點 URL
 * （同源 cookie 會帶上，瀏覽器觸發下載）；mock 分支 no-op，頁面照舊 toast。
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

// issue #246：改走 fetch + Content-Disposition，理由有二。
// ① 端點已改產真正的 xlsx，呼叫端必須把後端給的檔名交給瀏覽器，不能自己組。
// ② 原本的 window.location.assign 拿不到任何回應標頭，於是報表頁只能自行拼一個
//    「營運報表_YYYYMMDD.xlsx」——那個檔名與實際下載到的檔案無關，是捏造的。
// 下載機制沿用 inventory-export.ts 的 downloadAttachment，不另造一套。
export const exportCustomersExcel = () =>
  adapt<AttachmentDownloadResult>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(`${API_BASE}/api/export/customers/excel`),
  );

export type ExportBookingsQuery = {
  from?: string;
  to?: string;
};

export const exportBookingsCsv = (q?: ExportBookingsQuery) =>
  adapt<void>(
    () => undefined,
    async () => {
      const params = new URLSearchParams();
      if (q?.from) params.set('from', q.from);
      if (q?.to) params.set('to', q.to);

      const queryString = params.toString();
      const response = await fetch(
        `${API_BASE}/api/export/bookings${queryString ? `?${queryString}` : ''}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const filename = response.headers
        .get('content-disposition')
        ?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'bookings.csv';
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    },
  );
