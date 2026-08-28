import type { TripPlan } from '@/lib/types';

export type PlanEditorSection = 'quick' | 'advanced';
/** UI boundary only until the API/schema provenance contract lands. */
export type PlanProvenanceSource = 'GUIDE' | 'PLATFORM_ASSISTED' | 'IMPORTED';

const QUICK_FIELDS = [
  'name', 'description', 'basePrice', 'active',
] as const satisfies readonly (keyof TripPlan)[];

const ADVANCED_FIELDS = [
  'priceType', 'durationMinutes', 'minParticipants', 'maxParticipants',
  'bookingType', 'depositMode', 'depositValue', 'yearRound', 'seasons',
] as const satisfies readonly (keyof TripPlan)[];

type QuickPlanFields = Pick<TripPlan, (typeof QUICK_FIELDS)[number]>;
type AdvancedPlanFields = Pick<TripPlan, (typeof ADVANCED_FIELDS)[number]>;
export type PlanPreviewLink = { summary: string; href: string };

/** Missing from the current TripPlan contract; stack these only after #41 lands. */
export const PLAN_ADVANCED_PENDING_FIELDS = [
  'groupSalesMode', 'minToDepart', 'formationDeadlineDays',
] as const;

function pickPlanFields<K extends keyof TripPlan>(plan: TripPlan, fields: readonly K[]): Pick<TripPlan, K> {
  return Object.fromEntries(fields.map((field) => [field, plan[field]])) as Pick<TripPlan, K>;
}

export function getQuickPlanFields(
  plan: TripPlan,
  options: { childPriceExpanded: boolean; preview: PlanPreviewLink },
): QuickPlanFields & { childPrice?: number | null; preview: PlanPreviewLink } {
  return {
    ...pickPlanFields(plan, QUICK_FIELDS),
    ...(options.childPriceExpanded || plan.childPrice !== null ? { childPrice: plan.childPrice } : {}),
    preview: options.preview,
  };
}

export function getCurrentAdvancedPlanFields(plan: TripPlan): AdvancedPlanFields {
  return pickPlanFields(plan, ADVANCED_FIELDS);
}

/** UI field ownership only. The shared Plan API remains the value-validation authority. */
export function checkPlanEditFieldOwnership(
  section: PlanEditorSection,
  patch: Partial<TripPlan>,
): { ok: true; invalidFields: [] } | { ok: false; invalidFields: string[] } {
  const allowed = new Set<keyof TripPlan>(section === 'quick' ? QUICK_FIELDS : ADVANCED_FIELDS);
  const invalidFields = Object.keys(patch).filter((field) => !allowed.has(field as keyof TripPlan));
  return invalidFields.length === 0
    ? { ok: true, invalidFields: [] }
    : { ok: false, invalidFields };
}

const PROVENANCE_BADGE_KEYS: Record<PlanProvenanceSource, 'platformAssisted' | 'imported' | null> = {
  GUIDE: null,
  PLATFORM_ASSISTED: 'platformAssisted',
  IMPORTED: 'imported',
};

export function getPlanProvenanceView(source: PlanProvenanceSource): {
  badgeKey: 'platformAssisted' | 'imported' | null;
  canEdit: true;
} {
  return { badgeKey: PROVENANCE_BADGE_KEYS[source], canEdit: true };
}
