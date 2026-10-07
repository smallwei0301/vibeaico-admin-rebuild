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
 *  - 取消率：status = CANCELLED 的訂單數 ÷ 該期訂單總數（含取消），四捨五入到 1 位小數；總數 0 → null。
 *    上一期比較以百分點差表示。取消數（筆數）保留為次要資訊。
 *    DB 無取消來源欄位，因此取消率尚未區分旅客／導遊／系統逾期；DB 只有自由文字 cancel_reason、沒有取消來源欄位，
 *    因此尚未區分旅客／導遊／系統逾期，不推測。
 *  - 排行：行程（trip）與方案（plan）兩種維度，各自依「訂單數／人數／實收營收」三種排序。
 *    訂單數與人數排除 CANCELLED；實收營收用同一個實收口徑。同分依名稱（code unit 升冪）再依 id。
 *    指標為 0 的項目不進該排序。取前 RANK_LIMIT 名。
 *  - 來源：非取消訂單依 tour_orders.source（MIDAO／VIBEAI_SHOP／LINE／MANUAL）分列訂單數與實收營收；
 *    四個來源恆列（0 為真實計數），不在已知清單內的值（含空值）歸「OTHER」。
 *  - 重複旅客：本期有非取消訂單且 customer_id 非空的旅客（以 customer_id 去重）中，
 *    本期內有 ≥2 筆非取消訂單，或本期開始之前（任何時間）已有非取消訂單者為「重複旅客」。
 *    重複率 = 重複旅客數 ÷ 本期旅客數（四捨五入 1 位小數；分母 0 → null）。
 *    customer_id 為空的非取消訂單不計入分母，另以 unlinkedOrders 列出。
 *  - 上一期：與本期等長（天數相同）、緊接在本期之前。百分比變化四捨五入到 1 位小數；上一期為 0 → null。
 */
import { resolvePublicTimeZone } from '@/lib/public-time-zone';
import {
  computeFormation, type GuideDepartureRow, type GuideFormation,
} from '@/server/guide-report-formation';

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
  source?: string | null;
  customer_id?: string | null;
};

export const GUIDE_SOURCES = ['MIDAO', 'VIBEAI_SHOP', 'LINE', 'MANUAL'] as const;
export type GuideSourceKey = (typeof GUIDE_SOURCES)[number] | 'OTHER';
export const GUIDE_SOURCE_KEYS: GuideSourceKey[] = [...GUIDE_SOURCES, 'OTHER'];
export type GuideSourceStat = { orders: number; revenue: number };
export type GuideRepeatStat = {
  /** 本期有非取消訂單且 customer_id 非空的旅客數（去重） */
  customers: number;
  repeatCustomers: number;
  /** 重複旅客在本期的非取消訂單數（下鑽清單列出的筆數） */
  repeatOrders: number;
  /** repeatCustomers ÷ customers × 100，1 位小數；分母 0 → null */
  ratePercent: number | null;
  /** customer_id 為空的非取消訂單數（不計入分母） */
  unlinkedOrders: number;
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
  /** 取消率（%，1 位小數）＝取消數 ÷ 該期訂單總數（含取消）；總數 0 → null */
  cancellationRate: number | null;
  /** payment_status = REFUND_PENDING 的訂單數 */
  refundPendingCount: number;
  /** 非取消訂單的來源分布（四個來源恆列 + OTHER） */
  bySource: Record<GuideSourceKey, GuideSourceStat>;
};

export type GuideReportChanges = {
  totalOrders: number | null;
  revenue: number | null;
  avgOrderValue: number | null;
  /** 取消率增減（百分點，本期 − 上一期，1 位小數）；任一期無訂單 → null */
  cancellationRatePoints: number | null;
};

export type GuideReport = {
  /** 成團表現（trip_departures；口徑見 guide-report-formation.ts） */
  formation: GuideFormation;
  range: {
    from: string; to: string; prevFrom: string; prevTo: string; days: number; timeZone: string;
  };
  summary: GuideSummary;
  previous: GuideSummary;
  changes: GuideReportChanges;
  ranking: Record<GuideRankDimension, GuideRanking>;
  repeat: GuideRepeatStat;
  /** true = 查詢筆數達上限，數字可能不完整（UI 必須警示） */
  truncated: boolean;
  /** 資料截至時間（ISO）：只計入此刻以前建立的訂單；mock／未提供時為 null */
  asOf: string | null;
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

function zonedDateString(instantMs: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instantMs));
}

