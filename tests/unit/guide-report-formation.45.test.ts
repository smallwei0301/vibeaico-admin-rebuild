import { describe, expect, it } from 'vitest';
import { computeFormation, summarizeFormation, type GuideDepartureRow } from '@/server/guide-report-formation';
import { computeGuideReport } from '@/server/guide-report';

// 期望值全部手算寫死。本期 2026-10-01～10-10，上一期 09-21～09-30。
const d = (id: string, departs_on: string, formation_status: string, status?: string): GuideDepartureRow => ({ id, departs_on, formation_status, status });
const TODAY = '2026-12-01';
const S = (rows: GuideDepartureRow[], today = TODAY) => summarizeFormation(rows, '2026-10-01', '2026-10-10', today);

describe('summarizeFormation — 期間歸屬', () => {
  it('出發日含兩端；區間外與未知狀態不計', () => {
    const r = S([
      d('a', '2026-10-01', 'FORMED'), d('b', '2026-10-10', 'FAILED'),
      d('c', '2026-09-30', 'FORMED'), d('e', '2026-10-11', 'FORMED'),
      d('f', '2026-10-05', 'WEIRD'),
    ]);
    expect(r.total).toBe(2);
    expect(r.formed).toBe(1);
    expect(r.failed).toBe(1);
  });
});

describe('summarizeFormation — 成團率／未達門檻率', () => {
  it('3 成團、1 AT_RISK（計入已成團）、1 未成團 → 80／20；募集中、待導遊決定且出發日已過者為無決策紀錄、不進比率', () => {
    const r = S([
      d('1', '2026-10-02', 'FORMED'), d('2', '2026-10-03', 'FORMED'), d('3', '2026-10-04', 'FORMED'),
      d('4', '2026-10-05', 'FAILED'),
      d('5', '2026-10-06', 'COLLECTING'), d('6', '2026-10-07', 'REVIEW_REQUIRED'), d('7', '2026-10-08', 'AT_RISK'),
    ]);
    expect(r).toMatchObject({
      total: 7, concluded: 5, formed: 4, formedAtRisk: 1, failed: 1, open: 0, undecidedPast: 2, successRatePercent: 80, failRatePercent: 20,
    });
    expect(r.byStatus).toEqual({ COLLECTING: 0, FORMED: 3, REVIEW_REQUIRED: 0, AT_RISK: 1, FAILED: 1 });
  });

  it('formedAtRisk：只算已結案且 AT_RISK 的團；沒有 AT_RISK 或出發日未到時為 0', () => {
    expect(S([d('1', '2026-10-02', 'FORMED'), d('2', '2026-10-03', 'FAILED')]).formedAtRisk).toBe(0);
    expect(S([d('1', '2026-10-05', 'AT_RISK')], '2026-10-04').formedAtRisk).toBe(0);
    expect(S([d('1', '2026-10-02', 'AT_RISK'), d('2', '2026-10-03', 'AT_RISK', 'CANCELLED'), d('3', '2026-10-04', 'FORMED')]))
      .toMatchObject({ formed: 3, formedAtRisk: 2 });
  });

  it('1 成團、2 未成團 → 33.3／66.7（四捨五入 1 位）', () => {
    const r = S([d('1', '2026-10-02', 'FORMED'), d('2', '2026-10-03', 'FAILED'), d('3', '2026-10-04', 'FAILED')]);
    expect(r.successRatePercent).toBe(33.3);
    expect(r.failRatePercent).toBe(66.7);
  });

  it('分母 0（沒有團次，或只有未結案團次）→ 比率 null，不是 0', () => {
    expect(S([]).successRatePercent).toBeNull();
    const r = S([d('1', '2026-10-02', 'COLLECTING'), d('2', '2026-10-03', 'REVIEW_REQUIRED')]);
    expect(r).toMatchObject({ total: 2, concluded: 0, open: 0, undecidedPast: 2, successRatePercent: null, failRatePercent: null });
    const future = S([d('1', '2026-10-02', 'COLLECTING'), d('2', '2026-10-03', 'REVIEW_REQUIRED')], '2026-10-01');
    expect(future).toMatchObject({ total: 2, concluded: 0, open: 2, undecidedPast: 0, successRatePercent: null });
  });

  it('出發日還沒到的 FORMED／FAILED 不算已結案（今天含當天算已到）', () => {
    const rows = [d('1', '2026-10-05', 'FORMED'), d('2', '2026-10-06', 'FAILED'), d('3', '2026-10-07', 'FORMED')];
    expect(S(rows, '2026-10-04')).toMatchObject({ total: 3, concluded: 0, open: 3 });
    expect(S(rows, '2026-10-05')).toMatchObject({ concluded: 1, formed: 1, failed: 0 });
    expect(S(rows, '2026-10-06')).toMatchObject({ concluded: 2, formed: 1, failed: 1, successRatePercent: 50 });
  });
});

