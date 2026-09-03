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
