import { describe, expect, it } from 'vitest';
import {
  FormationDecisionError, buildContinuePatch, buildExtendPatch, buildFormPatch, effectiveParticipants, formationDecisionSchema, type ParticipantOrderRow,
} from '@/lib/departure-formation-decision';

const o = (x: Partial<ParticipantOrderRow>): ParticipantOrderRow => ({
  status: 'CONFIRMED', party_size: 1, paid_amount: 0, upfront_required_amount: 0, deposit_mode_snapshot: null, ...x,
});

describe('effectiveParticipants（有效成團人數，18 §5）', () => {
  it('依收款政策計入：FULL／DEPOSIT 要實收 ≥ 頭期款且 > 0；NONE 要已成立；已取消不算', () => {
    expect(effectiveParticipants([
      o({ deposit_mode_snapshot: 'FULL', party_size: 2, paid_amount: 2560, upfront_required_amount: 2560 }), // +2
      o({ deposit_mode_snapshot: 'FULL', party_size: 3, paid_amount: 1000, upfront_required_amount: 3840 }), // 未付足 → 0
      o({ deposit_mode_snapshot: 'DEPOSIT_FIXED', party_size: 4, paid_amount: 500, upfront_required_amount: 500 }), // +4
      o({ deposit_mode_snapshot: 'DEPOSIT_PERCENT', party_size: 1, paid_amount: 0, upfront_required_amount: 0 }), // 沒實收 → 0
      o({ deposit_mode_snapshot: 'NONE', party_size: 5, status: 'CONFIRMED' }), // +5
      o({ deposit_mode_snapshot: 'NONE', party_size: 6, status: 'PENDING' }), // 未成立 → 0
      o({ deposit_mode_snapshot: 'FULL', party_size: 7, status: 'CANCELLED', paid_amount: 100, upfront_required_amount: 100 }), // 取消 → 0
    ])).toBe(11);
  });

  it('沒有收款政策快照（舊訂單）：只有已成立且有實收才算，不猜測', () => {
    expect(effectiveParticipants([
      o({ party_size: 2, status: 'COMPLETED', paid_amount: 100 }), // +2
      o({ party_size: 3, status: 'CONFIRMED', paid_amount: 0 }),   // 0
      o({ party_size: 4, status: 'PENDING', paid_amount: 100 }),   // 0
    ])).toBe(2);
  });

  it('字串數字（numeric）也能算；沒有訂單 → 0', () => {
    expect(effectiveParticipants([o({ deposit_mode_snapshot: 'FULL', party_size: '3', paid_amount: '900.00', upfront_required_amount: '900' })])).toBe(3);
    expect(effectiveParticipants([])).toBe(0);
  });
});

describe('effectiveParticipants — 退款（net paid）', () => {
  it('淨實收＝實收−已退；部分退款後低於頭期款不算；退款處理中／已退款不論訂單狀態都不算', () => {
    expect(effectiveParticipants([
      o({ deposit_mode_snapshot: 'FULL', party_size: 2, paid_amount: 1000, refunded_amount: 0, upfront_required_amount: 1000, payment_status: 'PAID' }), // +2
      o({ deposit_mode_snapshot: 'FULL', party_size: 3, paid_amount: 1000, refunded_amount: 200, upfront_required_amount: 1000, payment_status: 'PAID' }), // 淨 800 < 1000 → 0
      o({ deposit_mode_snapshot: 'DEPOSIT_FIXED', party_size: 4, paid_amount: 1000, refunded_amount: 400, upfront_required_amount: 500, payment_status: 'PARTIAL' }), // 淨 600 ≥ 500 → +4
      o({ deposit_mode_snapshot: 'FULL', party_size: 5, paid_amount: 1000, refunded_amount: 1000, upfront_required_amount: 1000, payment_status: 'PAID' }), // 淨 0 → 0
      o({ deposit_mode_snapshot: 'FULL', party_size: 6, paid_amount: 1000, upfront_required_amount: 1000, payment_status: 'REFUND_PENDING' }), // 0
      o({ deposit_mode_snapshot: 'FULL', party_size: 7, paid_amount: 1000, upfront_required_amount: 1000, payment_status: 'REFUNDED' }), // 0
      o({ deposit_mode_snapshot: 'NONE', party_size: 8, status: 'CONFIRMED', payment_status: 'REFUND_PENDING' }), // NONE 也排除 → 0
      o({ deposit_mode_snapshot: 'NONE', party_size: 1, status: 'CONFIRMED', payment_status: 'UNPAID' }), // NONE 不看付款 → +1
    ])).toBe(7);
  });

  it('舊單（無快照）也套用同樣的退款排除，且以淨實收判斷', () => {
    expect(effectiveParticipants([
      o({ party_size: 2, status: 'COMPLETED', paid_amount: 100, refunded_amount: 0 }),                       // +2
      o({ party_size: 3, status: 'COMPLETED', paid_amount: 100, refunded_amount: 100 }),                     // 淨 0 → 0
      o({ party_size: 4, status: 'CONFIRMED', paid_amount: 100, payment_status: 'REFUND_PENDING' }),         // 0
      o({ party_size: 5, status: 'CONFIRMED', paid_amount: 100, payment_status: 'REFUNDED', refunded_amount: 100 }), // 0
    ])).toBe(2);
  });
});

