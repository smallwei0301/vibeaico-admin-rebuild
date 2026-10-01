/** #43 / 19 §3: real HTTP reload after REQUEST rejection, deadline order and tenant boundaries.
 * Only service-role fixture setup/readback/cleanup use direct DB access. GET and reject use
 * authenticated HTTP, including canonical 0111 reject_tour_request. No provider calls or mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { readTourSeedFields } from '../../../scripts/test/tour-seed-profile.mjs';
import type { GuideActionInboxItem } from '@/lib/guide-action-inbox';

type Envelope<T> = { success: boolean; data?: T };
type OrderPage = { totalElements: number; content: Array<{ id: string; status: string }> };
let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const planIds: string[] = [];
const departureIds: string[] = [];
const orderIds: string[] = [];

async function read<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200);
  const body = await response.json() as Envelope<T>;
  expect(body.success).toBe(true);
  expect(body.data).toBeDefined();
  return body.data!;
}

async function rawOrders() {
  const { data, error } = await admin.from('tour_orders').select('*')
    .eq('tenant_id', SHOP_A.id).in('id', orderIds).order('id');
  expect(error).toBeNull();
  expect(data).toHaveLength(3);
  return data!;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterAll(async () => {
  // Recorded IDs include attempted inserts: even a partially successful setup is cleaned.
  // Continue through every table if a cleanup step fails, then fail the suite closed.
  const failures: unknown[] = [];
  for (const [table, ids] of [
    ['tour_orders', orderIds], ['trip_departures', departureIds], ['trip_plans', planIds],
  ] as const) {
    if (!ids.length) continue;
    try {
      const removed = await admin.from(table).delete().eq('tenant_id', SHOP_A.id).in('id', ids);
      if (removed.error) throw removed.error;
      const remaining = await admin.from(table).select('id').in('id', ids);
      if (remaining.error) throw remaining.error;
      expect(remaining.data, `${table} fixture cleanup must leave zero recorded IDs`).toEqual([]);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, '#43 lifecycle fixture cleanup failed');
});

describe('GUIDE REQUEST inbox real lifecycle (#43)', () => {
  it('sorts deadlines, rejects foreign mutations, and reload removes only the rejected request', async () => {
    const now = Date.now();
    const formationDeadline = new Date(now + 7 * 86_400_000).toISOString();
    // Missing canonical 0107/0111 fields or RPCs must fail; there is no compatibility skip.
    const fields = await readTourSeedFields(admin, formationDeadline, 'CANONICAL_CORE');
    const planId = randomUUID(); planIds.push(planId);
    const plan = await admin.from('trip_plans').insert({
      id: planId, tenant_id: SHOP_A.id, trip_id: TRIP_A.id,
      name: '#43 lifecycle REQUEST fixture', sales_mode: 'REQUEST', participation_mode: 'PRIVATE',
      price_per_person: 1500, price_type: 'PER_PERSON', min_party: 1, max_party: 8,
      deposit_mode: 'NONE', deposit_value: 0, request_hold_hours: 96, active: true,
      ...fields.plan,
    });
    expect(plan.error).toBeNull();
    const departureId = randomUUID(); departureIds.push(departureId);
    const departure = await admin.from('trip_departures').insert({
      id: departureId, tenant_id: SHOP_A.id, trip_id: TRIP_A.id, plan_id: planId,
      departs_on: new Date(now + 21 * 86_400_000).toISOString().slice(0, 10),
      start_time: '10:00', capacity: 8, seats_booked: 0, status: 'OPEN',
      formation_status: 'COLLECTING', ...fields.departure,
    });
    expect(departure.error).toBeNull();
    const fixtures = [96, 48, 72].map((hours, index) => ({
      id: randomUUID(), hours, deadline: new Date(now + hours * 3_600_000).toISOString(),
      createdAt: new Date(now - (3 - index) * 1000).toISOString(),
    }));
    orderIds.push(...fixtures.map((fixture) => fixture.id));
    const orders = await admin.from('tour_orders').insert(fixtures.map((fixture) => ({
      id: fixture.id, tenant_id: SHOP_A.id, order_no: `I43-LIFECYCLE-${fixture.id}`,
      trip_id: TRIP_A.id, plan_id: planId, departure_id: departureId,
      party_size: 1, unit_price: 1500, total_amount: 1500,
      deposit_amount: 0, deposit_mode_snapshot: 'NONE', upfront_required_amount: 0,
      paid_amount: 0, refunded_amount: 0, status: 'PENDING', payment_status: 'UNPAID',
      seats_reserved: false, hold_expires_at: fixture.deadline, created_at: fixture.createdAt,
      contact: { name: `REQUEST ${fixture.hours}h fixture` }, source: 'MANUAL',
    })));
    expect(orders.error).toBeNull();
    const sorted = [...fixtures].sort((a, b) => a.hours - b.hours);
    const inbox = async (api: AuthedApi) => (await read<GuideActionInboxItem[]>(await api.get('/api/guide/action-inbox')))
      .filter((item) => orderIds.includes(item.id));
    const initial = await inbox(ownerA);
    expect(initial.map((item) => item.id)).toEqual(sorted.map((fixture) => fixture.id));
    expect(initial.map((item) => Date.parse(item.dueAt))).toEqual(sorted.map((fixture) => Date.parse(fixture.deadline)));
    expect(initial.every((item) => item.kind === 'TOUR_REQUEST' && item.priority === 'UPCOMING')).toBe(true);
    for (const item of initial) {
      expect(item.href).toBe(`/tenant/tour-orders?orderId=${item.id}`);
      const query = new URL(item.href, 'http://test.local').search;
      const exactA = await read<OrderPage>(await ownerA.get(`/api/tour-orders${query}`));
      expect(exactA.totalElements).toBe(1);
      expect(exactA.content).toHaveLength(1);
      expect(exactA.content[0]).toMatchObject({ id: item.id, status: 'PENDING' });
      const exactB = await read<OrderPage>(await ownerB.get(`/api/tour-orders${query}`));
      expect(exactB).toMatchObject({ totalElements: 0, content: [] });
    }
    expect(await inbox(ownerB)).toEqual([]);
    const beforeForeignReject = await rawOrders();
    expect(beforeForeignReject.every((order) => order.status === 'PENDING'
      && order.payment_status === 'UNPAID' && order.seats_reserved === false)).toBe(true);
    const target = sorted[0];
    const foreignReject = await ownerB.post(`/api/tour-orders/${target.id}/reject`, { reason: 'foreign attempt' });
    expect(foreignReject.status).toBe(404);
    expect((await foreignReject.json()).success).toBe(false);
    expect(await rawOrders()).toEqual(beforeForeignReject);
    const rejected = await read<{ id: string; status: string }>(await ownerA.post(
      `/api/tour-orders/${target.id}/reject`, { reason: '#43 lifecycle fixture rejection' },
    ));
    expect(rejected).toMatchObject({ id: target.id, status: 'CANCELLED' });
    const after = await rawOrders();
    expect(after.find((order) => order.id === target.id)).toMatchObject({ status: 'CANCELLED', seats_reserved: false });
    for (const remaining of sorted.slice(1)) {
      expect(after.find((order) => order.id === remaining.id)).toEqual(beforeForeignReject.find((order) => order.id === remaining.id));
    }
    const seats = await admin.from('trip_departures').select('seats_booked').eq('id', departureId).single();
    expect(seats.error).toBeNull(); expect(seats.data?.seats_booked).toBe(0);
    const refreshed = await inbox(ownerA);
    expect(refreshed.map((item) => item.id)).toEqual(sorted.slice(1).map((fixture) => fixture.id));
    expect(refreshed.map((item) => Date.parse(item.dueAt))).toEqual(sorted.slice(1).map((fixture) => Date.parse(fixture.deadline)));
    expect(await inbox(ownerB)).toEqual([]);
  });
});
