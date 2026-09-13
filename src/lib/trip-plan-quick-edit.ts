import type { TripPlan } from '@/lib/types';

/**
 * Quick Edit is a view over the canonical TripPlan, not a second data model.
 * Keep this projection deliberately small until the Advanced Settings slice
 * has a persisted contract for its additional fields.
 */
export type QuickPlanValidationError = 'name' | 'basePrice' | 'childPrice';

export type AdvancedPlanValidationError =
  | 'minParticipants'
  | 'maxParticipants'
  | 'partyRange'
  | 'deposit';

export function toQuickPlanPayload(plan: TripPlan): Partial<TripPlan> {
  const payload: Partial<TripPlan> = {
    id: plan.id || undefined,
    name: plan.name.trim(),
    description: plan.description.trim(),
    basePrice: plan.basePrice,
    // Send null explicitly so cancelling an existing child price persists.
    childPrice: plan.childPrice,
    active: plan.active,
  };
  return payload;
}

export function validateQuickPlan(
  plan: TripPlan,
  childPriceVisible: boolean,
): QuickPlanValidationError | null {
  if (!plan.name.trim()) return 'name';
  if (!Number.isFinite(plan.basePrice) || plan.basePrice < 0) return 'basePrice';
  if (childPriceVisible && plan.childPrice !== null
    && (!Number.isFinite(plan.childPrice) || plan.childPrice < 0)) {
    return 'childPrice';
  }
  return null;
}

/**
 * Advanced Settings is another projection of the same canonical TripPlan.
 * Keep this first slice to the fields already supported by the #8-A API.
 */
export function toAdvancedPlanPayload(plan: TripPlan): Partial<TripPlan> {
  return {
    id: plan.id || undefined,
    minParticipants: plan.minParticipants,
    maxParticipants: plan.maxParticipants,
    depositMode: plan.depositMode,
    depositValue: plan.depositValue,
  };
}

export type PlanOrderUpdate = { id: string; sortOrder: number };

/**
 * Move a plan up/down by one position (Issue #42 — persisted display order),
 * then normalize every plan's sortOrder to its array position (0-based).
 *
 * Normalizing to the index — instead of swapping the two moved plans'
 * existing sortOrder values — is required because trip_plans.sort_order
 * defaults to 0 and several data paths (bulk seed inserts in particular)
 * never set it, so two or more plans can share the same value. Swapping two
 * equal values is a no-op that would still show a success toast without
 * changing anything on screen or in the DB — exactly the "fake success"
 * this project forbids. Normalizing to position always produces distinct,
 * order-correct values, and is idempotent: calling it again on an
 * already-normalized list yields no further updates.
 *
 * Returns the reordered array plus the minimal set of {id, sortOrder}
 * updates to persist — only plans whose sortOrder actually changed are
 * included, so already-correct rows never get a redundant PUT. When the
 * move is out of bounds (first plan up / last plan down), the same `plans`
 * reference is returned with an empty `updates` list — callers must treat
 * that as a no-op (no PUT, no success toast).
 */
export function reorderPlans(
  plans: TripPlan[],
  index: number,
  delta: number,
): { plans: TripPlan[]; updates: PlanOrderUpdate[] } {
  const target = index + delta;
  if (target < 0 || target >= plans.length || index < 0 || index >= plans.length) {
    return { plans, updates: [] };
  }
  const swapped = [...plans];
  [swapped[index], swapped[target]] = [swapped[target], swapped[index]];

  const updates: PlanOrderUpdate[] = [];
  const next = swapped.map((p, i) => {
    if (p.sortOrder === i) return p;
    updates.push({ id: p.id, sortOrder: i });
    return { ...p, sortOrder: i };
  });
  return { plans: next, updates };
}

export function validateAdvancedPlan(plan: TripPlan): AdvancedPlanValidationError | null {
  if (!Number.isInteger(plan.minParticipants) || plan.minParticipants < 1) {
    return 'minParticipants';
  }
  if (!Number.isInteger(plan.maxParticipants) || plan.maxParticipants < 1) {
    return 'maxParticipants';
  }
  if (plan.minParticipants > plan.maxParticipants) return 'partyRange';

  if (!Number.isFinite(plan.depositValue) || plan.depositValue < 0) return 'deposit';
  if ((plan.depositMode === 'NONE' || plan.depositMode === 'FULL') && plan.depositValue !== 0) {
    return 'deposit';
  }
  if (plan.depositMode === 'DEPOSIT_FIXED'
    && (plan.depositValue <= 0 || plan.depositValue > plan.basePrice)) {
    return 'deposit';
  }
  if (plan.depositMode === 'DEPOSIT_PERCENT'
    && (plan.depositValue <= 0 || plan.depositValue > 100)) {
    return 'deposit';
  }
  return null;
}