describe('buildFormPatch（仍然成團）', () => {
  it('欄位組合滿足 0107 的證據 CHECK：FORMED＋formed_at＋formed_by=GUIDE_OVERRIDE＋formed_participants≥1＋決策證據', () => {
    const p = buildFormPatch(3, 'user-1', '2026-10-07T00:00:00.000Z');
    expect(p).toEqual({
      formation_status: 'FORMED', formed_at: '2026-10-07T00:00:00.000Z', formed_by: 'GUIDE_OVERRIDE', formed_participants: 3,
      formation_decided_at: '2026-10-07T00:00:00.000Z', formation_decided_by: 'user-1',
    });
  });
  it('有效人數 0（違反 formed_participants ≥ 1）→ 400，不寫入', () => {
    expect(() => buildFormPatch(0, 'u', 'x')).toThrowError(/沒有有效報名/);
    expect(() => buildFormPatch(0, 'u', 'x')).toThrowError(FormationDecisionError);
  });
});

describe('buildExtendPatch（延長募集）', () => {
  // 出發 2026-12-20 09:00（Asia/Taipei）；舊截止 2026-12-10T00:00Z；現在 2026-12-12T00:00Z
  const cur = { departs_on: '2026-12-20', start_time: '09:00:00', formation_deadline_at: '2026-12-10T00:00:00.000Z' };
  const now = Date.parse('2026-12-12T00:00:00Z');
  const run = (d: string) => buildExtendPatch(cur, d, 'Asia/Taipei', 'user-1', now);

  it('合法：回 COLLECTING、截止時間正規化為 ISO、記決策證據', () => {
    expect(run('2026-12-15T18:00:00+08:00')).toEqual({
      formation_status: 'COLLECTING', formation_deadline_at: '2026-12-15T10:00:00.000Z',
      formation_decided_at: '2026-12-12T00:00:00.000Z', formation_decided_by: 'user-1',
    });
    // 剛好等於出發時間（台北 12/20 09:00 = 01:00Z）允許
    expect(run('2026-12-20T09:00:00+08:00').formation_deadline_at).toBe('2026-12-20T01:00:00.000Z');
  });

  it.each([
    ['沒有時區', '2026-12-15T18:00:00'],
    ['無效字串', 'next week'],
    ['早於現在', '2026-12-11T00:00:00Z'],
    ['晚於出發時間（店家時區）', '2026-12-20T09:00:01+08:00'],
  ])('%s → 400', (_n, v) => {
    expect(() => run(v)).toThrowError(FormationDecisionError);
  });

  it('不晚於目前截止時間（但晚於現在）→ 400', () => {
    const early = { ...cur, formation_deadline_at: '2026-12-16T00:00:00.000Z' };
    expect(() => buildExtendPatch(early, '2026-12-15T00:00:00Z', 'Asia/Taipei', 'u', now)).toThrowError(/晚於目前的截止時間/);
  });
});

describe('formationDecisionSchema', () => {
  it('FORM 不帶其他欄位；EXTEND 必須帶 newDeadline；未知決策與多餘欄位拒絕', () => {
    expect(formationDecisionSchema.safeParse({ decision: 'FORM' }).success).toBe(true);
    expect(formationDecisionSchema.safeParse({ decision: 'EXTEND', newDeadline: '2026-12-15T18:00:00+08:00' }).success).toBe(true);
    expect(formationDecisionSchema.safeParse({ decision: 'EXTEND' }).success).toBe(false);
    expect(formationDecisionSchema.safeParse({ decision: 'FORM', newDeadline: 'x' }).success).toBe(false);
    expect(formationDecisionSchema.safeParse({ decision: 'CANCEL' }).success).toBe(false);
    expect(formationDecisionSchema.safeParse({}).success).toBe(false);
  });
});

describe('buildContinuePatch（繼續出團）', () => {
  it('只含狀態與決策證據，不含任何成團證據欄位或金額欄位', () => {
    const p = buildContinuePatch('user-1', '2026-10-07T00:00:00.000Z');
    expect(p).toEqual({ formation_status: 'FORMED', formation_decided_at: '2026-10-07T00:00:00.000Z', formation_decided_by: 'user-1' });
    for (const k of ['formed_at', 'formed_by', 'formed_participants', 'total_amount', 'balance_due']) expect(p).not.toHaveProperty(k);
  });
  it('schema：CONTINUE 不帶其他欄位', () => {
    expect(formationDecisionSchema.safeParse({ decision: 'CONTINUE' }).success).toBe(true);
    expect(formationDecisionSchema.safeParse({ decision: 'CONTINUE', newDeadline: 'x' }).success).toBe(false);
  });
});

