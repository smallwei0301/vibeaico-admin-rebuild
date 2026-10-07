/**
 * GUIDE 報表數字 → 旅遊訂單清單的下鑽連結（純函式，Issue #45）。
 * 原則：連結列出的訂單必須就是該數字所計算的訂單——
 *  - 訂單數／人數／來源分布排除已取消 → 帶 activeOnly
 *  - 實收營收口徑含已取消訂單的已收款 → 不帶 activeOnly
 * 日期一律用報表實際使用的區間（店家時區，與 API 同一套界線）；asOf 以 createdBefore（嚴格小於）傳遞。
 */
import { buildTourOrdersLink } from '@/services/tours';

/** asOf＝報表「資料截至」；有值時所有連結帶 createdBefore，讓清單與報表用同一個讀取上界 */
export type ReportRange = { from: string; to: string; asOf?: string | null };
export type RankMetric = 'orders' | 'people' | 'revenue';
export type RankDimension = 'trip' | 'plan';

const dates = (r: ReportRange) => ({ createdFrom: r.from, createdTo: r.to, createdBefore: r.asOf });

/** 整個區間（含所有狀態）；可選狀態 */
export const rangeLink = (r: ReportRange, status?: string) => buildTourOrdersLink({ status, ...dates(r) });

/** 來源分布：非取消訂單 */
export const sourceLink = (r: ReportRange, source: string) =>
  buildTourOrdersLink({ source, activeOnly: true, ...dates(r) });

/** 排行名稱：行程帶 tripId、方案帶 planId；依實收營收排序時不排除取消 */
export const rankingLink = (r: ReportRange, dimension: RankDimension, id: string, metric: RankMetric) =>
  buildTourOrdersLink({
    ...(dimension === 'trip' ? { tripId: id } : { planId: id }),
    activeOnly: metric !== 'revenue',
    ...dates(r),
  });

export const refundPendingLink = (r: ReportRange) =>
  buildTourOrdersLink({ paymentStatus: 'REFUND_PENDING', ...dates(r) });

export const repeatCustomersLink = (r: ReportRange) =>
  buildTourOrdersLink({ repeatCustomers: true, ...dates(r) });
