import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toAdvancedPlanPayload, toQuickPlanPayload, validateAdvancedPlan } from '@/lib/trip-plan-quick-edit';
import { mapTripPlan } from '@/server/mappers';
import { planUpdateSchema } from '@/server/tour-domain';

const db = vi.hoisted(() => ({ row: {} as Record<string, unknown>, writes: 0 }));
vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tenant', () => ({ requireTenantManager: async () => ({
  tenantId: 'tenant-42', supabase: { from: (table: string) => {
    if (table === 'trips') {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { id: 'trip-42', midao_listing: 'NONE' }, error: null }) };
      return query;
    }
    expect(table).toBe('trip_plans');
    let patch: Record<string, unknown> | undefined;
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        if (key === 'tenant_id') expect(value).toBe('tenant-42');
        return query;
      },
      update: (value: Record<string, unknown>) => { patch = value; return query; },
      maybeSingle: async () => {
        if (patch) { db.row = { ...db.row, ...patch }; db.writes++; }
        return { data: db.row, error: null };
      },
    };
    return query;
  } },
}) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
import { PUT } from '@/app/api/trip-plans/[id]/route';
import { listTripPlans, saveTripPlan } from '@/services/tours';

beforeEach(() => {
  db.row = { id: 'plan-42', trip_id: 'trip-42', name: '方案', description: '',
    price_per_person: 3000, child_price: null, min_party: 1, max_party: 10,
    deposit_mode: 'FULL', deposit_value: 0, duration_minutes: 180,
    price_type: 'PER_PERSON', year_round: true, active: true,
    sales_mode: 'FIXED_DEPARTURE', participation_mode: 'SHARED', min_to_depart: 4,
    formation_deadline_days_before: 7, trip_plan_seasons: [] };
  db.writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return PUT(new Request(`http://localhost${url}`, init), { params: Promise.resolve({ id: 'plan-42' }) });
    }
    return Response.json({ success: true, data: [mapTripPlan(db.row)] });
  }));
});

describe('#42 bounded formation persistence seam (fake DB, real service/PUT/mapper)', () => {
  it.each(['FIXED_DEPARTURE', 'INSTANT', 'REQUEST'] as const)('saves %s and reads back canonical fields', async (salesMode) => {
    const plan = { ...mapTripPlan(db.row), salesMode,
      participationMode: salesMode === 'FIXED_DEPARTURE' ? 'SHARED' as const : 'PRIVATE' as const,
      minToDepart: 6, formationDeadlineDaysBefore: 0 };
    expect(validateAdvancedPlan(plan)).toBeNull();
    await saveTripPlan(plan.tripId, toAdvancedPlanPayload(plan));
    expect(db.writes).toBe(1);
    expect((await listTripPlans(plan.tripId))[0]).toMatchObject({
      salesMode, participationMode: plan.participationMode, minToDepart: 6,
      formationDeadlineDaysBefore: 0, minParticipants: 1,
    });
    await saveTripPlan(plan.tripId, toQuickPlanPayload({ ...plan, name: '新名稱' }));
    expect((await listTripPlans(plan.tripId))[0]).toMatchObject({
      name: '新名稱', salesMode, minToDepart: 6, formationDeadlineDaysBefore: 0,
    });
    const bodies = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(bodies[1][1]!.body as string)).not.toHaveProperty('salesMode');
    expect(JSON.parse(bodies[1][1]!.body as string)).not.toHaveProperty('minToDepart');
    expect(JSON.parse(bodies[1][1]!.body as string)).not.toHaveProperty('formationDeadlineDaysBefore');
  });

  it.each([NaN, Infinity, -1, 0, 1.5])('rejects invalid formation threshold %s', (minToDepart) => {
    expect(validateAdvancedPlan({ ...mapTripPlan(db.row), minToDepart })).toBe('minToDepart');
    expect(planUpdateSchema.safeParse({ minToDepart }).success).toBe(false);
  });
  it.each([NaN, Infinity, -1, 91, 7.5])('rejects invalid deadline %s', (formationDeadlineDaysBefore) => {
    expect(validateAdvancedPlan({ ...mapTripPlan(db.row), formationDeadlineDaysBefore })).toBe('formationDeadlineDaysBefore');
    expect(planUpdateSchema.safeParse({ formationDeadlineDaysBefore }).success).toBe(false);
  });
  it.each([0, 90])('accepts deadline endpoint %s', (formationDeadlineDaysBefore) => {
    expect(validateAdvancedPlan({ ...mapTripPlan(db.row), formationDeadlineDaysBefore })).toBeNull();
  });
  it('requires explicit private participation for self-selected/request time without rewriting it', () => {
    const plan = { ...mapTripPlan(db.row), salesMode: 'INSTANT' as const };
    expect(validateAdvancedPlan(plan)).toBe('participationMode');
    expect(toAdvancedPlanPayload(plan).participationMode).toBe('SHARED');
  });
  it('uses canonical defaults for legacy missing fields', () => {
    const plan = { ...mapTripPlan(db.row), salesMode: undefined, participationMode: undefined,
      minToDepart: undefined, formationDeadlineDaysBefore: undefined };
    expect(toAdvancedPlanPayload(plan)).toMatchObject({ salesMode: 'FIXED_DEPARTURE',
      participationMode: 'SHARED', minToDepart: 1, formationDeadlineDaysBefore: 7 });
  });
});
