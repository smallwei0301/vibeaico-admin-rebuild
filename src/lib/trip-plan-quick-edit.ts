import type { TripPlan } from '@/lib/types';

/**
 * Quick Edit is a view over the canonical TripPlan, not a second data model.
 * Keep this projection deliberately small until the Advanced Settings slice
 * has a persisted contract for its additional fields.
 */
export type QuickPlanValidationError = 'name' | 'basePrice' | 'childPrice';

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
