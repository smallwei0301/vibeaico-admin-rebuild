import { describe, expect, it } from 'vitest';
import { summarizeTravelerRiskFacts } from '@/server/traveler-risk-summary';

describe('summarizeTravelerRiskFacts (#44 客觀履約風險)', () => {
  it('separates each verifiable outcome and returns the latest valid occurrence time', () => {
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
      completed: 1,
      travelerCancelled: 1,
      operatorOrSystemCancelled: 2,
      noShow: 1,
      unpaidExpired: 1,
      refundPendingOrDisputed: 2,
      refunded: 1,
      lastOccurredAt: '2026-08-09T10:00:00.000Z',
    });
  });

  it('does not attribute an unknown cancellation to either party', () => {
    const summary = summarizeTravelerRiskFacts([
      { kind: 'CANCELLED', actor: 'UNKNOWN', occurredAt: '2026-08-09T10:00:00.000Z' },
    ]);

    expect(summary.travelerCancelled).toBe(0);
    expect(summary.operatorOrSystemCancelled).toBe(0);
    expect(summary).not.toHaveProperty('unclassifiedCancellation');
  });

  it('never treats pending, disputed, or refunded outcomes as no-shows', () => {
    const summary = summarizeTravelerRiskFacts([
      { kind: 'REFUND_PENDING', occurredAt: '2026-08-10T10:00:00.000Z' },
      { kind: 'REFUND_DISPUTED', occurredAt: '2026-08-11T10:00:00.000Z' },
      { kind: 'REFUNDED', occurredAt: '2026-08-12T10:00:00.000Z' },
    ]);

    expect(summary.refundPendingOrDisputed).toBe(2);
    expect(summary.refunded).toBe(1);
    expect(summary.noShow).toBe(0);
  });

  it('returns zero facts and no latest occurrence for empty input', () => {
    expect(summarizeTravelerRiskFacts([])).toEqual({
      completed: 0,
      travelerCancelled: 0,
      operatorOrSystemCancelled: 0,
      noShow: 0,
      unpaidExpired: 0,
      refundPendingOrDisputed: 0,
      refunded: 0,
      lastOccurredAt: null,
    });
  });

  it('keeps the first input when the latest valid timestamps are equal', () => {
    expect(summarizeTravelerRiskFacts([
      { kind: 'COMPLETED', occurredAt: '2026-08-20T10:00:00.000Z' },
      { kind: 'NO_SHOW', occurredAt: '2026-08-20T18:00:00.000+08:00' },
    ]).lastOccurredAt).toBe('2026-08-20T10:00:00.000Z');
  });

  it('fails closed by excluding malformed facts from counts and latest selection', () => {
    expect(summarizeTravelerRiskFacts([
      { kind: 'CANCELLED', actor: 'TRAVELER', occurredAt: 'not-a-date' },
      { kind: 'COMPLETED', occurredAt: '2026-99-99T10:00:00.000Z' },
      { kind: 'REFUNDED', occurredAt: '2026-99-99T10:00:00.000Z' },
      { kind: 'NO_SHOW', occurredAt: '2026-08-21T10:00:00.000Z' },
    ])).toEqual({
      completed: 0,
      travelerCancelled: 0,
      operatorOrSystemCancelled: 0,
      noShow: 1,
      unpaidExpired: 0,
      refundPendingOrDisputed: 0,
      refunded: 0,
      lastOccurredAt: '2026-08-21T10:00:00.000Z',
    });
  });
});
