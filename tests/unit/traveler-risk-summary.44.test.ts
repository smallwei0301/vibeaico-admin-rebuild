import { describe, expect, it } from 'vitest';
import { summarizeTravelerRiskFacts, mapTourOrderRowToRiskFact } from '@/server/traveler-risk-summary';
import { TOUR_ORDER_AUTO_EXPIRE_REASON } from '@/server/tour-orders';

describe('summarizeTravelerRiskFacts (#44 factual traveler risk)', () => {
  it('separates verifiable outcomes and returns the latest valid occurrence', () => {
    expect(summarizeTravelerRiskFacts([
      { kind: 'COMPLETED', occurredAt: '2026-08-01T10:00:00.000Z' },
      { kind: 'CANCELLED', actor: 'TRAVELER', occurredAt: '2026-08-02T10:00:00.000Z' },
      { kind: 'CANCELLED', actor: 'GUIDE', occurredAt: '2026-08-03T10:00:00.000Z' },
      { kind: 'CANCELLED', actor: 'SYSTEM', occurredAt: '2026-08-04T10:00:00.000Z' },
      { kind: 'NO_SHOW', occurredAt: '2026-08-05T10:00:00.000Z' },
      { kind: 'UNPAID_EXPIRED', occurredAt: '2026-08-06T10:00:00.000Z' },
      { kind: 'REFUND_PENDING', occurredAt: '2026-08-07T10:00:00.000Z' },
      { kind: 'REFUND_DISPUTED', occurredAt: '2026-08-08T10:00:00.000Z' },
      { kind: 'REFUNDED', occurredAt: '2026-08-09T10:00:00.000Z' },
    ])).toEqual({
      completed: 1, travelerCancelled: 1, operatorOrSystemCancelled: 2,
      noShow: 1, unpaidExpired: 1, refundPendingOrDisputed: 2, refunded: 1,
      lastOccurredAt: '2026-08-09T10:00:00.000Z',
    });
  });

  it('does not attribute unknown cancellations and excludes malformed timestamps', () => {
    expect(summarizeTravelerRiskFacts([
      { kind: 'CANCELLED', actor: 'UNKNOWN', occurredAt: '2026-08-09T10:00:00.000Z' },
      { kind: 'CANCELLED', actor: 'TRAVELER', occurredAt: 'not-a-date' },
      { kind: 'NO_SHOW', occurredAt: '2026-08-10T10:00:00.000Z' },
    ])).toMatchObject({
      travelerCancelled: 0,
      operatorOrSystemCancelled: 0,
      noShow: 1,
      lastOccurredAt: '2026-08-10T10:00:00.000Z',
    });
  });

  it('keeps the first input when valid timestamps are equal', () => {
    expect(summarizeTravelerRiskFacts([
      { kind: 'COMPLETED', occurredAt: '2026-08-20T10:00:00.000Z' },
      { kind: 'NO_SHOW', occurredAt: '2026-08-20T18:00:00.000+08:00' },
    ]).lastOccurredAt).toBe('2026-08-20T10:00:00.000Z');
  });
});

describe('mapTourOrderRowToRiskFact (#44 真實讀取路徑：tour_orders → TravelerRiskFact)', () => {
  const row = (over: Partial<{
    status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    payment_status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED';
    cancel_reason: string | null;
    updated_at: string;
  }> = {}) => ({
    status: 'PENDING' as const,
    payment_status: 'UNPAID' as const,
    cancel_reason: null,
    updated_at: '2026-08-15T09:00:00.000Z',
    ...over,
  });

  it('PENDING/CONFIRMED 尚未終結 → 不產生任何事實', () => {
    expect(mapTourOrderRowToRiskFact(row({ status: 'PENDING' }))).toBeNull();
    expect(mapTourOrderRowToRiskFact(row({ status: 'CONFIRMED' }))).toBeNull();
  });

  it('COMPLETED → COMPLETED 事實，occurredAt 取 updated_at', () => {
    expect(mapTourOrderRowToRiskFact(row({ status: 'COMPLETED', updated_at: '2026-08-16T00:00:00.000Z' })))
      .toEqual({ kind: 'COMPLETED', occurredAt: '2026-08-16T00:00:00.000Z' });
  });

  it('CANCELLED 且 cancel_reason 等於系統逾期標記字串 → UNPAID_EXPIRED（不是 CANCELLED）', () => {
    expect(mapTourOrderRowToRiskFact(row({
      status: 'CANCELLED', cancel_reason: TOUR_ORDER_AUTO_EXPIRE_REASON,
    }))).toEqual({ kind: 'UNPAID_EXPIRED', occurredAt: '2026-08-15T09:00:00.000Z' });
  });

  it('CANCELLED 但 cancel_reason 是其他文字（人工取消）→ CANCELLED，actor 誠實回 UNKNOWN', () => {
    expect(mapTourOrderRowToRiskFact(row({
      status: 'CANCELLED', cancel_reason: '旅客來電表示行程有變',
    }))).toEqual({ kind: 'CANCELLED', actor: 'UNKNOWN', occurredAt: '2026-08-15T09:00:00.000Z' });
  });

  it('CANCELLED 且 cancel_reason 為 null（無註記的舊資料）→ 仍是 CANCELLED/UNKNOWN，不誤判為逾期', () => {
    expect(mapTourOrderRowToRiskFact(row({ status: 'CANCELLED', cancel_reason: null })))
      .toEqual({ kind: 'CANCELLED', actor: 'UNKNOWN', occurredAt: '2026-08-15T09:00:00.000Z' });
  });

  it('payment_status=REFUNDED 一律回 REFUNDED，即使 status 同時是 CANCELLED（不與取消重複計算）', () => {
    expect(mapTourOrderRowToRiskFact(row({
      status: 'CANCELLED', payment_status: 'REFUNDED', cancel_reason: TOUR_ORDER_AUTO_EXPIRE_REASON,
    }))).toEqual({ kind: 'REFUNDED', occurredAt: '2026-08-15T09:00:00.000Z' });
  });

  it('payment_status=REFUNDED 且 status=COMPLETED → 仍回 REFUNDED，不回 COMPLETED', () => {
    expect(mapTourOrderRowToRiskFact(row({ status: 'COMPLETED', payment_status: 'REFUNDED' })))
      .toEqual({ kind: 'REFUNDED', occurredAt: '2026-08-15T09:00:00.000Z' });
  });

  /*
   * #41 0108 之後 tour_payment_status 補上 REFUND_PENDING，這裡是回歸測試：
   * Final Risk（claude-fable-5-1，2026-09-14）指出修正前 REFUND_PENDING 搭配
   * status=CANCELLED 會落進 CANCELLED 分支，退款中的事實遺失。
   */
  it('payment_status=REFUND_PENDING 且 status=CANCELLED → 回 REFUND_PENDING，不回 CANCELLED', () => {
    expect(mapTourOrderRowToRiskFact(row({
      status: 'CANCELLED', payment_status: 'REFUND_PENDING', cancel_reason: TOUR_ORDER_AUTO_EXPIRE_REASON,
    }))).toEqual({ kind: 'REFUND_PENDING', occurredAt: '2026-08-15T09:00:00.000Z' });
  });

  it('payment_status=REFUND_PENDING 且 status=COMPLETED → 仍回 REFUND_PENDING，不回 COMPLETED', () => {
    expect(mapTourOrderRowToRiskFact(row({ status: 'COMPLETED', payment_status: 'REFUND_PENDING' })))
      .toEqual({ kind: 'REFUND_PENDING', occurredAt: '2026-08-15T09:00:00.000Z' });
  });
});
