import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { departureCreateSchema, departureUpdateSchema } from '@/server/tour-domain';

const state = vi.hoisted(() => ({
  blockedDates: [] as string[], durationHours: 2,
  plans: [] as Record<string, unknown>[], rows: [] as Record<string, unknown>[], assignmentWrites: [] as string[],
}));
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';
const PLAN = '44444444-4444-4444-8444-444444444444';
const STAFF = '55555555-5555-4555-8555-555555555555';

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tenant', () => ({
  requireTenantManager: async () => ({ tenantId: TENANT, supabase: fakeDb }),
  requireTenant: async () => ({ tenantId: TENANT, supabase: fakeDb }),
}));
vi.mock('@/server/departure-staff', async (original) => ({
  ...await original<typeof import('@/server/departure-staff')>(),
  bookableStaffIds: async () => [STAFF],
  departureSlot: async () => ({ start: 0, end: 1, shiftDate: '2030-01-15' }),
  checkAssignmentConflicts: async () => [],
  writeAssignment: async (_db: unknown, _tenant: string, id: string) => { state.assignmentWrites.push(id); },
  readAssignments: async () => new Map(),
  staffNames: async () => new Map(),
}));
vi.mock('@/server/staff-availability', async (original) => ({
  ...await original<typeof import('@/server/staff-availability')>(),
  loadStaffLoad: async () => ({ bookings: [], blocks: state.blockedDates.map((date) => ({
    staffId: STAFF, start: Date.parse(`${date}T00:00:00+08:00`), end: Date.parse(`${date}T00:00:00+08:00`) + 86400000,
  })), shifts: [], shiftDates: new Set(), departures: [] }),
}));

const fakeDb = {
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let columns = '*';
    let inserted: Record<string, unknown> | undefined;
    let ids: string[] | undefined;
    const read = () => {
      if (inserted) return { data: inserted, error: null };
      if (table === 'trips') return { data: { duration_hours: state.durationHours }, error: null };
      const rows = table === 'trip_plans' ? state.plans : state.rows;
      const found = rows.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
      const data = found && columns !== '*'
        ? Object.fromEntries(columns.split(',').map((key) => key.trim()).map((key) => [key, found[key]]))
        : found;
      return { data: data ?? null, error: null };
    };
    const query = {
      select: (value: string) => { columns = value; return query; },
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      in: (_key: string, value: string[]) => { ids = value; return query; },
      insert: (value: Record<string, unknown>) => {
        inserted = { id: `departure-${state.rows.length}`, seats_booked: 0, ...value };
        state.rows.push(inserted);
        return query;
      },
      maybeSingle: async () => read(),
      single: async () => read(),
      then: (resolve: (value: unknown) => unknown) => resolve({
        data: state.rows.filter((row) => (!ids || ids.includes(row.id as string))
          && Object.entries(filters).every(([key, value]) => row[key] === value)), error: null,
      }),
    };
    return query;
  },
};

