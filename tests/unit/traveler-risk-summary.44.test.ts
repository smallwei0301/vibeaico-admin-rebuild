import { describe, expect, it } from 'vitest';
import { summarizeTravelerRiskFacts } from '@/server/traveler-risk-summary';

describe('summarizeTravelerRiskFacts (#44 客觀履約風險)', () => {
  it('分開計算每一種可查證結果，並回傳最近發生時間', () => {
    expect(summarizeTravelerRiskFacts([
      { kind: 'COMPLETED', occurredAt: '2026-08-01T10:00:00.000Z' },
      { kind: 'CANCELLED', actor: 'TRAVELER', occurredAt: '2026-08-02T10:00:00.000Z' },
      { kind: 'CANCELLED', actor: 'GUIDE', occurredAt: '2026-08-03T10:00:00.000Z' },
      { kind: 'CANCELLED', actor: 'SYSTEM', occurredAt: '2026-08-04T10:00:00.000Z' },
      { kind: 'NO_SHOW', occurredAt: '2026-08-05T10:00:00.000Z' },
      { kind: 'UNPAID_EXPIRED', occurredAt: '2026-08-06T10:00:00.000Z' },
      { kind: 'REFUND_PENDING', occurredAt: '2026-08-07T10:00:00.000Z' },
      { kind: 'REFUND_DISPUTED', occurredAt: '2026-08-08T10:00:00.000Z' },
    ])).toEqual({
      completed: 1,
      travelerCancelled: 1,
      operatorOrSystemCancelled: 2,
      noShow: 1,
      unpaidExpired: 1,
      refundPendingOrDisputed: 2,
      lastOccurredAt: '2026-08-08T10:00:00.000Z',
    });
  });

  it('原因未知的取消不猜成旅客或工作室取消', () => {
    const summary = summarizeTravelerRiskFacts([
      { kind: 'CANCELLED', actor: 'UNKNOWN', occurredAt: '2026-08-09T10:00:00.000Z' },
    ]);

    expect(summary.travelerCancelled).toBe(0);
    expect(summary.operatorOrSystemCancelled).toBe(0);
    expect(summary).not.toHaveProperty('unclassifiedCancellation');
  });

  it('待退款與退款爭議絕不誤算成爽約', () => {
    const summary = summarizeTravelerRiskFacts([
      { kind: 'REFUND_PENDING', occurredAt: '2026-08-10T10:00:00.000Z' },
      { kind: 'REFUND_DISPUTED', occurredAt: '2026-08-11T10:00:00.000Z' },
    ]);

    expect(summary.refundPendingOrDisputed).toBe(2);
    expect(summary.noShow).toBe(0);
  });

  it('沒有事件時各分類為零且沒有最近時間', () => {
    expect(summarizeTravelerRiskFacts([])).toEqual({
      completed: 0,
      travelerCancelled: 0,
      operatorOrSystemCancelled: 0,
      noShow: 0,
      unpaidExpired: 0,
      refundPendingOrDisputed: 0,
      lastOccurredAt: null,
    });
  });
});
