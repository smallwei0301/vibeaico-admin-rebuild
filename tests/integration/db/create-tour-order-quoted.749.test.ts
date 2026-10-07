/** #749 / 0137: create_tour_order_quoted 在同一交易內比對旅客確認的總額。
 * 相符 → 建單成功且 total_amount 與 expected 一致；不符 → PRICE_CHANGED（P0004，detail 帶現價），
 * 且整個 RPC 回滾：沒有新 tour_orders 列、trip_departures.seats_booked 不變。
 * 自建 fixture（不改共用 seed），所有資料在 finally／afterEach 清除。缺少 canonical schema 是失敗，不 skip。
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { readTourSeedFields } from '../../../scripts/test/tour-seed-profile.mjs';

let admin: SupabaseClient;
let anon: SupabaseClient;
let authenticated: SupabaseClient;

function client(key: string): SupabaseClient {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
const tripIds: string[] = [];
const orderIds: string[] = [];
const departureIds: string[] = [];
const planIds: string[] = [];

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  anon = client(process.env.TEST_SUPABASE_ANON_KEY!);
  authenticated = client(process.env.TEST_SUPABASE_ANON_KEY!);
  const { error } = await authenticated.auth.signInWithPassword(SHOP_A.owner);
  expect(error).toBeNull();
});

afterEach(async () => {
  if (!admin || !tripIds.length) return;
  const failures: unknown[] = [];
  for (const [table, column] of [
    ['tour_orders', 'trip_id'], ['trip_departures', 'trip_id'], ['trip_plans', 'trip_id'],
  ] as const) {
    const deleted = await admin.from(table).delete().eq('tenant_id', SHOP_A.id).in(column, [...tripIds]);
    if (deleted.error) failures.push(deleted.error);
  }
  const trips = await admin.from('trips').delete().eq('tenant_id', SHOP_A.id).in('id', [...tripIds]);
  if (trips.error) failures.push(trips.error);
  for (const [table, ids] of [
    ['tour_orders', orderIds], ['trip_departures', departureIds], ['trip_plans', planIds], ['trips', tripIds],
  ] as const) {
    if (!ids.length) continue;
    const left = await admin.from(table).select('id').in('id', [...ids]);
    if (left.error) failures.push(left.error);
    else if (left.data?.length) failures.push(new Error(`${table}: owned fixture cleanup left rows`));
  }
  tripIds.length = 0; orderIds.length = 0; departureIds.length = 0; planIds.length = 0;
  if (failures.length) throw new AggregateError(failures, '#749 fixture cleanup failed');
});

async function fixture() {
  const tripId = randomUUID(); tripIds.push(tripId);
  const planId = randomUUID(); planIds.push(planId);
  const departureId = randomUUID(); departureIds.push(departureId);
  const date = '2042-07-15';
  const fields = await readTourSeedFields(admin, `${date}T00:00:00.000Z`, 'CANONICAL_CORE');
  expect((await admin.from('trips').insert({
    id: tripId, tenant_id: SHOP_A.id, slug: `quoted-749-${tripId}`,
    title: 'owned quoted-price fixture', duration_hours: 3, status: 'PUBLISHED',
  })).error).toBeNull();
  expect((await admin.from('trip_plans').insert({
    id: planId, tenant_id: SHOP_A.id, trip_id: tripId, name: 'owned quoted plan',
    price_per_person: 1000, price_type: 'PER_PERSON', year_round: true,
    min_party: 1, max_party: 10, sales_mode: 'FIXED_DEPARTURE', participation_mode: 'PRIVATE',
    deposit_mode: 'DEPOSIT_PERCENT', deposit_value: 25,
    ...fields.plan,
  })).error).toBeNull();
  expect((await admin.from('trip_departures').insert({
    id: departureId, tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
    departs_on: date, start_time: '09:00', capacity: 10, seats_booked: 0,
    status: 'OPEN', formation_status: 'COLLECTING', ...fields.departure,
  })).error).toBeNull();
  return { tripId, planId, departureId };
}

const args = (departureId: string, expectedTotal: number) => ({
  p_tenant: SHOP_A.id,
  p_order_no: `T749${randomUUID().slice(0, 8)}`,
  p_departure: departureId,
  p_party_size: 3,
  p_customer: null,
  p_contact: { name: '#749 probe', phone: '0912345678' },
  p_source: 'MANUAL',
  p_payment_method: null,
  p_note: '#749 probe',
  p_hold_expires: null,
  p_expected_total: expectedTotal,
});

describe('#749 / 0137 create_tour_order_quoted 價格鎖定', () => {
  it('expected total matches: creates the order with the same total_amount', async () => {
    const { departureId } = await fixture();
    const { data: id, error } = await admin.rpc('create_tour_order_quoted', args(departureId, 3000));
    expect(error).toBeNull();
    expect(id).toBeTruthy();
    orderIds.push(id as string);
    const row = await admin.from('tour_orders').select('total_amount, unit_price').eq('id', id as string).single();
    expect(row.error).toBeNull();
    expect(Number(row.data!.total_amount)).toBe(3000);
    expect(Number(row.data!.unit_price)).toBe(1000);
  });

  it('expected total differs: raises PRICE_CHANGED with current quote, and leaves no order or reserved seats', async () => {
    const { departureId } = await fixture();
    const result = await admin.rpc('create_tour_order_quoted', args(departureId, 2500));
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('PRICE_CHANGED');
    expect(result.error?.code).toBe('P0004');
    expect(JSON.parse(result.error!.details as string)).toEqual({ unitPrice: 1000, total: 3000 });
    const orders = await admin.from('tour_orders').select('id').eq('departure_id', departureId);
    expect(orders.error).toBeNull();
    expect(orders.data).toEqual([]);
    const dep = await admin.from('trip_departures').select('seats_booked').eq('id', departureId).single();
    expect(dep.error).toBeNull();
    expect(dep.data!.seats_booked).toBe(0);
  });

  it('another tenant id for an existing departure is rejected with DEPARTURE_NOT_FOUND and leaves no order or reserved seats', async () => {
    const { departureId } = await fixture();
    const result = await admin.rpc('create_tour_order_quoted', { ...args(departureId, 3000), p_tenant: SHOP_B.id });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('DEPARTURE_NOT_FOUND');
    const orders = await admin.from('tour_orders').select('id').eq('departure_id', departureId);
    expect(orders.error).toBeNull();
    expect(orders.data).toEqual([]);
    const dep = await admin.from('trip_departures').select('seats_booked').eq('id', departureId).single();
    expect(dep.error).toBeNull();
    expect(dep.data!.seats_booked).toBe(0);
  });

  it('anon and authenticated roles cannot execute create_tour_order_quoted directly and no order is created', async () => {
    const { departureId } = await fixture();
    for (const caller of [anon, authenticated]) {
      const result = await caller.rpc('create_tour_order_quoted', args(departureId, 3000));
      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
      expect(result.error?.code === '42501' || /permission denied|could not find the function/i.test(result.error?.message ?? '')).toBe(true);
    }
    const orders = await admin.from('tour_orders').select('id').eq('departure_id', departureId);
    expect(orders.error).toBeNull();
    expect(orders.data).toEqual([]);
    const dep = await admin.from('trip_departures').select('seats_booked').eq('id', departureId).single();
    expect(dep.data!.seats_booked).toBe(0);
  });
});