import { saveTripDeparture, batchCreateDepartures } from '@/services/tours';
import { POST as single } from '@/app/api/trips/[id]/departures/route';
import { POST as batch } from '@/app/api/trips/[id]/departures/batch/route';
const create = (body: Record<string, unknown>, bulk = false, tripId = TRIP) =>
  (bulk ? batch : single)(new Request(`http://localhost/api/trips/${tripId}/departures${bulk ? '/batch' : ''}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ id: tripId }) });
const body = { planId: PLAN, departsOn: '2030-01-15', startTime: '00:30', capacity: 8 };
const bulk = { planId: PLAN, from: '2030-01-15', to: '2030-01-16', weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '00:30', capacity: 8 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  state.plans = [{ id: PLAN, tenant_id: TENANT, trip_id: TRIP, min_to_depart: 4, formation_deadline_days_before: 7 }];
  state.rows = [];
  state.blockedDates = [];
  state.durationHours = 2;
  state.assignmentWrites = [];
});
afterEach(() => vi.useRealTimers());

describe('#42 real single/batch route insert seam (fake DB, no real acceptance claim)', () => {
  it('single inserts the selected Plan snapshot and keeps it after Plan changes', async () => {
    expect((await create(body)).status).toBe(200);
    expect(state.rows[0]).toMatchObject({ min_to_depart_snapshot: 4, formation_deadline_at: '2030-01-07T16:30:00.000Z', formation_status: 'COLLECTING' });
    state.plans[0].min_to_depart = 6;
    state.plans[0].formation_deadline_days_before = 0;
    expect((await create({ ...body, departsOn: '2030-01-16' })).status).toBe(200);
    expect(state.rows[0].min_to_depart_snapshot).toBe(4);
    expect(state.rows[1]).toMatchObject({ min_to_depart_snapshot: 6, formation_deadline_at: '2030-01-15T16:30:00.000Z' });
  });
  it('batch inserts every snapshot with the same validated Plan, not column defaults', async () => {
    expect((await create(bulk, true)).status).toBe(200);
    expect(state.rows).toHaveLength(2);
    expect(state.rows.map((row) => row.formation_deadline_at)).toEqual(['2030-01-07T16:30:00.000Z', '2030-01-08T16:30:00.000Z']);
    expect(state.rows.every((row) => row.min_to_depart_snapshot === 4 && row.formation_status === 'COLLECTING')).toBe(true);
  });
  it.each([false, true])('rejects capacity/past cutoff before any insert or assignment, bulk=%s', async (isBatch) => {
    const valid = isBatch ? bulk : body;
    expect((await create({ ...valid, capacity: 3 }, isBatch)).status).toBe(400);
    const tooSoon = isBatch ? { ...bulk, from: '2030-01-03', to: '2030-01-16' } : { ...body, departsOn: '2030-01-03' };
    const rejected = await create(tooSoon, isBatch);
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).message).toContain('請選擇新的成團截止時間');
    expect(state.rows).toEqual([]);
    expect(state.assignmentWrites).toEqual([]);
  });
  it.each([false, true])('honors an explicit confirmed cutoff, bulk=%s', async (isBatch) => {
    const payload = isBatch ? { ...bulk, from: '2030-01-03', to: '2030-01-04' } : { ...body, departsOn: '2030-01-03' };
    expect((await create({ ...payload, formationDeadlineAt: '2030-01-02T12:00:00+08:00' }, isBatch)).status).toBe(200);
    expect(state.rows.every((row) => row.formation_deadline_at === '2030-01-02T04:00:00.000Z')).toBe(true);
  });
  it.each([false, true])('does not select a foreign tenant or another Trip Plan, bulk=%s', async (isBatch) => {
    state.plans[0].tenant_id = OTHER;
    expect((await create(isBatch ? bulk : body, isBatch)).status).toBe(404);
    state.plans[0].tenant_id = TENANT;
    state.plans[0].trip_id = OTHER;
    expect((await create(isBatch ? bulk : body, isBatch)).status).toBe(404);
    expect(state.rows).toEqual([]);
  });
  it('serializes explicit UI confirmation through the real service to both create handlers', async () => {
    const deadline = '2030-01-02T04:00:00.000Z';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const payload = JSON.parse(init!.body as string);
      return create(payload, url.endsWith('/batch'));
    }));
    await saveTripDeparture(TRIP, { ...body, departsOn: '2030-01-14', formationDeadlineAt: deadline });
    await batchCreateDepartures(TRIP, { ...bulk, formationDeadlineAt: deadline });
    expect(state.rows).toHaveLength(3);
    expect(state.rows.every((row) => row.formation_deadline_at === deadline)).toBe(true);
    const request = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true }));
    vi.stubGlobal('fetch', request);
    await saveTripDeparture(TRIP, { ...body, id: 'existing', formationDeadlineAt: deadline });
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).not.toHaveProperty('formationDeadlineAt');
    vi.unstubAllGlobals();
  });
  it('skips an existing near-date duplicate before validating only the future new candidate', async () => {
    const existing = { id: 'existing-near', tenant_id: TENANT, trip_id: TRIP, plan_id: PLAN,
      departs_on: '2030-01-03', start_time: '00:30', capacity: 8,
      min_to_depart_snapshot: 2, formation_deadline_at: '2029-12-27T16:30:00.000Z' };
    state.rows.push(existing);
    const result = await create({ ...bulk, from: '2030-01-03', to: '2030-01-10', weekdays: [4] }, true);
    expect(result.status).toBe(200);
    expect((await result.json()).data).toMatchObject({ created: 1, skipped: 1 });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[0]).toEqual(existing);
    expect(state.rows[1]).toMatchObject({ departs_on: '2030-01-10', min_to_depart_snapshot: 4,
      formation_deadline_at: '2030-01-02T16:30:00.000Z' });
  });
  it('after filtering a duplicate, an invalid true new candidate rejects before any new write', async () => {
    const existing = { id: 'existing-near', tenant_id: TENANT, trip_id: TRIP, plan_id: PLAN,
      departs_on: '2030-01-03', start_time: '00:30' };
    state.rows.push(existing);
    const result = await create({ ...bulk, from: '2030-01-03', to: '2030-01-10', weekdays: [4, 5] }, true);
    expect(result.status).toBe(400);
    expect(state.rows).toEqual([existing]);
    expect(state.assignmentWrites).toEqual([]);
  });
  it('skips a blocked near date before validating the future new candidate', async () => {
    state.blockedDates = ['2030-01-03'];
    const result = await create({ ...bulk, from: '2030-01-03', to: '2030-01-10', weekdays: [4] }, true);
    expect(result.status).toBe(200);
    expect((await result.json()).data).toMatchObject({ created: 1, skipped: 1, conflicts: [expect.objectContaining({ date: '2030-01-03', reason: 'BLOCK' })] });
    expect(state.rows[0].departs_on).toBe('2030-01-10');
  });
  it('still skips same-batch self-overlap and reports the actual earlier inserted departure id', async () => {
    state.durationHours = 26;
    const result = await create(bulk, true);
    expect(result.status).toBe(200);
    expect((await result.json()).data).toMatchObject({ created: 1, skipped: 1, conflicts: [expect.objectContaining({ departureId: state.rows[0].id, reason: 'DEPARTURE' })] });
    expect(state.rows).toHaveLength(1);
  });
  it('schema accepts offset overrides only at creation, never rewrites through update', () => {
    expect(departureCreateSchema.safeParse({ ...body, formationDeadlineAt: '2030-01-02T12:00:00' }).success).toBe(false);
    expect(departureUpdateSchema.parse({ formationDeadlineAt: '2030-01-02T12:00:00+08:00' })).toEqual({});
  });
});
