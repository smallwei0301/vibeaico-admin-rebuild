/**
 * src/server/guide-report.ts — GUIDE 導遊營運報表（Issue #45 第一個 Delivery Slice）的純計算。
 *
 * 只吃「已讀回的 tour_orders 列」＋日期區間＋時區，輸出指標；不碰資料庫、不 import 任何
 * server-only 模組，route 只負責查詢與呼叫（見 src/app/api/reports/guide/route.ts）。
 *
 * 口徑（與 src/i18n/zh-TW/pages/reports.ts 的 guideReport.defs 同一份定義）：
 *  - 區間歸屬：以訂單建立時間 `tour_orders.created_at` 落在「租戶時區日界線」的
 *    [from 當天 00:00, to 隔天 00:00) 為準（半開區間，含 to 當天）。
 *  - 訂單數：各 status（PENDING／CONFIRMED／COMPLETED／CANCELLED）分開計數。
 *  - 實收營收：Σ max(0, paid_amount − refunded_amount)。PARTIAL 只算 paid_amount（已收），
 *    未收尾款不進來；已退款金額扣掉。REFUND_PENDING（退款處理中、尚未退出）仍算實收，
 *    另列為 refundPendingCount，不與「已退款」混算。
 *  - 平均客單：非取消訂單的實收 ÷ 「非取消且實收 > 0」的訂單數；分母 0 → null。四捨五入到整數元。
 *    取消單（含退款處理中）分子分母皆排除。
 *  - 取消數：status = CANCELLED 的訂單數。DB 只有自由文字 cancel_reason、沒有取消來源欄位，
 *    因此尚未區分旅客／導遊／系統逾期，不推測。
 *  - 排行：行程（trip）與方案（plan）兩種維度，各自依「訂單數／人數／實收營收」三種排序。
 *    訂單數與人數排除 CANCELLED；實收營收用同一個實收口徑。同分依名稱（code unit 升冪）再依 id。
 *    指標為 0 的項目不進該排序。取前 RANK_LIMIT 名。
 *  - 上一期：與本期等長（天數相同）、緊接在本期之前。百分比變化四捨五入到 1 位小數；上一期為 0 → null。
 */
import { resolvePublicTimeZone } from '@/lib/public-time-zone';

export const RANK_LIMIT = 10;
/** 單次報表最多讀取的訂單筆數；達上限即標 truncated */
export const MAX_ROWS = 20000;
export const MAX_RANGE_DAYS = 366;

export type GuideOrderStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export const GUIDE_ORDER_STATUSES: GuideOrderStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];

/** tour_orders 讀回的列（snake_case、numeric 可能是字串） */
export type GuideReportOrderRow = {
  id: string;
  trip_id: string;
  plan_id: string;
  party_size: number | string;
  status: string;
  payment_status?: string;
  paid_amount: number | string | null;
  refunded_amount?: number | string | null;
  created_at: string;
};

export type GuideRankMetric = 'orders' | 'people' | 'revenue';
export type GuideRankDimension = 'trip' | 'plan';
export type GuideRankRow = { id: string; name: string; orders: number; people: number; revenue: number };
export type GuideRanking = Record<GuideRankMetric, GuideRankRow[]>;

export type GuideSummary = {
  totalOrders: number;
  byStatus: Record<GuideOrderStatus, number>;
  /** Σ max(0, paid − refunded) */
  revenue: number;
  /** Σ refunded_amount（已退出的金額，分列顯示） */
  refundedAmount: number;
  /** 非取消且實收 > 0 的訂單數（平均客單的分母） */
  paidOrderCount: number;
  /** 實收營收 ÷ paidOrderCount；分母 0 → null */
  avgOrderValue: number | null;
  cancelledCount: number;
  /** payment_status = REFUND_PENDING 的訂單數 */
  refundPendingCount: number;
};

export type GuideReportChanges = {
  totalOrders: number | null;
  revenue: number | null;
  avgOrderValue: number | null;
  cancelledCount: number | null;
};

export type GuideReport = {
  range: {
    from: string; to: string; prevFrom: string; prevTo: string; days: number; timeZone: string;
  };
  summary: GuideSummary;
  previous: GuideSummary;
  changes: GuideReportChanges;
  ranking: Record<GuideRankDimension, GuideRanking>;
  /** true = 查詢筆數達上限，數字可能不完整（UI 必須警示） */
  truncated: boolean;
};

export class GuideReportRangeError extends Error {}

/* ------------------------------------------------------------------ 時區 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmd(ymd: string): [number, number, number] {
  const m = DATE_RE.exec(ymd);
  if (!m) throw new GuideReportRangeError(`日期格式需為 YYYY-MM-DD：${ymd}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new GuideReportRangeError(`不存在的日期：${ymd}`);
  }
  return [y, mo, d];
}

/** 純日曆運算：YYYY-MM-DD 加減天數（與時區無關） */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function diffDays(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = parseYmd(fromYmd);
  const [y2, m2, d2] = parseYmd(toYmd);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function zoneOffsetMs(instantMs: number, zone: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - instantMs;
}

/** 租戶時區「ymd 當天 00:00」對應的 UTC 毫秒（兩次收斂，涵蓋日光節約換日） */
export function zonedMidnightMs(ymd: string, zoneInput: string): number {
  const zone = resolvePublicTimeZone(zoneInput);
  const [y, m, d] = parseYmd(ymd);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - zoneOffsetMs(wall, zone);
  guess = wall - zoneOffsetMs(guess, zone);
  return guess;
}

/** 租戶時區的今天（YYYY-MM-DD） */
export function zonedToday(zoneInput: string, nowMs: number = Date.now()): string {
  const zone = resolvePublicTimeZone(zoneInput);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs));
}

