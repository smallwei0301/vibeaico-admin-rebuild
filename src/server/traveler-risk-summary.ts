export type TravelerRiskFact =
  | { kind: 'COMPLETED'; occurredAt: string }
  | { kind: 'CANCELLED'; actor: 'TRAVELER' | 'GUIDE' | 'SYSTEM' | 'UNKNOWN'; occurredAt: string }
  | { kind: 'NO_SHOW'; occurredAt: string }
  | { kind: 'UNPAID_EXPIRED'; occurredAt: string }
  | { kind: 'REFUND_PENDING'; occurredAt: string }
  | { kind: 'REFUND_DISPUTED'; occurredAt: string }
  | { kind: 'REFUNDED'; occurredAt: string };

export type TravelerRiskSummary = {
  completed: number;
  travelerCancelled: number;
  operatorOrSystemCancelled: number;
  noShow: number;
  unpaidExpired: number;
  refundPendingOrDisputed: number;
  refunded: number;
  lastOccurredAt: string | null;
};

/**
 * Summarizes tenant-owned, factual fulfillment events without producing a
 * score or guessing who caused an unclassified cancellation. Facts with an
 * invalid timestamp are excluded before they can affect the summary.
 */
export function summarizeTravelerRiskFacts(facts: readonly TravelerRiskFact[]): TravelerRiskSummary {
  const summary: TravelerRiskSummary = {
    completed: 0,
    travelerCancelled: 0,
    operatorOrSystemCancelled: 0,
    noShow: 0,
    unpaidExpired: 0,
    refundPendingOrDisputed: 0,
    refunded: 0,
    lastOccurredAt: null,
  };
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const fact of facts) {
    const timestamp = Date.parse(fact.occurredAt);
    if (!Number.isFinite(timestamp)) continue;

    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      summary.lastOccurredAt = fact.occurredAt;
    }

    switch (fact.kind) {
      case 'COMPLETED':
        summary.completed += 1;
        break;
      case 'CANCELLED':
        if (fact.actor === 'TRAVELER') summary.travelerCancelled += 1;
        else if (fact.actor === 'GUIDE' || fact.actor === 'SYSTEM') summary.operatorOrSystemCancelled += 1;
        break;
      case 'NO_SHOW':
        summary.noShow += 1;
        break;
      case 'UNPAID_EXPIRED':
        summary.unpaidExpired += 1;
        break;
      case 'REFUND_PENDING':
      case 'REFUND_DISPUTED':
        summary.refundPendingOrDisputed += 1;
        break;
      case 'REFUNDED':
        summary.refunded += 1;
        break;
      default:
        assertNever(fact);
    }
  }

  return summary;
}

function assertNever(value: never): never {
  throw new Error(`UNKNOWN_TRAVELER_RISK_FACT:${JSON.stringify(value)}`);
}
