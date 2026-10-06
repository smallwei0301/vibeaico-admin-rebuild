/** #46 / 0130+0132: real HTTP policy persistence and immutable order snapshots.
 * Only owned disposable rows; no payment, refund execution or provider action. */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { readTourSeedFields } from '../../../scripts/test/tour-seed-profile.mjs';

let admin: SupabaseClient;
let owner: AuthedApi;
let foreign: AuthedApi;
const tripIds: string[] = [];
const planIds: string[] = [];
const departureIds: string[] = [];
const orderIds: string[] = [];
async function data(response: Response) {
  const envelope = await response.json();
  expect(response.status).toBe(200); expect(envelope.success).toBe(true);
  return envelope.data;
}
async function rawOrder(id: string) {
  const result = await admin.from('tour_orders').select('*').eq('id', id).single();
  expect(result.error).toBeNull(); return result.data!;
}
beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  owner = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  foreign = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});
afterEach(async () => {
  if (!admin || !tripIds.length) return;
  const errors: unknown[] = [];
  // Discover children by our recorded allocated parents even when HTTP creates
  // a row but its response/assertion fails before its generated ID is recorded.
  for (const [table, column, parents, ids] of [
    ['tour_orders', 'trip_id', tripIds, orderIds],
    ['trip_departures', 'trip_id', tripIds, departureIds],
    ['trip_plans', 'trip_id', tripIds, planIds],
  ] as const) {
    const found = await admin.from(table).select('id').eq('tenant_id', SHOP_A.id).in(column, [...parents]);
    if (found.error) errors.push(found.error);
    else for (const row of found.data ?? []) if (!ids.includes(row.id)) ids.push(row.id);
    const deleted = await admin.from(table).delete().eq('tenant_id', SHOP_A.id).in(column, [...parents]);
    if (deleted.error) errors.push(deleted.error);
  }
  const deleted = await admin.from('trips').delete().eq('tenant_id', SHOP_A.id).in('id', [...tripIds]);
  if (deleted.error) errors.push(deleted.error);
  for (const [table, ids] of [['tour_orders', orderIds], ['trip_departures', departureIds], ['trip_plans', planIds], ['trips', tripIds]] as const) {
    const remaining = await admin.from(table).select('id').in('id', [...ids]);
    if (remaining.error) errors.push(remaining.error);
    else if (remaining.data?.length) errors.push(new Error(`${table}: owned refund snapshot fixture residue`));
  }
  if (errors.length) throw new AggregateError(errors, '#46 refund snapshot cleanup failed');
  for (const ids of [tripIds, planIds, departureIds, orderIds]) ids.length = 0;
});
async function fixture() {
  const tripId = randomUUID(); tripIds.push(tripId);
  const planId = randomUUID(); planIds.push(planId);
  const departureId = randomUUID(); departureIds.push(departureId);
  const fields = await readTourSeedFields(admin, '2043-01-15T00:00:00Z', 'CANONICAL_CORE');
  expect((await admin.from('trips').insert({ id: tripId, tenant_id: SHOP_A.id, slug: `refund-snapshot-46-${tripId}`,
    title: 'owned refund policy fixture', duration_hours: 2, status: 'PUBLISHED' })).error).toBeNull();
  expect((await admin.from('trip_plans').insert({ id: planId, tenant_id: SHOP_A.id, trip_id: tripId, name: 'owned refund plan',
    price_per_person: 1000, price_type: 'PER_PERSON', min_party: 1, max_party: 10, deposit_mode: 'DEPOSIT_PERCENT', deposit_value: 25,
    sales_mode: 'REQUEST', participation_mode: 'PRIVATE', ...fields.plan })).error).toBeNull();
  expect((await admin.from('trip_departures').insert({ id: departureId, tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
    departs_on: '2043-01-15', start_time: '09:00', capacity: 10, seats_booked: 0, status: 'OPEN',
    formation_status: 'COLLECTING', ...fields.departure })).error).toBeNull();
  return { tripId, planId, departureId };
}
describe('#46 refund policy stays immutable on real TourOrders', () => {
  it.each(['STANDARD', 'FLEXIBLE', 'STRICT'] as const)('persists %s, preserves the old whole order and updates only new snapshots', async policy => {
    const { tripId, planId, departureId } = await fixture();
    await data(await owner.put(`/api/trips/${tripId}`, { refundPolicyType: policy }));
    expect((await data(await owner.get(`/api/trips/${tripId}`))).trip.refundPolicyType).toBe(policy);
    const order = await data(await owner.post('/api/tour-orders/manual', { departureId, partySize: 2,
      customerName: 'owned refund snapshot traveler', customerPhone: '0912345678' }));
    orderIds.push(order.id);
    const before = await rawOrder(order.id);
    expect(before).toMatchObject({ tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId, departure_id: departureId,
      refund_policy_snapshot: policy, unit_price: 1000, total_amount: 2000, deposit_amount: 500, seats_reserved: false });
    const changedPolicy = policy === 'STRICT' ? 'STANDARD' : 'STRICT';
    await data(await owner.put(`/api/trips/${tripId}`, { refundPolicyType: changedPolicy }));
    await data(await owner.put(`/api/trip-plans/${planId}`, { pricePerPerson: 7000 }));
    expect((await data(await owner.get(`/api/trips/${tripId}`))).trip.refundPolicyType).toBe(changedPolicy);
    const plans = await data(await owner.get(`/api/trips/${tripId}/plans`));
    expect(plans.find((row: { id: string }) => row.id === planId).basePrice).toBe(7000);
    expect(await rawOrder(order.id)).toEqual(before);
    const foreignRead = await data(await foreign.get(`/api/tour-orders?orderId=${order.id}`));
    expect(foreignRead.content).toEqual([]); expect(foreignRead.totalElements).toBe(0);
    expect((await foreign.get(`/api/trips/${tripId}`)).status).toBe(404);
    // A peer may be denied at the feature or tenant boundary; either denial
    // must leave the owner-verified persisted policy and whole old order intact.
    expect([403, 404]).toContain((await foreign.put(`/api/trips/${tripId}`, { refundPolicyType: policy })).status);
    expect((await data(await owner.get(`/api/trips/${tripId}`))).trip.refundPolicyType).toBe(changedPolicy);
    expect(await rawOrder(order.id)).toEqual(before);
    const next = await data(await owner.post('/api/tour-orders/manual', { departureId, partySize: 2,
      customerName: 'owned new refund snapshot traveler', customerPhone: '0912345678' }));
    orderIds.push(next.id);
    expect(await rawOrder(next.id)).toMatchObject({ refund_policy_snapshot: changedPolicy, unit_price: 7000,
      total_amount: 14000, deposit_amount: 3500, seats_reserved: false });
    expect(await rawOrder(order.id)).toEqual(before);
  });
});