export type ResolvedRange = {
  from: string; to: string; prevFrom: string; prevTo: string; days: number; timeZone: string;
  curFromMs: number; curToMs: number; prevFromMs: number;
};

/** 解析本期與上一等長期間（皆為租戶時區日界線，半開區間 [from, to+1)） */
export function resolveReportRange(from: string, to: string, zoneInput: string): ResolvedRange {
  const timeZone = resolvePublicTimeZone(zoneInput);
  parseYmd(from);
  parseYmd(to);
  const days = diffDays(from, to) + 1;
  if (days < 1) throw new GuideReportRangeError('結束日期不可早於開始日期');
  if (days > MAX_RANGE_DAYS) throw new GuideReportRangeError(`日期區間最長 ${MAX_RANGE_DAYS} 天`);
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);
  return {
    from, to, prevFrom, prevTo, days, timeZone,
    curFromMs: zonedMidnightMs(from, timeZone),
    curToMs: zonedMidnightMs(addDays(to, 1), timeZone),
    prevFromMs: zonedMidnightMs(prevFrom, timeZone),
  };
}

/* ------------------------------------------------------------------ 計算 */

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const netReceived = (r: GuideReportOrderRow): number =>
  Math.max(0, num(r.paid_amount) - num(r.refunded_amount));

export function summarize(rows: GuideReportOrderRow[]): GuideSummary {
  const byStatus: Record<GuideOrderStatus, number> = { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 };
  let revenue = 0;
  let refundedAmount = 0;
  let paidOrderCount = 0;
  let avgNumerator = 0;
  let refundPendingCount = 0;
  for (const r of rows) {
    if ((GUIDE_ORDER_STATUSES as string[]).includes(r.status)) byStatus[r.status as GuideOrderStatus] += 1;
    const net = netReceived(r);
    revenue += net;
    refundedAmount += num(r.refunded_amount);
    if (r.status !== 'CANCELLED' && net > 0) {
      paidOrderCount += 1;
      avgNumerator += net;
    }
    if (r.payment_status === 'REFUND_PENDING') refundPendingCount += 1;
  }
  return {
    totalOrders: rows.length,
    byStatus,
    revenue,
    refundedAmount,
    paidOrderCount,
    avgOrderValue: paidOrderCount > 0 ? Math.round(avgNumerator / paidOrderCount) : null,
    cancelledCount: byStatus.CANCELLED,
    refundPendingCount,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 變化百分比：上一期為 0 或任一邊為 null → null（不捏造 ∞ 或 0%） */
export function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

const cmpText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function rankBy(
  rows: GuideReportOrderRow[],
  keyOf: (r: GuideReportOrderRow) => string,
  names: Map<string, string>,
): GuideRanking {
  const acc = new Map<string, GuideRankRow>();
  for (const r of rows) {
    const id = keyOf(r);
    const cur = acc.get(id) ?? { id, name: names.get(id) ?? id, orders: 0, people: 0, revenue: 0 };
    if (r.status !== 'CANCELLED') {
      cur.orders += 1;
      cur.people += num(r.party_size);
    }
    cur.revenue += netReceived(r);
    acc.set(id, cur);
  }
  const all = [...acc.values()];
  const pick = (metric: GuideRankMetric) => all
    .filter((x) => x[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || cmpText(a.name, b.name) || cmpText(a.id, b.id))
    .slice(0, RANK_LIMIT);
  return { orders: pick('orders'), people: pick('people'), revenue: pick('revenue') };
}

export function computeGuideReport(input: {
  rows: GuideReportOrderRow[];
  from: string;
  to: string;
  timeZone: string;
  tripNames: Map<string, string>;
  planNames: Map<string, string>;
  truncated?: boolean;
}): GuideReport {
  const range = resolveReportRange(input.from, input.to, input.timeZone);
  const cur: GuideReportOrderRow[] = [];
  const prev: GuideReportOrderRow[] = [];
  for (const r of input.rows) {
    const ms = Date.parse(r.created_at);
    if (!Number.isFinite(ms)) continue;
    if (ms >= range.curFromMs && ms < range.curToMs) cur.push(r);
    else if (ms >= range.prevFromMs && ms < range.curFromMs) prev.push(r);
  }
  const summary = summarize(cur);
  const previous = summarize(prev);
  return {
    range: {
      from: range.from, to: range.to, prevFrom: range.prevFrom, prevTo: range.prevTo,
      days: range.days, timeZone: range.timeZone,
    },
    truncated: input.truncated === true,
    summary,
    previous,
    changes: {
      totalOrders: changePercent(summary.totalOrders, previous.totalOrders),
      revenue: changePercent(summary.revenue, previous.revenue),
      avgOrderValue: changePercent(summary.avgOrderValue, previous.avgOrderValue),
      cancelledCount: changePercent(summary.cancelledCount, previous.cancelledCount),
    },
    ranking: {
      trip: rankBy(cur, (r) => r.trip_id, input.tripNames),
      plan: rankBy(cur, (r) => r.plan_id, input.planNames),
    },
  };
}
