/**
 * Database-independent GUIDE report formulas.
 *
 * The future API adapter is responsible for tenant/date/filter isolation and for
 * projecting persisted order/payment rows into this deliberately small fact.
 */
export type GuideCancellationKind = 'TRAVELER' | 'GUIDE' | 'SYSTEM_EXPIRED' | 'OTHER';

export type GuideReportOrderFact = {
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED';
  /** Cumulative amount whose receipt has been confirmed. */
  paidAmount: number;
  /** Cumulative amount actually refunded, not merely pending refund. */
  refundedAmount: number;
  /** True once the order was asked to pay, including orders that later expired. */
  enteredPaymentStage: boolean;
  /** True only when an entered, still-unpaid order expired before payment. */
  unpaidExpired: boolean;
  cancellationKind: GuideCancellationKind | null;
};

type Rate = number | null;

export type GuideOrderMetrics = {
  orderCount: number;
  orderStatusCounts: Record<GuideReportOrderFact['status'], number>;
  /** null means no orders; zero means orders exist but no money was retained. */
  collectedRevenue: number | null;
  effectivePaidOrderCount: number;
  /** Net retained amount on non-cancelled paid orders / their count. */
  averageOrderValue: number | null;
  cancellations: {
    denominator: number;
    total: number;
    rate: Rate;
    traveler: number;
    guide: number;
    systemExpired: number;
    other: number;
  };
  unpaid: {
    denominator: number;
    expired: number;
    rate: Rate;
  };
};

function percentage(numerator: number, denominator: number): Rate {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

function retainedAmount(order: GuideReportOrderFact): number {
  return order.paidAmount - order.refundedAmount;
}

function assertValidFact(order: GuideReportOrderFact): void {
  if (!Number.isFinite(order.paidAmount) || !Number.isFinite(order.refundedAmount)
    || order.paidAmount < 0 || order.refundedAmount < 0 || order.refundedAmount > order.paidAmount) {
    throw new TypeError('GUIDE report money must be finite, non-negative, and refundedAmount <= paidAmount');
  }
  if (order.status === 'CANCELLED' ? order.cancellationKind === null : order.cancellationKind !== null) {
    throw new TypeError('GUIDE report cancellationKind must exist exactly when status is CANCELLED');
  }
  if (order.unpaidExpired
    && (!order.enteredPaymentStage || order.paymentStatus !== 'UNPAID' || order.status !== 'CANCELLED')) {
    throw new TypeError('GUIDE report unpaidExpired requires an entered, UNPAID, CANCELLED order');
  }
}

export function calculateGuideOrderMetrics(orders: readonly GuideReportOrderFact[]): GuideOrderMetrics {
  let collectedRevenue = 0;
  let effectivePaidRevenue = 0;
  let effectivePaidOrderCount = 0;
  let traveler = 0;
  let guide = 0;
  let systemExpired = 0;
  let other = 0;
  let enteredPaymentStage = 0;
  let unpaidExpired = 0;
  const orderStatusCounts = { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 };

  for (const order of orders) {
    assertValidFact(order);
    orderStatusCounts[order.status] += 1;
    const retained = retainedAmount(order);
    collectedRevenue += retained;

    if (order.status !== 'CANCELLED' && retained > 0) {
      effectivePaidOrderCount += 1;
      effectivePaidRevenue += retained;
    }

    if (order.enteredPaymentStage) enteredPaymentStage += 1;
    if (order.unpaidExpired) unpaidExpired += 1;

    if (order.status === 'CANCELLED') {
      switch (order.cancellationKind) {
        case 'TRAVELER': traveler += 1; break;
        case 'GUIDE': guide += 1; break;
        case 'SYSTEM_EXPIRED': systemExpired += 1; break;
        default: other += 1;
      }
    }
  }

  const cancellationTotal = traveler + guide + systemExpired + other;

  return {
    orderCount: orders.length,
    orderStatusCounts,
    collectedRevenue: orders.length === 0 ? null : collectedRevenue,
    effectivePaidOrderCount,
    averageOrderValue: effectivePaidOrderCount === 0
      ? null
      : Math.round(effectivePaidRevenue / effectivePaidOrderCount),
    cancellations: {
      denominator: orders.length,
      total: cancellationTotal,
      rate: percentage(cancellationTotal, orders.length),
      traveler,
      guide,
      systemExpired,
      other,
    },
    unpaid: {
      denominator: enteredPaymentStage,
      expired: unpaidExpired,
      rate: percentage(unpaidExpired, enteredPaymentStage),
    },
  };
}
