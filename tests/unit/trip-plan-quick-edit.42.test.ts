import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toQuickPlanPayload, validateQuickPlan } from '@/lib/trip-plan-quick-edit';
import type { TripPlan } from '@/lib/types';

const plan: TripPlan = {
  id: 'plan-1',
  tripId: 'trip-1',
  name: '  標準方案  ',
  description: '  內容說明  ',
  durationMinutes: 180,
  priceType: 'PER_PERSON',
  basePrice: 3000,
  childPrice: null,
  minParticipants: 1,
  maxParticipants: 10,
  bookingType: 'SCHEDULED',
  depositMode: 'FULL',
  depositValue: 0,
  active: true,
  yearRound: true,
  seasons: [],
  reviewState: 'NONE',
  reviewNote: '',
  sortOrder: 0,
};

describe('#42 Quick Edit contract', () => {
  it('projects only high-frequency fields into the canonical plan service payload', () => {
    expect(toQuickPlanPayload(plan)).toEqual({
      id: 'plan-1',
      name: '標準方案',
      description: '內容說明',
      basePrice: 3000,
      childPrice: null,
      active: true,
    });
  });

  it('persists an optional child price and can clear it with null', () => {
    expect(toQuickPlanPayload({ ...plan, childPrice: 1500 })).toMatchObject({ childPrice: 1500 });
    expect(toQuickPlanPayload({ ...plan, childPrice: null })).toMatchObject({ childPrice: null });
  });

  it('rejects empty names and invalid prices before making the API call', () => {
    expect(validateQuickPlan({ ...plan, name: '  ' }, false)).toBe('name');
    expect(validateQuickPlan({ ...plan, basePrice: -1 }, false)).toBe('basePrice');
    expect(validateQuickPlan({ ...plan, childPrice: -1 }, true)).toBe('childPrice');
    expect(validateQuickPlan(plan, false)).toBeNull();
  });

  it('uses the one existing plan service and re-reads real data after saving', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/tenant/trips/[id]/page.tsx'), 'utf8');
    expect(source).toContain('USE_MOCK');
    expect(source).toContain('toQuickPlanPayload');
    expect(source).toContain('await saveTripPlan(tripId, quickPlanPayload)');
    expect(source).toContain('await listTripPlans(tripId)');
    expect(source).toContain('quickPlanPayload');
    expect(source).toContain("trip?.midaoListing === 'LISTED'");
    expect(source).not.toContain('patchPlan({ childPrice: planDraft.childPrice ?? 0 })');
  });
});
