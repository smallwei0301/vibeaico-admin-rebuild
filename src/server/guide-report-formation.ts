/**
 * GUIDE 報表「成團表現」（Issue #45，19 分冊 §7.1「成團率與未達門檻率」）的純計算。
 * 只吃 trip_departures 讀回的列＋日期區間＋「今天」；不碰資料庫。欄位皆來自 0066／0107：
 * departs_on（date，店家當地日曆日）、formation_status（COLLECTING／FORMED／REVIEW_REQUIRED／AT_RISK／FAILED）。
 *
 * 口徑（與 reports.ts 的 guideReport.defs.formation 同一份定義）：
 *  - 期間歸屬：團次「出發日」departs_on 落在 [from, to]（含兩端；date 欄位本身就是店家日曆日，不需時區換算）。
 *  - 已結案：出發日已到（≤ 店家時區今天）且 formation_status ∈ {FORMED, AT_RISK, FAILED}。
 *    成團率以「成團承諾」為口徑：FORMED、AT_RISK 都算已成團（AT_RISK 只能由 FORMED 轉入，且「不自動撤銷已成團承諾」，
 *    見 18 分冊第 15 行、第 229 行、第 433 行）；FAILED＝未成團／導遊取消（18 分冊 §3）。
 *    其餘（COLLECTING 募集中、REVIEW_REQUIRED 待導遊決定、以及出發日還沒到的團次）是「尚未結案」，不進比率。
 *    AT_RISK 在各狀態團數分布中仍照實列出，呈現目前風險。
 *  - 成團率 = 已成團（FORMED＋AT_RISK）÷ 已結案；未達門檻率 = 已結案 FAILED ÷ 已結案；分母 0 → null。1 位小數。
 *  - 團次本身的 status（OPEN／CLOSED／CANCELLED，0066）與 formation_status 是兩條獨立的軸：
 *      · CANCELLED 且 FAILED ＝ 導遊決策取消 → 算「未成團」（已結案，進分母）；
 *      · CANCELLED 且 FORMED ＝ 已成團後才取消（颱風等；18 分冊 §3 兩軸獨立、TOUR_CANCELLED_AFTER_FORMED）
 *        → 成團結果保留，照一般規則：出發日已到即算已結案、已成團。
 *      · CANCELLED 且 formation_status 為 COLLECTING／REVIEW_REQUIRED ＝ 尚未做出成團決策就取消 →
 *        「已取消（未經成團決策）」，單獨計數，不進成團率／未達門檻率的分子與分母，也不算「尚未結案」。
 *        不推測它是成團失敗。
 *      · AT_RISK 只會發生在 FORMED 之後（18 分冊 §3 第 15、229 行：成團後人數跌破門檻才進 AT_RISK），
 *        代表成團承諾早已做過，故 CANCELLED＋AT_RISK 不歸「未經成團決策」，與未取消的 AT_RISK 同樣處理：
 *        出發日已到即算已成團（已結案、進分子），分布仍標示 AT_RISK。
 *  - 各 formation_status 的團數：期間內全部團次的分布（不分是否結案；不含「已取消（未經成團決策）」），供對照。
 *  - 上一期：與本期等長、緊接在前，用同一個「今天」；比較以百分點（pointDiff）。
 *  - 這是「目前的成團狀態」：formation_status 沒有歷史快照，所以數字反映讀取當下的狀態，不是當時的狀態。
 */
export const FORMATION_STATUSES = ['COLLECTING', 'FORMED', 'REVIEW_REQUIRED', 'AT_RISK', 'FAILED'] as const;
export type FormationStatus = (typeof FORMATION_STATUSES)[number];

/** trip_departures 讀回的列（只取成團表現需要的欄位） */
export type GuideDepartureRow = {
  id: string;
  /** YYYY-MM-DD（店家日曆日） */
  departs_on: string;
  formation_status: string;
  /** trip_departures.status（OPEN／CLOSED／CANCELLED）；未提供視為未取消 */
  status?: string;
};

