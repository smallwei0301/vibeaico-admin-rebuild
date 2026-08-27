import { ApiHttpError, ERR } from '@/server/http';
import { planRowFromImport, slugify, tripRowFromImport } from '@/server/trip-payload';

const MAX_TRIPS = 100;
const MAX_PLANS_PER_TRIP = 100;
const MAX_SLUG_LENGTH = 120;

type ImportPlan = ReturnType<typeof planRowFromImport>;
export type AtomicTripImport = ReturnType<typeof tripRowFromImport> & { activityPlans: ImportPlan[] };

function invalid(message: string): never {
  throw new ApiHttpError(400, message, ERR.VALIDATION);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid(`${label} 必須是物件`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${label} 不可為空`);
  return value.trim();
}

/** Slugs are deterministic: supplied values normalise, omitted values derive from readable names. */
function stableSlug(value: unknown, readable: string, label: string): string {
  const supplied = value !== undefined && value !== null && String(value).trim() !== '';
  // A hand-edited slug such as "!!!" should not discard an otherwise usable
  // title/name.  Only reject when neither source can produce a readable key.
  const slug = slugify(supplied ? String(value) : '', '') || slugify(readable, '');
  if (!slug || slug.length > MAX_SLUG_LENGTH) invalid(`${label} slug 必須是可讀、非空且不超過 ${MAX_SLUG_LENGTH} 字元`);
  return slug;
}

function finiteNumber(value: unknown, label: string): void {
  if (value !== undefined && value !== null && value !== '' && !Number.isFinite(Number(value))) {
    invalid(`${label} 必須是數字`);
  }
}

function validateNumbers(input: Record<string, unknown>, label: string, fields: string[]): void {
  for (const field of fields) finiteNumber(input[field], `${label}.${field}`);
}

function isoDate(value: unknown, label: string): void {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${label} 必須是 YYYY-MM-DD 日期`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalid(`${label} 必須是有效日期`);
  }
}

/**
 * Normalise and validate the *entire* JSON document before the route enters its
 * single RPC.  The RPC repeats the structural checks so direct SQL callers do
 * not weaken the transaction boundary.
 */
export function parseAtomicTripImport(raw: unknown, tenantId: string): AtomicTripImport[] {
  const items = Array.isArray(raw)
    ? raw
    : (() => {
      const root = object(raw, '匯入資料');
      return root.trips === undefined ? [root] : root.trips;
    })();
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_TRIPS) {
    invalid(`一次最多匯入 ${MAX_TRIPS} 個行程`);
  }

  const tripSlugs = new Set<string>();
  return items.map((value, tripIndex) => {
    const item = object(value, `trips[${tripIndex}]`);
    const title = nonEmptyString(item.title, `trips[${tripIndex}].title`);
    const slug = stableSlug(item.slug, title, `trips[${tripIndex}]`);
    if (tripSlugs.has(slug)) invalid(`duplicate trip slug: ${slug}`);
    tripSlugs.add(slug);
    validateNumbers(item, `trips[${tripIndex}]`, ['durationMinutes']);

    const rawPlans = item.activityPlans ?? [];
    if (!Array.isArray(rawPlans) || rawPlans.length > MAX_PLANS_PER_TRIP) {
      invalid(`trips[${tripIndex}].activityPlans 一次最多 ${MAX_PLANS_PER_TRIP} 個方案`);
    }
    const planSlugs = new Set<string>();
    const activityPlans = rawPlans.map((planValue, planIndex) => {
      const plan = object(planValue, `trips[${tripIndex}].activityPlans[${planIndex}]`);
      const name = nonEmptyString(plan.name, `trips[${tripIndex}].activityPlans[${planIndex}].name`);
      const planSlug = stableSlug(plan.slug, name, `trips[${tripIndex}].activityPlans[${planIndex}]`);
      if (planSlugs.has(planSlug)) invalid(`duplicate plan slug: ${planSlug}`);
      planSlugs.add(planSlug);
      validateNumbers(plan, `trips[${tripIndex}].activityPlans[${planIndex}]`, [
        'durationMinutes', 'basePrice', 'childPrice', 'minParticipants', 'maxParticipants',
        'confirmByDays', 'freeCancelDays',
      ]);
      isoDate(plan.earliestDeparture, `trips[${tripIndex}].activityPlans[${planIndex}].earliestDeparture`);
      return { ...planRowFromImport({ ...plan, name, slug: planSlug }, tenantId, '', planIndex), slug: planSlug };
    });

    return {
      ...tripRowFromImport({ ...item, title, slug }, tenantId),
      slug,
      activityPlans,
    };
  });
}
