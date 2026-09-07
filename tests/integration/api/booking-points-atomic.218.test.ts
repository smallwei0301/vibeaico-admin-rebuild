/**
 * Issue #218 — promotion-lane integration contract for atomic booking redemptions.
 * This file requires a freshly migrated isolated database and is intentionally not
 * run by the source-only reserve lane. It must never be treated as transaction proof
 * until run there with a unique TEST holder.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; code?: string };

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const bookingIds: string[] = [];
const customerIds: string[] = [];

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const read = async <T,>(res: Response) => (await res.json()) as Envelope<T>;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  [ownerA, ownerB] = await Promise.all([
    loginAs(SHOP_A.owner.email, SHOP_A.owner.password),
    loginAs(SHOP_B.owner.email, SHOP_B.owner.password),
  ]);
});

afterEach(async () => {
  if (customerIds.length) {
    const { error } = await admin.from('customer_point_logs').delete().in('customer_id', customerIds);
    expect(error).toBeNull();
  }
  if (bookingIds.length) {
    const { error } = await admin.from('bookings').delete().in('id', bookingIds);
    expect(error).toBeNull();
  }
  if (customerIds.length) {
    const { error } = await admin.from('customers').delete().in('id', customerIds);
    expect(error).toBeNull();
  }
  bookingIds.length = 0;
  customerIds.length = 0;
});

async function customer(points: number) {
  const id = randomUUID();
  customerIds.push(id);
  const { error } = await admin.from('customers').insert({
    id, tenant_id: SHOP_A.id, name: `#218 ${suffix()}`, phone: '', points, active: true,
  });
  expect(error).toBeNull();
  return id;
}

async function booking(customerId: string, finalPrice = 100) {
  const id = randomUUID();
  bookingIds.push(id);
  const start = new Date(Date.now() + 400 * 86_400_000 + bookingIds.length * 3_600_000);
  const { error } = await admin.from('bookings').insert({
    id, tenant_id: SHOP_A.id, booking_no: `I218${suffix()}`, customer_id: customerId,
    service_id: SHOP_A.serviceA1, staff_id: null, start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 3_600_000).toISOString(), duration_minutes: 60,
    price: finalPrice, final_price: finalPrice, status: 'PENDING', payment_status: 'UNPAID', source: 'MANUAL',
  });
  expect(error).toBeNull();
  return id;
}

async function snapshot(customerId: string, bookingId: string) {
  const [{ data: c, error: cErr }, { data: b, error: bErr }, { count, error: lErr }] = await Promise.all([
    admin.from('customers').select('points').eq('id', customerId).single(),
    admin.from('bookings').select('final_price').eq('id', bookingId).single(),
    admin.from('customer_point_logs').select('*', { count: 'exact', head: true }).eq('customer_id', customerId),
  ]);
  expect([cErr, bErr, lErr]).toEqual([null, null, null]);
  return { points: Number(c!.points), finalPrice: Number(b!.final_price), logs: count! };
}

describe('atomic redemption', () => {
  it('serializes two requests for one booking: both successful redemptions leave matching balance, price, and two ledger rows', async () => {
    const customerId = await customer(100);
    const bookingId = await booking(customerId);
    const results = await Promise.all([
      ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 30 }),
      ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 30 }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await snapshot(customerId, bookingId)).toEqual({ points: 40, finalPrice: 40, logs: 2 });
  });

  it('serializes different bookings that share one customer, so only one 30-point debit succeeds from a 50-point balance', async () => {
    const customerId = await customer(50);
    const [first, second] = await Promise.all([booking(customerId), booking(customerId)]);
    const results = await Promise.all([
      ownerA.post(`/api/bookings/${first}/apply-points`, { points: 30 }),
      ownerA.post(`/api/bookings/${second}/apply-points`, { points: 30 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [customerRow, firstRow, secondRow] = await Promise.all([
      admin.from('customers').select('points').eq('id', customerId).single(),
      admin.from('bookings').select('final_price').eq('id', first).single(),
      admin.from('bookings').select('final_price').eq('id', second).single(),
    ]);
    expect(customerRow.data!.points).toBe(20);
    expect([Number(firstRow.data!.final_price), Number(secondRow.data!.final_price)].sort((a, b) => a - b)).toEqual([70, 100]);
  });

  it('a rejected redemption changes none of the three records', async () => {
    const customerId = await customer(100);
    const bookingId = await booking(customerId, 20);
    const before = await snapshot(customerId, bookingId);
    const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 30 });
    expect(res.status).toBe(400);
    expect((await read(res)).code).toBe('REQ_001');
    expect(await snapshot(customerId, bookingId)).toEqual(before);
  });

  it('does not reveal another tenant booking through the route', async () => {
    const customerId = await customer(100);
    const bookingId = await booking(customerId);
    const res = await ownerB.post(`/api/bookings/${bookingId}/apply-points`, { points: 1 });
    expect(res.status).toBe(404);
    expect((await read(res)).code).toBe('REQ_002');
  });

  it('keeps the HTTP feature gate', async () => {
    const customerId = await customer(100);
    const bookingId = await booking(customerId);
    const { data: saved, error: savedError } = await admin.from('feature_subscriptions')
      .select('*').eq('tenant_id', SHOP_A.id).eq('code', 'POINT_SYSTEM').single();
    expect(savedError).toBeNull();
    await admin.from('feature_subscriptions').delete().eq('tenant_id', SHOP_A.id).eq('code', 'POINT_SYSTEM');
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 1 });
      expect(res.status).toBe(403);
      expect((await read(res)).code).toBe('FEAT_001');
    } finally {
      const { error } = await admin.from('feature_subscriptions').insert(saved!);
      expect(error).toBeNull();
    }
  });

  it('does not grant unauthenticated callers direct RPC access', async () => {
    const customerId = await customer(100);
    const bookingId = await booking(customerId);
    const anon = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.rpc('apply_booking_points', {
      p_tenant_id: SHOP_A.id, p_booking_id: bookingId, p_points: 1,
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(await snapshot(customerId, bookingId)).toEqual({ points: 100, finalPrice: 100, logs: 0 });
  });

  // Promotion-only fault-injection recipe: in the isolated local database, add a
  // BEFORE INSERT trigger on customer_point_logs that raises only for this test's
  // generated customer id; call the HTTP route; then remove the trigger/function
  // in finally and assert the pre-call snapshot. Never install it on shared TEST.
  it.todo('rolls back customer, ledger, and booking when a controlled local-DB ledger or final-update fault is injected');
});
