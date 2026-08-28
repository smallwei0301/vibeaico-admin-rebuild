import { describe, expect, it } from 'vitest';

import { calculateGuideOrderMetrics } from '@/server/guide-reporting';

describe('calculateGuideOrderMetrics', () => {
  it('uses net money actually received and excludes cancelled or fully-refunded orders from average-order denominator', () => {
    const metrics = calculateGuideOrderMetrics([
      {
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paidAmount: 1_000,
        refundedAmount: 0,
        enteredPaymentStage: true,
        unpaidExpired: false,
        cancellationKind: null,
      },
      {
        status: 'CONFIRMED',
        paymentStatus: 'PARTIAL',
        paidAmount: 300,
        refundedAmount: 0,
        enteredPaymentStage: true,
        unpaidExpired: false,
        cancellationKind: null,
      },
      {
        status: 'CANCELLED',
        paymentStatus: 'REFUND_PENDING',
        paidAmount: 600,
        refundedAmount: 100,
        enteredPaymentStage: true,
        unpaidExpired: false,
        cancellationKind: 'TRAVELER',
      },
      {
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
        paidAmount: 800,
        refundedAmount: 800,
        enteredPaymentStage: true,
        unpaidExpired: false,
        cancellationKind: 'GUIDE',
      },
    ]);

    expect(metrics.collectedRevenue).toBe(1_800);
    expect(metrics.effectivePaidOrderCount).toBe(2);
    expect(metrics.averageOrderValue).toBe(650);
  });

  it('keeps cancellation causes separate and uses all orders as the explicit denominator', () => {
    const metrics = calculateGuideOrderMetrics([
      { status: 'CONFIRMED', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: false, unpaidExpired: false, cancellationKind: null },
      { status: 'CANCELLED', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: false, cancellationKind: 'TRAVELER' },
      { status: 'CANCELLED', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: false, cancellationKind: 'GUIDE' },
      { status: 'CANCELLED', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: true, cancellationKind: 'SYSTEM_EXPIRED' },
      { status: 'CANCELLED', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: false, unpaidExpired: false, cancellationKind: 'OTHER' },
    ]);

    expect(metrics.cancellations).toEqual({
      denominator: 5,
      total: 4,
      rate: 80,
      traveler: 1,
      guide: 1,
      systemExpired: 1,
      other: 1,
    });
  });

  it('defines unpaid rate, half-up rounding, and empty denominators without fake zero values', () => {
    const metrics = calculateGuideOrderMetrics([
      { status: 'CANCELLED', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: true, cancellationKind: 'SYSTEM_EXPIRED' },
      { status: 'CONFIRMED', paymentStatus: 'PAID', paidAmount: 500, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: false, cancellationKind: null },
      { status: 'PENDING', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: false, unpaidExpired: false, cancellationKind: null },
    ]);

    expect(metrics.unpaid).toEqual({ denominator: 2, expired: 1, rate: 50 });

    const rounded = calculateGuideOrderMetrics([
      { status: 'CANCELLED', paymentStatus: 'UNPAID', paidAmount: 0, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: true, cancellationKind: 'SYSTEM_EXPIRED' },
      { status: 'CONFIRMED', paymentStatus: 'PAID', paidAmount: 100, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: false, cancellationKind: null },
      { status: 'CONFIRMED', paymentStatus: 'PAID', paidAmount: 100, refundedAmount: 0, enteredPaymentStage: true, unpaidExpired: false, cancellationKind: null },
    ]);
    expect(rounded.unpaid.rate).toBe(33.3);

    expect(calculateGuideOrderMetrics([])).toEqual({
      orderCount: 0,
      orderStatusCounts: { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 },
      collectedRevenue: null,
      effectivePaidOrderCount: 0,
      averageOrderValue: null,
      cancellations: {
        denominator: 0,
        total: 0,
        rate: null,
        traveler: 0,
        guide: 0,
        systemExpired: 0,
        other: 0,
      },
      unpaid: { denominator: 0, expired: 0, rate: null },
    });
  });

  it('reports the order-status distribution and rejects facts that could corrupt a rate or cause', () => {
    const fact = { status: 'PENDING' as const, paymentStatus: 'UNPAID' as const, paidAmount: 0, refundedAmount: 0, enteredPaymentStage: false, unpaidExpired: false, cancellationKind: null };
    expect(calculateGuideOrderMetrics([fact]).orderStatusCounts).toEqual({ PENDING: 1, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 });
    expect(() => calculateGuideOrderMetrics([{ ...fact, status: 'CANCELLED', cancellationKind: null }])).toThrow(/cancellationKind/);
    expect(() => calculateGuideOrderMetrics([{ ...fact, status: 'CANCELLED', cancellationKind: 'SYSTEM_EXPIRED', unpaidExpired: true }])).toThrow(/unpaidExpired/);
    expect(() => calculateGuideOrderMetrics([{ ...fact, paidAmount: 100, refundedAmount: 101 }])).toThrow(/refundedAmount/);
  });
});
