import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const DAY_MS = 24 * 60 * 60 * 1000;

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let tripId = '';
let planId = '';
let originalStaff: Array<{ id: string; active: boolean; bookable: boolean }> = [];

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  const { data: staff, error: staffError } = await admin
    .from('staff')
    .select('id, active, bookable')
    .eq('tenant_id', SHOP_A.id);
  expect(staffError).toBeNull();
  originalStaff = staff ?? [];

  const { data: trip, error: tripError } = await admin.from('trips').insert({
    tenant_id: SHOP_A.id,
    slug: `itest-batch-error-classification-${Date.now()}`,
    title: 'batch error classification',
    status: 'DRAFT',
  }).select('id').single();
  expect(tripError).toBeNull();
  tripId = trip!.id;

  const { data: plan, error: planError } = await admin.from('trip_plans').insert({
    tenant_id: SHOP_A.id,
    trip_id: tripId,
    name: 'batch error classification plan',
    base_price: 1000,
    duration_minutes: 180,
  }).select('id').single();
  expect(planError).toBeNull();
  planId = plan!.id;
});

afterAll(async () => {
  for (const staff of originalStaff) {
    await admin.from('staff')
      .update({ active: staff.active, bookable: staff.bookable })
      .eq('id', staff.id);
  }
  if (tripId) await admin.from('trips').delete().eq('id', tripId);
});

describe('issue #37 batch error classification', () => {
  it('rejects zero-guide OPEN batches and rolls back without half-created departures', async () => {
    const { error } = await admin.from('staff')
      .update({ active: false })
      .eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();

    const day = futureDate(830);
    const response = await ownerA.post(`/api/trips/${tripId}/departures/batch`, {
      planId,
      from: day,
      to: day,
      weekdays: [weekdayOf(day)],
      startTime: '09:00',
      capacity: 6,
    });
    const body = await readJson(response);
    expect(response.status, JSON.stringify(body)).toBe(409);
    expect(body.message).toContain('尚無可指派導遊');

    const { count, error: countError } = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true })
      .eq('trip_id', tripId);
    expect(countError).toBeNull();
    expect(count).toBe(0);

    for (const staff of originalStaff) {
      const { error: restoreError } = await admin.from('staff')
        .update({ active: staff.active, bookable: staff.bookable })
        .eq('id', staff.id);
      expect(restoreError).toBeNull();
    }
  });

  it('still returns a genuine per-date availability conflict as a batch conflict', async () => {
    const day = futureDate(831);
    const occupied = await ownerA.post(`/api/trips/${tripId}/departures`, {
      planId,
      departsOn: day,
      startTime: '09:00',
      capacity: 6,
      primaryStaffId: SHOP_A.staffA1,
    });
    expect(occupied.status, await occupied.text()).toBe(200);

    const response = await ownerA.post(`/api/trips/${tripId}/departures/batch`, {
      planId,
      from: day,
      to: day,
      weekdays: [weekdayOf(day)],
      startTime: '10:00',
      capacity: 6,
      primaryStaffId: SHOP_A.staffA1,
    });
    const body = await readJson<{
      created: number;
      skipped: number;
      conflicts: Array<{ date: string; reason: string }>;
    }>(response);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data?.created).toBe(0);
    expect(body.data?.skipped).toBe(0);
    expect(body.data?.conflicts).toHaveLength(1);
    expect(body.data?.conflicts[0]).toMatchObject({
      date: day,
      reason: expect.stringContaining('AVAILABILITY_DEPARTURE'),
    });
  });
});