describe('computeFormation — 上一期比較與截斷', () => {
  it('百分點差：本期 75、上一期 50 → +25；任一期無已結案 → null', () => {
    const rows = [
      d('1', '2026-10-02', 'FORMED'), d('2', '2026-10-03', 'FORMED'), d('3', '2026-10-04', 'FORMED'), d('4', '2026-10-05', 'FAILED'),
      d('5', '2026-09-22', 'FORMED'), d('6', '2026-09-23', 'FAILED'),
    ];
    const base = { rows, from: '2026-10-01', to: '2026-10-10', prevFrom: '2026-09-21', prevTo: '2026-09-30', today: TODAY };
    const r = computeFormation(base);
    expect(r.previous).toMatchObject({ concluded: 2, successRatePercent: 50 });
    expect(r.successRatePoints).toBe(25);
    expect(r.failRatePoints).toBe(-25);
    expect(computeFormation({ ...base, rows: rows.slice(0, 4) }).successRatePoints).toBeNull();
    expect(computeFormation({ ...base, truncated: true }).truncated).toBe(true);
    expect(computeFormation(base).truncated).toBe(false);
  });
});

describe('computeGuideReport — 「今天」依店家時區與 asOf 決定', () => {
  const dep = [d('x', '2026-10-07', 'FORMED')];
  const run = (timeZone: string, asOf: string) => computeGuideReport({
    rows: [], from: '2026-10-01', to: '2026-10-07', timeZone, asOf,
    tripNames: new Map(), planNames: new Map(), departures: dep,
  }).formation!.summary;

  it('同一個 asOf：台北已是 10/07（團次已結案）、紐約仍是 10/06（尚未結案）', () => {
    const asOf = '2026-10-06T17:00:00.000Z'; // 台北 10/07 01:00；紐約 10/06 13:00
    expect(run('Asia/Taipei', asOf)).toMatchObject({ concluded: 1, formed: 1, open: 0 });
    expect(run('America/New_York', asOf)).toMatchObject({ concluded: 0, open: 1 });
  });

  it('沒有提供 departures 時成團表現為空、比率 null（不捏造）', () => {
    const r = computeGuideReport({
      rows: [], from: '2026-10-01', to: '2026-10-07', timeZone: 'Asia/Taipei', asOf: '2026-12-01T00:00:00Z',
      tripNames: new Map(), planNames: new Map(),
    });
    expect(r.formation!.summary).toMatchObject({ total: 0, successRatePercent: null });
  });
});

