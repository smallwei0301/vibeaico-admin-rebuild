import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';

// Fake DB only: route behavior/tenant predicates/no writes, not live DB acceptance.
const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>, writes: 0, tripReadError: false,
}));
vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tenant', () => {
  const tenant = { tenantId: 'tenant-a', supabase: { from: (table: string) => {
    const filters: [string, unknown][] = [];
    let mutation: 'insert' | 'update' | 'delete' | undefined;
    let patch: Record<string, unknown> = {};
    const execute = (single: boolean) => {
      if (table === 'trips' && db.tripReadError) return { data: null, error: new Error('DB unavailable') };
      let rows = db.rows[table].filter((row) => filters.every(([key, value]) => row[key] === value));
      if (mutation) {
        db.writes++;
        if (mutation === 'insert') { rows = [{ id: 'created', ...patch }]; db.rows[table].push(rows[0]); }
        else if (mutation === 'update') rows.forEach((row) => Object.assign(row, patch));
        else db.rows[table] = db.rows[table].filter((row) => !rows.includes(row));
      }
      return { data: single ? rows[0] ?? null : rows, count: rows.length, error: null };
    };
    const query = {
      select: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      insert: (value: Record<string, unknown>) => { mutation = 'insert'; patch = value; return query; },
      update: (value: Record<string, unknown>) => { mutation = 'update'; patch = value; return query; },
      delete: () => { mutation = 'delete'; return query; },
      maybeSingle: async () => execute(true), single: async () => execute(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute(false)).then(resolve),
    };
    return query;
  } } };
  return { requireTenantManager: async () => tenant, requireTenant: async () => tenant };
});
import { POST as createPlan, GET as listPlans } from '@/app/api/trips/[id]/plans/route';
import { PUT as updatePlan, DELETE as deletePlan } from '@/app/api/trip-plans/[id]/route';
import { POST as createSeason, GET as listSeasons } from '@/app/api/trip-plans/[id]/seasons/route';
import { PUT as updateSeason, DELETE as deleteSeason } from '@/app/api/trip-plan-seasons/[id]/route';

const cases = [
  { name: 'create plan', fn: createPlan, method: 'POST', id: 'trip-a', body: { name: 'New', pricePerPerson: 1500 } },
  { name: 'update plan (including sort/active)', fn: updatePlan, method: 'PUT', id: 'plan-a', body: { name: 'Changed', sortOrder: 9, active: false } },
  { name: 'delete plan', fn: deletePlan, method: 'DELETE', id: 'plan-a' },
  { name: 'create season', fn: createSeason, method: 'POST', id: 'plan-a', body: { name: 'New', startMonth: 1, startDay: 1, endMonth: 2, endDay: 1, priceOverride: 1700 } },
  { name: 'update season', fn: updateSeason, method: 'PUT', id: 'season-a', body: { priceOverride: 1800, active: false } },
  { name: 'delete season', fn: deleteSeason, method: 'DELETE', id: 'season-a' },
];
function call(c: typeof cases[number]) {
  return c.fn(new Request('http://localhost/api/test', {
    method: c.method, headers: { 'Content-Type': 'application/json' },
    body: c.body ? JSON.stringify(c.body) : undefined,
  }), { params: Promise.resolve({ id: c.id }) });
}
beforeEach(() => {
  db.rows = {
    trips: [{ id: 'trip-a', tenant_id: 'tenant-a', midao_listing: 'LISTED' }],
    trip_plans: [{ id: 'plan-a', trip_id: 'trip-a', tenant_id: 'tenant-a', name: 'Original', price_per_person: 1000,
      min_party: 1, max_party: 10, deposit_mode: 'FULL', deposit_value: 0, trip_plan_seasons: [] }],
    trip_plan_seasons: [{ id: 'season-a', plan_id: 'plan-a', tenant_id: 'tenant-a', name: 'Original',
      start_month: 1, start_day: 1, end_month: 2, end_day: 1, price_override: 1100 }],
  };
  db.writes = 0; db.tripReadError = false;
});
describe('#42 LISTED plans: truthful temporary API guard', () => {
  it.each(cases)('$name returns 409 and preserves every original row', async (c) => {
    const original = structuredClone(db.rows);
    const res = await call(c);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: 'REQ_003', message: tripsPage.plans.review.unavailable });
    expect(db.writes).toBe(0);
    expect(db.rows).toEqual(original);
  });
  it.each(cases)('$name rejects other tenants without writes', async (c) => {
    Object.values(db.rows).flat().forEach((row) => { row.tenant_id = 'tenant-b'; });
    expect((await call(c)).status).toBe(404);
    expect(db.writes).toBe(0);
  });
  it.each(cases)('$name fails closed when listing read fails', async (c) => {
    db.tripReadError = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try { expect((await call(c)).status).toBe(500); expect(db.writes).toBe(0); }
    finally { log.mockRestore(); }
  });
  for (const state of ['NONE', 'PENDING', 'REJECTED']) {
    it.each(cases)(`$name preserves existing mutations for ${state}`, async (c) => {
      db.rows.trips[0].midao_listing = state;
      expect((await call(c)).status).toBe(200);
      expect(db.writes).toBe(1);
    });
  }
  it('still reads LISTED plans and seasons', async () => {
    for (const [fn, id] of [[listPlans, 'trip-a'], [listSeasons, 'plan-a']] as const) {
      const res = await fn(new Request('http://localhost/api/test'), { params: Promise.resolve({ id }) });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toHaveLength(1);
    }
    expect(db.writes).toBe(0);
  });
});
