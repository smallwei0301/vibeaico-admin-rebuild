/** Import → DB-shaped row → mapped model → tour-platform export round-trip. */
import { describe, expect, it } from 'vitest';
import { mapTrip, mapTripPlan } from '@/server/mappers';
import {
  planRowFromImport,
  toTourPlatformJson,
  tripRowFromImport,
} from '@/server/trip-payload';

describe('trip import/export round-trip', () => {
  it('preserves plan description, child price, and stable slugs', () => {
    const imported = {
      slug: 'island-whale-watching',
      title: '島嶼賞鯨之旅',
      description: '沿著海岸尋找鯨豚。',
      activityPlans: [{
        name: '親子晨間團',
        slug: 'family-morning',
        description: '適合親子同行的晨間航程。',
        priceType: 'per_person',
        basePrice: 1680,
        childPrice: 980,
      }],
    };

    const trip = mapTrip(tripRowFromImport(imported, 'tenant-a'));
    const planRow = planRowFromImport(imported.activityPlans[0], 'tenant-a', 'trip-a', 0);
    const plan = mapTripPlan({ id: 'plan-a', ...planRow });
    const exported = toTourPlatformJson(trip, [plan]);
    const exportedPlan = exported.activityPlans[0];

    expect(exported.slug).toBe(imported.slug);
    expect(exportedPlan.slug).toBe('family-morning');
    expect(exportedPlan.description).toBe('適合親子同行的晨間航程。');
    expect(exportedPlan.childPrice).toBe(980);
  });
});