describe('團次本身取消（status = CANCELLED）與成團狀態是兩條軸', () => {
  it('CANCELLED＋FAILED → 算未成團（已結案、進分母）', () => {
    const r = S([d('1', '2026-10-02', 'FAILED', 'CANCELLED'), d('2', '2026-10-03', 'FORMED', 'OPEN')]);
    expect(r).toMatchObject({ total: 2, concluded: 2, formed: 1, failed: 1, cancelledUndecided: 0, open: 0, successRatePercent: 50 });
  });

  it('CANCELLED＋FORMED 保留成團結果（已結案、進分子）；CANCELLED＋COLLECTING／REVIEW_REQUIRED 才另列、不進分母', () => {
    const r = S([
      d('1', '2026-10-02', 'FORMED', 'CANCELLED'), // 已成團後才取消（颱風）：仍算已成團
      d('2', '2026-10-03', 'COLLECTING', 'CANCELLED'),
      d('3', '2026-10-04', 'REVIEW_REQUIRED', 'CANCELLED'),
      d('4', '2026-10-05', 'FORMED', 'CLOSED'),
      d('5', '2026-10-06', 'COLLECTING', 'OPEN'),
    ]);
    expect(r.cancelledUndecided).toBe(2);
    expect(r).toMatchObject({ total: 5, concluded: 2, formed: 2, failed: 0, open: 0, undecidedPast: 1, successRatePercent: 100, failRatePercent: 0 });
    // 分布不含未經成團決策者與無決策紀錄者：合計 + cancelledUndecided + undecidedPast = total
    expect(r.byStatus).toEqual({ COLLECTING: 0, FORMED: 2, REVIEW_REQUIRED: 0, AT_RISK: 0, FAILED: 0 });
  });

  it('CANCELLED＋AT_RISK：AT_RISK 發生在 FORMED 之後（18 §3），承諾已做過 → 出發日已到即算已成團，分布仍標示 AT_RISK', () => {
    const r = S([d('1', '2026-10-02', 'AT_RISK', 'CANCELLED')]);
    expect(r).toMatchObject({ total: 1, concluded: 1, formed: 1, cancelledUndecided: 0, open: 0, successRatePercent: 100 });
    expect(r.byStatus.AT_RISK).toBe(1);
  });

  it('未取消的 AT_RISK：出發日已到計入已成團（不自動撤銷成團承諾）；出發日未到仍尚未結案', () => {
    const rows = [d('1', '2026-10-05', 'AT_RISK')];
    expect(S(rows, '2026-10-05')).toMatchObject({ concluded: 1, formed: 1, failed: 0, open: 0, successRatePercent: 100 });
    expect(S(rows, '2026-10-04')).toMatchObject({ concluded: 0, formed: 0, open: 1, successRatePercent: null });
    expect(S(rows, '2026-10-05').byStatus.AT_RISK).toBe(1);
  });

  it('CANCELLED＋FORMED 但出發日未到 → 尚未結案（照一般規則）', () => {
    const r = S([d('1', '2026-10-09', 'FORMED', 'CANCELLED')], '2026-10-05');
    expect(r).toMatchObject({ concluded: 0, formed: 0, open: 1, cancelledUndecided: 0 });
  });

  it('只有「已取消（未經成團決策）」的團次 → 比率 null（分母 0），不推測為未成團', () => {
    const r = S([d('1', '2026-10-02', 'COLLECTING', 'CANCELLED')]);
    expect(r).toMatchObject({ total: 1, concluded: 0, cancelledUndecided: 1, open: 0, successRatePercent: null, failRatePercent: null });
  });

  it('沒有提供 status（舊資料）視為未取消', () => {
    expect(S([d('1', '2026-10-02', 'FORMED')])).toMatchObject({ formed: 1, cancelledUndecided: 0 });
  });
});


describe('無成團決策紀錄（出發日已過但仍是 COLLECTING／REVIEW_REQUIRED；migration 預設值不是真實狀態）', () => {
  const rows = [
    d('1', '2026-10-02', 'COLLECTING'), d('2', '2026-10-03', 'REVIEW_REQUIRED'), // 已過、無決策 → undecidedPast
    d('3', '2026-10-05', 'COLLECTING'), d('4', '2026-10-06', 'REVIEW_REQUIRED'), // today=10-04：出發日未到 → 尚未結案
    d('5', '2026-10-04', 'COLLECTING'), // 出發日＝今天（含當天算已到）→ undecidedPast
    d('6', '2026-10-01', 'FORMED'), d('7', '2026-10-01', 'FAILED'),
    d('8', '2026-10-02', 'COLLECTING', 'CANCELLED'), // 未經決策取消優先歸 cancelledUndecided
  ];
  const r = S(rows, '2026-10-04');

  it('不進成團率分子分母、不算尚未結案、不算募集中', () => {
    expect(r).toMatchObject({
      total: 8, concluded: 2, formed: 1, failed: 1, undecidedPast: 3, cancelledUndecided: 1, open: 2,
      successRatePercent: 50, failRatePercent: 50,
    });
    expect(r.byStatus).toEqual({ COLLECTING: 1, FORMED: 1, REVIEW_REQUIRED: 1, AT_RISK: 0, FAILED: 1 });
  });

  it('不變式：total = Σ byStatus + cancelledUndecided + undecidedPast = concluded + open + cancelledUndecided + undecidedPast', () => {
    const sum = Object.values(r.byStatus).reduce((a, b) => a + b, 0);
    expect(r.total).toBe(sum + r.cancelledUndecided + r.undecidedPast);
    expect(r.total).toBe(r.concluded + r.open + r.cancelledUndecided + r.undecidedPast);
  });

  it('只有無決策紀錄的歷史團次 → 比率 null、open 0（不是「還在募集中」）', () => {
    expect(S([d('1', '2026-10-02', 'COLLECTING')])).toMatchObject({ total: 1, undecidedPast: 1, open: 0, concluded: 0, successRatePercent: null });
  });
});