/**
 * 租戶時區「ymd 當天」第一個存在的瞬間（UTC 毫秒）。
 * 一般日子就是當地 00:00；若午夜因日光節約跳時而不存在（如 America/Santiago 2024-09-08，
 * 00:00 直接跳到 01:00），回傳該日第一個有效瞬間。兩次 offset 收斂後再以本地日期驗證：
 * 仍屬前一天就逐分鐘往後推；若已進入目標日的前一分鐘仍是目標日（重複時段）則往前收。
 */
export function zonedMidnightMs(ymd: string, zoneInput: string): number {
  const zone = resolvePublicTimeZone(zoneInput);
  const [y, m, d] = parseYmd(ymd);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - zoneOffsetMs(wall, zone);
  guess = wall - zoneOffsetMs(guess, zone);
  const MINUTE = 60000;
  for (let i = 0; i < 24 * 60 && zonedDateString(guess, zone) < ymd; i += 1) guess += MINUTE;
  for (let i = 0; i < 24 * 60 && zonedDateString(guess - MINUTE, zone) === ymd; i += 1) guess -= MINUTE;
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

/**
 * 訂單清單深連結用的「建立日期區間」→ UTC 瞬間界線（半開 [from 00:00, to+1 00:00)，租戶時區）。
 * 與 resolveReportRange 的本期界線同一套 zonedMidnightMs，保證報表數字與下鑽清單口徑一致。
 * 只給一端時另一端不設限；格式不合法丟 GuideReportRangeError。
 */
export function createdRangeBounds(
  from: string | undefined, to: string | undefined, zoneInput: string,
): { gteIso?: string; ltIso?: string } {
  const out: { gteIso?: string; ltIso?: string } = {};
  if (from) out.gteIso = new Date(zonedMidnightMs(from, zoneInput)).toISOString();
  if (to) out.ltIso = new Date(zonedMidnightMs(addDays(to, 1), zoneInput)).toISOString();
  if (from && to && to < from) throw new GuideReportRangeError('結束日期不可早於開始日期');
  return out;
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
  const bySource = Object.fromEntries(GUIDE_SOURCE_KEYS.map((k) => [k, { orders: 0, revenue: 0 }])) as Record<GuideSourceKey, GuideSourceStat>;
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
    if (r.status !== 'CANCELLED') {
      const key: GuideSourceKey = (GUIDE_SOURCES as readonly string[]).includes(r.source ?? '')
        ? (r.source as GuideSourceKey) : 'OTHER';
      bySource[key].orders += 1;
      bySource[key].revenue += net;
    }
  }
  return {
    totalOrders: rows.length,
    byStatus,
    revenue,
    refundedAmount,
    paidOrderCount,
    avgOrderValue: paidOrderCount > 0 ? Math.round(avgNumerator / paidOrderCount) : null,
    cancelledCount: byStatus.CANCELLED,
    cancellationRate: rows.length > 0 ? round1((byStatus.CANCELLED / rows.length) * 100) : null,
    refundPendingCount,
    bySource,
  };
}