export type GuideFormationSummary = {
  /** 期間內全部團次（已知成團狀態者），= byStatus 合計 + cancelledUndecided */
  total: number;
  byStatus: Record<FormationStatus, number>;
  /** 已結案（出發日已到且 FORMED／AT_RISK／FAILED） */
  concluded: number;
  /** 已成團（含 AT_RISK：成團承諾未撤銷） */
  formed: number;
  /** 已成團中，目前狀態為 AT_RISK（成團後人數不足）的團數；formed 已含這些 */
  formedAtRisk: number;
  failed: number;
  /** 已取消（status = CANCELLED）且 formation_status 為 COLLECTING／REVIEW_REQUIRED：未經成團決策，不進比率、不算尚未結案 */
  cancelledUndecided: number;
  /** total − concluded − cancelledUndecided：尚未結案 */
  open: number;
  /** formed ÷ concluded × 100（1 位小數）；分母 0 → null */
  successRatePercent: number | null;
  /** failed ÷ concluded × 100（1 位小數）；分母 0 → null */
  failRatePercent: number | null;
};

export type GuideFormation = {
  summary: GuideFormationSummary;
  previous: GuideFormationSummary;
  /** 百分點差（本期 − 上一期，1 位小數）；任一期無已結案團次 → null */
  successRatePoints: number | null;
  failRatePoints: number | null;
  /** true＝團次筆數達上限，數字可能不完整 */
  truncated: boolean;
};

/** 尚未做出成團決策的 formation_status（AT_RISK 只發生在 FORMED 之後，不在其中） */
const UNDECIDED_STATUSES: readonly string[] = ['COLLECTING', 'REVIEW_REQUIRED'];
const round1 = (n: number) => Math.round(n * 10) / 10;
const isStatus = (s: string): s is FormationStatus => (FORMATION_STATUSES as readonly string[]).includes(s);

export function summarizeFormation(
  rows: GuideDepartureRow[], from: string, to: string, today: string,
): GuideFormationSummary {
  const byStatus = Object.fromEntries(FORMATION_STATUSES.map((k) => [k, 0])) as Record<FormationStatus, number>;
  let total = 0;
  let formed = 0;
  let formedAtRisk = 0;
  let failed = 0;
  let cancelledUndecided = 0;
  for (const r of rows) {
    if (r.departs_on < from || r.departs_on > to || !isStatus(r.formation_status)) continue;
    total += 1;
    if (r.status === 'CANCELLED' && UNDECIDED_STATUSES.includes(r.formation_status)) { cancelledUndecided += 1; continue; }
    byStatus[r.formation_status] += 1;
    if (r.departs_on <= today) {
      if (r.formation_status === 'FORMED' || r.formation_status === 'AT_RISK') formed += 1;
      if (r.formation_status === 'AT_RISK') formedAtRisk += 1;
      else if (r.formation_status === 'FAILED') failed += 1;
    }
  }
  const concluded = formed + failed;
  return {
    total, byStatus, concluded, formed, formedAtRisk, failed, cancelledUndecided, open: total - concluded - cancelledUndecided,
    successRatePercent: concluded > 0 ? round1((formed / concluded) * 100) : null,
    failRatePercent: concluded > 0 ? round1((failed / concluded) * 100) : null,
  };
}

export function computeFormation(input: {
  rows: GuideDepartureRow[];
  from: string; to: string; prevFrom: string; prevTo: string;
  today: string;
  truncated?: boolean;
}): GuideFormation {
  const summary = summarizeFormation(input.rows, input.from, input.to, input.today);
  const previous = summarizeFormation(input.rows, input.prevFrom, input.prevTo, input.today);
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : round1(a - b));
  return {
    summary, previous,
    successRatePoints: diff(summary.successRatePercent, previous.successRatePercent),
    failRatePoints: diff(summary.failRatePercent, previous.failRatePercent),
    truncated: input.truncated === true,
  };
}
