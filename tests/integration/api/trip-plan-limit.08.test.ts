/** Database-wide trip-plan cap — issue #8, 10-TOUR-DOMAIN §5 / 12-TDD §3. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const prefix = `itest-trip-plan-limit-${Date.now()}`;
let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
let tripId = '';
let moveSourceTripId = '';
let moveSourcePlanId = '';
const baseUrl = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

const json = async <T>(res: Response) => (await res.json()) as Envelope<T>;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

  // Seed 99 through the import boundary, then exercise the normal plans API
  // concurrently.  Its previous count-then-insert logic is intentionally
  // unable to decide admission safely on its own.
  const initial = await ownerA.post('/api/trips/import', {
    title: '全域方案上限測試',
    slug: prefix,
    activityPlans: Array.from({ length: 99 }, (_, index) => ({
      name: `既有方案 ${index + 1}`,
      slug: `seed-${index + 1}`,
      basePrice: 1000,
    })),
  });
  const initialBody = await json<{ results: Array<{ tripId: string; plansAdded: number }> }>(initial);
  expect(initial.status, JSON.stringify(initialBody)).toBe(200);
  expect(initialBody.success).toBe(true);
  expect(initialBody.data!.results[0].plansAdded).toBe(99);
  tripId = initialBody.data!.results[0].tripId;

  const { data: moveSourceTrip, error: moveSourceTripError } = await admin.from('trips').insert({
    tenant_id: SHOP_A.id,
    slug: `${prefix}-move-source`,
    title: '方案移轉來源',
  }).select('id').single();
  expect(moveSourceTripError).toBeNull();
  moveSourceTripId = moveSourceTrip!.id;
  const { data: moveSourcePlan, error: moveSourcePlanError } = await admin.from('trip_plans').insert({
    tenant_id: SHOP_A.id,
    trip_id: moveSourceTripId,
    slug: 'move-source-plan',
    name: '移轉來源方案',
    base_price: 1000,
  }).select('id').single();
  expect(moveSourcePlanError).toBeNull();
  moveSourcePlanId = moveSourcePlan!.id;
});

afterAll(async () => {
  if (tripId) {
    const { error } = await admin.from('trips').delete().eq('id', tripId);
    expect(error, 'cleanup trip-plan-limit trip').toBeNull();
  }
  if (moveSourceTripId) {
    const { error } = await admin.from('trips').delete().eq('id', moveSourceTripId);
    expect(error, 'cleanup move-source trip').toBeNull();
  }
});

describe('trip_plans database-wide 100-plan invariant', () => {
  it('keeps the direct plan writer behind authentication and tenant ownership before its global cap check', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/trips/${tripId}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '未登入不可新增' }),
    });
    const unauthenticatedBody = await json(unauthenticated);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticatedBody).toMatchObject({ success: false, code: 'AUTH_001' });

    const crossTenant = await ownerB.post(`/api/trips/${tripId}/plans`, { name: 'B 店不可新增' });
    const crossTenantBody = await json(crossTenant);
    expect(crossTenant.status).toBe(404);
    expect(crossTenantBody).toMatchObject({ success: false, code: 'REQ_002' });

    const { count, error } = await admin.from('trip_plans').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('trip_id', tripId);
    expect(error).toBeNull();
    expect(count).toBe(99);
  });

  it('allows exactly one concurrent API insert at 99 and rejects the other without producing plan 101', async () => {
    const [first, second] = await Promise.all([
      ownerA.post(`/api/trips/${tripId}/plans`, { name: '第 100 個方案', basePrice: 1200 }),
      ownerA.post(`/api/trips/${tripId}/plans`, { name: '第 101 個方案', basePrice: 1200 }),
    ]);
    const responses = await Promise.all([json<{ id: string }>(first), json<{ id: string }>(second)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const accepted = responses[[first, second].findIndex((response) => response.status === 200)];
    expect(accepted.success).toBe(true);
    expect(accepted.data?.id).toBeTruthy();
    const rejected = responses.find((body) => body.code === 'REQ_003');
    expect(rejected?.message).toBe('每個行程最多 100 個方案');

    const { count, error } = await admin.from('trip_plans').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('trip_id', tripId);
    expect(error).toBeNull();
    expect(count).toBe(100);
  });

  it('rejects a direct database writer after the API filled slot 100', async () => {
    const { error } = await admin.from('trip_plans').insert({
      tenant_id: SHOP_A.id,
      trip_id: tripId,
      slug: 'db-plan-101',
      name: '資料庫直寫第 101 個方案',
      base_price: 1200,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0001');
    expect(error!.message).toContain('TRIP_PLAN_LIMIT');

    const { count } = await admin.from('trip_plans').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('trip_id', tripId);
    expect(count).toBe(100);
  });

  it('rejects moving an existing plan into a full trip and rolls the UPDATE back', async () => {
    const { error } = await admin.from('trip_plans').update({ trip_id: tripId }).eq('id', moveSourcePlanId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0001');
    expect(error!.message).toContain('TRIP_PLAN_LIMIT');

    const { data: sourcePlan, error: sourcePlanError } = await admin.from('trip_plans')
      .select('trip_id').eq('id', moveSourcePlanId).single();
    expect(sourcePlanError).toBeNull();
    expect(sourcePlan!.trip_id).toBe(moveSourceTripId);
    const { count } = await admin.from('trip_plans').select('*', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('trip_id', tripId);
    expect(count).toBe(100);
  });
});
