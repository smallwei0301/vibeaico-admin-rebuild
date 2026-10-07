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
 *    出發日還沒到的團次（任何狀態）是「尚未結案」，不進比率。
 *    出發日已過（< 今天）、未取消、formation_status 仍是 COLLECTING／REVIEW_REQUIRED 的團次＝「無最終成團結果」（undecidedPast；欄位名保留）：
 *    此類不等於「從未決策」：導遊決策 EXTEND（延長募集）後團次回到 COLLECTING 並保留 formation_decided_at，出發日過了仍未成團／未產生最終結果者也歸此類。
 *    0107 新增 formation_status 時 NOT NULL DEFAULT 'COLLECTING' 且未回填歷史，成團功能上線前就建立的團次會帶著這個預設值，
 *    不能把 migration default 當成真實狀態，更不能說它「還在募集中」。0107 沒有可靠的 legacy 標記
 *    （formation_deadline_at、formation_decided_at 對舊列為 NULL，但新團次也可能為 NULL；min_to_depart_snapshot 預設 1 無法區分），
 *    且不得依賴 0108 之後才有的欄位，所以只用「出發日已過＋仍無決策」判定。這些團次不進比率分子分母，也不算尚未結案，另行單獨計數。
 *    AT_RISK 在各狀態團數分布中仍照實列出，呈現目前風險。
 *  - 成團率 = 已成團（FORMED＋AT_RISK）÷ 已結案；未達門檻率 = 已結案 FAILED ÷ 已結案；分母 0 → null。1 位小數。
 *  - 團次本身的 status（OPEN／CLOSED／CANCELLED，0066）與 formation_status 是兩條獨立的軸：
 *      · CANCELLED 且 FAILED ＝ 導遊決策取消 → 算「未成團」（已結案，進分母）；
 *      · CANCELLED 且 FORMED ＝ 已成團後才取消（颱風等；18 分冊 §3 兩軸獨立、TOUR_CANCELLED_AFTER_FORMED）
 *        → 成團結果保留，照一般規則：出發日已到即算已結案、已成團。
 *      · CANCELLED 且 formation_status 為 COLLECTING／REVIEW_REQUIRED ＝ 尚未做出成團決策就取消 →
 *        「已取消（未有最終成團結果）」，單獨計數（cancelledUndecided；EXTEND 後仍 COLLECTING 即被取消者亦同），不進成團率／未達門檻率的分子與分母，也不算「尚未結案」。
 *        不推測它是成團失敗。
 *      · AT_RISK 只會發生在 FORMED 之後（18 分冊 §3 第 15、229 行：成團後人數跌破門檻才進 AT_RISK），
 *        代表成團承諾早已做過，故 CANCELLED＋AT_RISK 不歸「未有最終成團結果」，與未取消的 AT_RISK 同樣處理：
 *        出發日已到即算已成團（已結案、進分子），分布仍標示 AT_RISK。
 *  - 各 formation_status 的團數：期間內全部團次的分布（不分是否結案；不含「已取消（未有最終成團結果）」與「無最終成團結果」，
 *    這兩類另列，所以分布的 COLLECTING／REVIEW_REQUIRED 只剩出發日未到者），供對照。
 *  - 不變式（summarizeFormation 的測試逐條鎖定）：
 *      total = Σ byStatus + cancelledUndecided + undecidedPast
 *      total = concluded + open + cancelledUndecided + undecidedPast
 *      concluded = formed + failed；open ＝ 尚未結案：出發日未到，或今天出發仍待決策（且非未經決策取消）的團次。
 *  - 上一期：與本期等長、緊接在前，用同一個「今天」；比較以百分點（pointDiff）。
 *  - 資料可用性（availability）：正式團次建立時 departureFormationSnapshot() 只寫 COLLECTING（migration 預設值），
 *    轉態目前由人工決策 API 寫入（#825，POST /api/trip-departures/[id]/formation-decision，FORM／EXTEND／CONTINUE）；
 *    自動轉態（成團截止排程）尚未上線，因此仍可能出現「尚無任何決策紀錄」的期間。
 *    若本期與上一期查到的團次「全部」仍是 COLLECTING 且都沒有 formation_decided_at，沒有任何成團決策紀錄，比率只會是算不出的空值，卡片就誠實顯示 NOT_TRACKED。
 *    判斷訊號有兩個，任一成立即 TRACKED：(1) formation_status 出現過 COLLECTING 以外的值（REVIEW_REQUIRED 也算，代表轉態機制已在運作）；
 *    (2) formation_decided_at 非空：#825 的導遊決策 EXTEND（延長募集）會把 REVIEW_REQUIRED 改回 COLLECTING，但仍寫入 formation_decided_at，
 *    若只看 formation_status，全部經 EXTEND 回到 COLLECTING 的期間會被誤判成「尚未追蹤」。
 *    0107 的 formed_evidence_ck 只約束 FORMED／AT_RISK 須有 formed_at／formed_by／formed_participants，不約束 formation_decided_at。
 *    欄位缺失（mock 或舊資料）視為 null。一旦出現第一筆決策紀錄就自動恢復為 TRACKED。
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
  /** 0107 formation_decided_at（ISO 時間戳）；#825 的 EXTEND 會讓 formation_status 回到 COLLECTING 但保留此欄；未提供視為 null */
  formation_decided_at?: string | null;
  /** trip_departures.status（OPEN／CLOSED／CANCELLED）；未提供視為未取消 */
  status?: string;
};