/** 重複旅客的 customer_id 集合（定義見檔頭）。報表與訂單清單下鑽共用，口徑只此一份。 */
export function repeatCustomerIdSet(
  curRows: Pick<GuideReportOrderRow, 'status' | 'customer_id'>[],
  priorCustomerIds: ReadonlySet<string>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const r of curRows) {
    if (r.status === 'CANCELLED' || !r.customer_id) continue;
    counts.set(r.customer_id, (counts.get(r.customer_id) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [id, n] of counts) if (n >= 2 || priorCustomerIds.has(id)) out.add(id);
  return out;
}

/** 重複旅客（定義見檔頭）。curRows＝本期訂單；priorCustomerIds＝本期開始前已有非取消訂單的 customer_id。 */
export function repeatCustomers(curRows: GuideReportOrderRow[], priorCustomerIds: ReadonlySet<string>): GuideRepeatStat {
  const customers = new Set<string>();
  let unlinkedOrders = 0;
  for (const r of curRows) {
    if (r.status === 'CANCELLED') continue;
    if (!r.customer_id) unlinkedOrders += 1; else customers.add(r.customer_id);
  }
  const repeat = repeatCustomerIdSet(curRows, priorCustomerIds);
  let repeatOrders = 0;
  for (const r of curRows) if (r.status !== 'CANCELLED' && r.customer_id && repeat.has(r.customer_id)) repeatOrders += 1;
  return {
    customers: customers.size,
    repeatCustomers: repeat.size,
    repeatOrders,
    ratePercent: customers.size > 0 ? round1((repeat.size / customers.size) * 100) : null,
    unlinkedOrders,
  };
}

function splitPeriods(rows: GuideReportOrderRow[], range: ResolvedRange) {
  const cur: GuideReportOrderRow[] = [];
  const prev: GuideReportOrderRow[] = [];
  for (const r of rows) {
    const ms = Date.parse(r.created_at);
    if (!Number.isFinite(ms)) continue;
    if (ms >= range.curFromMs && ms < range.curToMs) cur.push(r);
    else if (ms >= range.prevFromMs && ms < range.curFromMs) prev.push(r);
  }
  return { cur, prev };
}

/** 本期有非取消訂單的 customer_id（去重）——route 用它去查「本期之前是否已有訂單」。 */
export function currentCustomerIds(rows: GuideReportOrderRow[], from: string, to: string, timeZone: string): string[] {
  const { cur } = splitPeriods(rows, resolveReportRange(from, to, timeZone));
  return [...new Set(cur.filter((r) => r.status !== 'CANCELLED' && r.customer_id).map((r) => r.customer_id as string))];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 變化百分比：上一期為 0 或任一邊為 null → null（不捏造 ∞ 或 0%） */
export function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

/** 百分點差（本期 − 上一期）；任一邊 null → null */
export function pointDiff(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return round1(current - previous);
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
  asOf?: string;
  /** 本期開始之前已有非取消訂單的 customer_id（route 查詢；未提供視為空集合） */
  priorCustomerIds?: ReadonlySet<string>;
  /** 期間內（含上一期）的團次列；未提供視為沒有團次 */
  departures?: GuideDepartureRow[];
  /** 團次筆數達上限（成團表現數字可能不完整） */
  departuresTruncated?: boolean;
}): GuideReport {
  const range = resolveReportRange(input.from, input.to, input.timeZone);
  const { cur, prev } = splitPeriods(input.rows, range);
  const summary = summarize(cur);
  const previous = summarize(prev);
  const nowMs = input.asOf ? Date.parse(input.asOf) : Date.now();
  return {
    formation: computeFormation({
      rows: input.departures ?? [], from: range.from, to: range.to, prevFrom: range.prevFrom, prevTo: range.prevTo,
      today: zonedToday(range.timeZone, nowMs), truncated: input.departuresTruncated,
    }),
    range: {
      from: range.from, to: range.to, prevFrom: range.prevFrom, prevTo: range.prevTo,
      days: range.days, timeZone: range.timeZone,
    },
    truncated: input.truncated === true,
    asOf: input.asOf ?? null,
    repeat: repeatCustomers(cur, input.priorCustomerIds ?? new Set<string>()),
    summary,
    previous,
    changes: {
      totalOrders: changePercent(summary.totalOrders, previous.totalOrders),
      revenue: changePercent(summary.revenue, previous.revenue),
      avgOrderValue: changePercent(summary.avgOrderValue, previous.avgOrderValue),
      cancellationRatePoints: pointDiff(summary.cancellationRate, previous.cancellationRate),
    },
    ranking: {
      trip: rankBy(cur, (r) => r.trip_id, input.tripNames),
      plan: rankBy(cur, (r) => r.plan_id, input.planNames),
    },
  };
}
