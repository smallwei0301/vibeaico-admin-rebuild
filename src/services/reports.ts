import { adapt, request } from '@/lib/api';
import { downloadAttachment, type DownloadedFile } from '@/lib/download';
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
 * 匯出端點不走 { success, data } 信封，是檔案下載（見各 route 檔頭）。
 *
 * 三支（reports / bookings / customers / inventory）**共用同一條路**：
 * `downloadAttachment()`（src/lib/download.ts）真的把位元組收下來、存成檔案，
 * 並把**伺服器 `Content-Disposition` 給的檔名**回傳給頁面。
 *
 * ⚠️ 這裡以前是 `window.location.assign(url)`：一行就能觸發下載，但呼叫端
 * 拿不到回應，於是「檔名」只能由頁面自己用當天日期組一個字串出來——
 * issue #28 ④⑤ 的捏造檔名就是這樣長出來的（顧客頁報 `顧客清單_20260825.xlsx`，
 * 伺服器實際送的是 `customers-2026-08-25.csv`）。檔名只有伺服器知道。
 *
 * 回傳 `{ downloaded, fileName }`：
 * - real：檔案真的到了瀏覽器 → downloaded=true，fileName 是真正存下來的檔名
 *   （伺服器沒給檔名時是空字串，**不編一個**）。
 * - mock／示範店家：沒有伺服器可打，也不會產生任何檔案 → downloaded=false。
 *   頁面必須據此顯示「未匯出」而不是成功（CLAUDE.md：成功訊息是一項事實宣稱）。
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type ExportFileResult = DownloadedFile;
/** @deprecated 舊名，語意同 ExportFileResult（保留避免呼叫端一次全改） */
export type ExportReportsResult = DownloadedFile;

const NOT_DOWNLOADED: DownloadedFile = { downloaded: false, fileName: '' };

/** `?a=1&b=2`；值為 undefined／空字串的參數整個不送（送 `from=undefined` 會被後端擋掉） */
function queryString(params: Record<string, string | undefined>): string {
  const usable = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (!usable.length) return '';
  return `?${new URLSearchParams(usable as [string, string][]).toString()}`;
}

/** 顧客名單匯出（GET /api/export/customers/excel；內容是 CSV，見該 route 檔頭） */
export const exportCustomersExcel = () =>
  adapt<DownloadedFile>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(`${API_BASE}/api/export/customers/excel`),
  );

/**
 * 預約列表匯出（GET /api/export/bookings/:format?from&to）。
 *
 * ⚠️ issue #33 ③：原站打的是帶 format 路徑段的形狀
 * （docs/specs/bookings.json jsApiCalls `/api/export/bookings/${format}`），
 * 我方原本只有無 format 段的版本。現在改打格式段，形狀同 exportReports。
 *
 * ⚠️ **兩個 format 拿到的是同一份 CSV**（端點兩個分支共用同一個產生器）：
 * 專案沒有裝 xlsx 產生器，所以 'excel' 不會產出真的 .xlsx——這一點在頁面
 * 標籤上要說實話，不得寫成「匯出 Excel」再送一個 .csv 出去。
 * 檔名一律取自後端的 Content-Disposition（#28 ④ 的規則），前端不自組。
 */
export const exportBookingsCsv = (format: 'csv' | 'excel', q?: Partial<ReportQuery>) =>
  adapt<DownloadedFile>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(
      `${API_BASE}/api/export/bookings/${format}${queryString({ from: q?.from, to: q?.to })}`,
    ),
  );

/**
 * 庫存異動匯出（GET /api/export/inventory/:format，issue #28 第 ⑤ 筆新增）。
 *
 * `productId` / `type` 帶的是**頁面當下的兩個篩選**——匯出前的確認視窗寫著
 * 「確定要匯出目前篩選的異動記錄嗎？」，那句話得是真的：只送分頁參數而不送
 * 篩選，匯出的就會是全部資料，與畫面上看到的不同。
 */
export const exportInventoryLogs = (
  format: 'csv' | 'excel',
  q?: { productId?: string; type?: string },
) =>
  adapt<DownloadedFile>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(
      `${API_BASE}/api/export/inventory/${format}`
      + queryString({ productId: q?.productId, type: q?.type }),
    ),
  );

/**
 * 營運報表匯出（修復-7 / issue #15 第 ③ 項）。
 *
 * 先前這頁的「匯出」把 Excel 導到顧客名單、CSV 導到預約列表，卻 toast
 * 「匯出成功：營運報表_日期.xlsx」——檔名宣稱是報表，內容不是。現在改打
 * GET /api/export/reports/:format，匯出的就是本頁畫面上的統計。
 *
 * ⚠️ 2026-08-26（issue #28 ④）：這支原本雖然真的導到端點，但回傳的 fileName
 * 是前端用當天日期**自己組的** `reports-YYYY-MM-DD.csv`。它碰巧與伺服器的
 * 命名規則一致，所以看起來沒問題——但那是兩份各自演化的規則，端點哪天改了
 * 檔名，畫面會若無其事地繼續報舊的那個。改成一律取自 Content-Disposition。
 */
export const exportReports = (format: 'csv' | 'excel', q?: ReportQuery) =>
  adapt<DownloadedFile>(
    () => NOT_DOWNLOADED,
    () => downloadAttachment(
      `${API_BASE}/api/export/reports/${format}${queryString({ from: q?.from, to: q?.to })}`,
    ),
  );
