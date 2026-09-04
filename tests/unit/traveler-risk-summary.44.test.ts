import { describe, expect, it } from 'vitest';
import { summarizeTravelerRiskFacts } from '@/server/traveler-risk-summary';

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