export type GuideFormationSummary = {
  /** 期間內全部團次（已知成團狀態者），= byStatus 合計 + cancelledUndecided + undecidedPast */
  total: number;
  byStatus: Record<FormationStatus, number>;
  /** 已結案（出發日已到且 FORMED／AT_RISK／FAILED） */
  concluded: number;
  /** 已成團（含 AT_RISK：成團承諾未撤銷） */
  formed: number;
  /** 已成團中，目前狀態為 AT_RISK（成團後人數不足）的團數；formed 已含這些 */
  formedAtRisk: number;
  failed: number;
  /** 已取消（status = CANCELLED）且 formation_status 為 COLLECTING／REVIEW_REQUIRED：未有最終成團結果（含 EXTEND 後仍 COLLECTING 者），不進比率、不算尚未結案 */
  cancelledUndecided: number;
  /**
   * 出發日已過（< 店家今天）、未取消、formation_status 仍為 COLLECTING／REVIEW_REQUIRED：無最終成團結果
   * （例如成團功能上線前建立的團次，migration 預設值 COLLECTING 不是真實狀態；或 EXTEND 延長募集後仍 COLLECTING、formation_decided_at 非空者）。不進比率、不算尚未結案。
   */
  undecidedPast: number;
  /** total − concluded − cancelledUndecided − undecidedPast：尚未結案（出發日未到，或今天出發仍待成團決策） */
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
  /**
   * TRACKED＝本期或上一期至少一團有成團決策紀錄（formation_status 不是 COLLECTING，或 formation_decided_at 非空）；
   * NOT_TRACKED＝全部仍是 COLLECTING 且無 formation_decided_at（沒有任何決策紀錄；兩期皆 0 團時亦同），比率與分布沒有意義；卡片模式由 formationCardMode 決定（本期 0 團優先 EMPTY）。
   */
  availability: FormationAvailability;
};

export type FormationAvailability = 'TRACKED' | 'NOT_TRACKED';

/** 成團卡的呈現模式（純函式，供元件與測試共用） */
export type FormationCardMode = 'UNAVAILABLE' | 'NOT_TRACKED' | 'EMPTY' | 'SHOWN';
export function formationCardMode(fm: GuideFormation | null): FormationCardMode {
  if (!fm) return 'UNAVAILABLE';
  // 本期沒有團次就是誠實的「這段期間沒有出發的團次」，優先於 availability（兩期皆 0 團時 availability 也是 NOT_TRACKED）
  if (fm.summary.total === 0) return 'EMPTY';
  if (fm.availability === 'NOT_TRACKED') return 'NOT_TRACKED';
  return 'SHOWN';
}
/** 筆數達上限時，整張成團卡（含比率以外的未結案、無決策、各狀態團數）都要有截斷警示 */
export function formationShowsTruncationAlert(fm: GuideFormation | null): boolean {
  return fm !== null && fm.truncated;
}

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
  let undecidedPast = 0;
  for (const r of rows) {
    if (r.departs_on < from || r.departs_on > to || !isStatus(r.formation_status)) continue;
    total += 1;
    if (r.status === 'CANCELLED' && UNDECIDED_STATUSES.includes(r.formation_status)) { cancelledUndecided += 1; continue; }
    if (r.departs_on < today && UNDECIDED_STATUSES.includes(r.formation_status)) { undecidedPast += 1; continue; }
    byStatus[r.formation_status] += 1;
    if (r.departs_on <= today) {
      if (r.formation_status === 'FORMED' || r.formation_status === 'AT_RISK') formed += 1;
      if (r.formation_status === 'AT_RISK') formedAtRisk += 1;
      else if (r.formation_status === 'FAILED') failed += 1;
    }
  }
  const concluded = formed + failed;
  return {
    total, byStatus, concluded, formed, formedAtRisk, failed, cancelledUndecided, undecidedPast,
    open: total - concluded - cancelledUndecided - undecidedPast,
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
  const tracked = input.rows.some((r) =>
    r.departs_on >= input.prevFrom && r.departs_on <= input.to && isStatus(r.formation_status) && (r.formation_status !== 'COLLECTING' || r.formation_decided_at != null));
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : round1(a - b));
  return {
    summary, previous,
    successRatePoints: diff(summary.successRatePercent, previous.successRatePercent),
    failRatePoints: diff(summary.failRatePercent, previous.failRatePercent),
    truncated: input.truncated === true,
    availability: tracked ? 'TRACKED' : 'NOT_TRACKED',
  };
}
