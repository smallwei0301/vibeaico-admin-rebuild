/** #42 / 0128 + 0132: real HTTP persistence → real RPC order snapshots.
 * No mocked transport/RPC, schema installation, shared seed mutation or provider calls.
 * Missing canonical schema is a failure, never a skip.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { readTourSeedFields } from '../../../scripts/test/tour-seed-profile.mjs';
import { resolveSeasonUnitPrice } from '../../../src/lib/public-season-price';
import { resolveBookingTotal } from '../../../src/lib/public-booking-price';

type Season = {
  name: string; startMonth: number; startDay: number; endMonth: number; endDay: number;
  priceOverride: number | null; sortOrder: number; active: boolean;
};
const summer = (priceOverride: number | null, sortOrder = 0): Season => ({
  name: 'summer', startMonth: 6, startDay: 1, endMonth: 8, endDay: 31,
  priceOverride, sortOrder, active: true,
});
const winter: Season = { ...summer(1700), name: 'winter', startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 };
const narrow = (priceOverride: number | null, sortOrder = 0): Season => ({
  ...summer(priceOverride, sortOrder), name: 'short', startMonth: 7, startDay: 10, endMonth: 7, endDay: 20,
});
let admin: SupabaseClient;
let owner: AuthedApi;
let otherOwner: AuthedApi;
const tripIds: string[] = [];
const planIds: string[] = [];
const departureIds: string[] = [];
const seasonIds: string[] = [];
const orderIds: string[] = [];

async function data<T = any>(response: Response): Promise<T> {
  const envelope = await response.json();
  expect(response.status).toBe(200);
  expect(envelope.success).toBe(true);
  return envelope.data as T;
}
async function rawOrder(id: string) {
  const result = await admin.from('tour_orders').select('*').eq('id', id).single();
  expect(result.error).toBeNull();
  return result.data!;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  owner = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  otherOwner = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterEach(async () => {
  if (!admin || !tripIds.length) return;
  const failures: unknown[] = [];
  // Discover HTTP-generated IDs even if creation succeeded but its response/assertion failed.
  // Each lookup is limited to our recorded, newly allocated parent IDs, never a shared seed.
  for (const [table, column, parents, ids] of [
    ['tour_orders', 'trip_id', tripIds, orderIds],
    ['trip_departures', 'trip_id', tripIds, departureIds],
    ['trip_plan_seasons', 'plan_id', planIds, seasonIds],
    ['trip_plans', 'trip_id', tripIds, planIds],
  ] as const) {
    if (!parents.length) continue;
    const result = await admin.from(table).select('id').eq('tenant_id', SHOP_A.id).in(column, [...parents]);
    if (result.error) failures.push(result.error);
    else for (const row of result.data ?? []) if (!ids.includes(row.id)) ids.push(row.id);
    const deleted = await admin.from(table).delete().eq('tenant_id', SHOP_A.id).in(column, [...parents]);
    if (deleted.error) failures.push(deleted.error);
  }
  const deleted = await admin.from('trips').delete().eq('tenant_id', SHOP_A.id).in('id', [...tripIds]);
  if (deleted.error) failures.push(deleted.error);
  for (const [table, ids] of [
    ['tour_orders', orderIds], ['trip_departures', departureIds], ['trip_plan_seasons', seasonIds],
    ['trip_plans', planIds], ['trips', tripIds],
  ] as const) {
    if (!ids.length) continue;
    const result = await admin.from(table).select('id').in('id', [...ids]);
    if (result.error) failures.push(result.error);
    else if (result.data?.length) failures.push(new Error(`${table}: owned fixture cleanup left rows`));
  }
  if (failures.length) throw new AggregateError(failures, '#42 seasonal snapshot cleanup failed');
  for (const ids of [tripIds, planIds, departureIds, seasonIds, orderIds]) ids.length = 0;
});

async function fixture(date: string, priceType: 'PER_PERSON' | 'PER_GROUP', fixed = false) {
  const tripId = randomUUID(); tripIds.push(tripId);
  const planId = randomUUID(); planIds.push(planId);
  const departureId = randomUUID(); departureIds.push(departureId);
  const deadline = `${date}T00:00:00.000Z`;
  const fields = await readTourSeedFields(admin, deadline, 'CANONICAL_CORE');
  expect((await admin.from('trips').insert({
    id: tripId, tenant_id: SHOP_A.id, slug: `snapshot-42-${tripId}`,
    title: 'owned seasonal snapshot fixture', duration_hours: 3, status: 'PUBLISHED',
  })).error).toBeNull();
  expect((await admin.from('trip_plans').insert({
    id: planId, tenant_id: SHOP_A.id, trip_id: tripId, name: 'owned snapshot plan',
    price_per_person: 1000, price_type: priceType, year_round: true,
    min_party: 1, max_party: 10, sales_mode: 'REQUEST', participation_mode: 'PRIVATE',
    deposit_mode: fixed ? 'DEPOSIT_FIXED' : 'DEPOSIT_PERCENT', deposit_value: fixed ? 400 : 25,
    ...fields.plan,
  })).error).toBeNull();
  expect((await admin.from('trip_departures').insert({
    id: departureId, tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
    departs_on: date, start_time: '09:00', capacity: 10, seats_booked: 0,
    status: 'OPEN', formation_status: 'COLLECTING', ...fields.departure,
  })).error).toBeNull();
  return { tripId, planId, departureId };
}

const scenarios = [
  { name: 'normal PER_PERSON × 3', date: '2042-07-15', type: 'PER_PERSON', seasons: [summer(1800)], unit: 1800, total: 5400, deposit: 1350 },
  { name: 'normal PER_GROUP ignores party multiplier / fixed deposit', date: '2042-07-15', type: 'PER_GROUP', seasons: [summer(1800)], unit: 1800, total: 1800, deposit: 400, fixed: true },
  { name: 'cross-year January inclusive endpoint', date: '2042-02-28', type: 'PER_PERSON', seasons: [winter], unit: 1700, total: 5100, deposit: 1275 },
  { name: 'cross-year December inclusive endpoint', date: '2042-12-01', type: 'PER_GROUP', seasons: [winter], unit: 1700, total: 1700, deposit: 425 },
  { name: 'cross-year outside range uses base', date: '2042-03-01', type: 'PER_PERSON', seasons: [winter], unit: 1000, total: 3000, deposit: 750 },
  { name: 'winning null override uses base, not broader season price', date: '2042-07-15', type: 'PER_PERSON', seasons: [summer(1800), narrow(null)], unit: 1000, total: 3000, deposit: 750 },
  { name: 'shortest span beats earlier sortOrder and inactive narrower season', date: '2042-07-15', type: 'PER_PERSON', seasons: [summer(1800, -10), narrow(2200, 10), { ...narrow(9900, -20), startDay: 15, endDay: 15, active: false }], unit: 2200, total: 6600, deposit: 1650 },
  { name: 'equal span chooses smaller sortOrder', date: '2042-07-15', type: 'PER_GROUP', seasons: [narrow(2200, 5), narrow(2300, 1)], unit: 2300, total: 2300, deposit: 575 },
  { name: 'zero override is a real free price, not base fallback', date: '2042-07-15', type: 'PER_PERSON', seasons: [summer(0)], unit: 0, total: 0, deposit: 0 },
  { name: 'equal span and sortOrder uses stable id tie-break', date: '2042-07-15', type: 'PER_PERSON', seasons: [narrow(2400), narrow(2600)], unit: 0, total: 0, deposit: 0, idTie: true },
] as const;

describe('#42 persisted seasonal prices become immutable TourOrder snapshots', () => {
  it.each(scenarios)('$name', async (scenario) => {
    const fixtureIds = await fixture(scenario.date, scenario.type, 'fixed' in scenario);
    const { tripId, planId, departureId } = fixtureIds;
    const saved: Array<Season & { id: string }> = [];
    for (const season of scenario.seasons) {
      const created = await data<Season & { id: string }>(await owner.post(`/api/trip-plans/${planId}/seasons`, season));
      seasonIds.push(created.id);
      const { sortOrder: _sortOrder, ...publicSeason } = season;
      expect(created).toMatchObject(publicSeason);
      // sortOrder is persisted but intentionally absent from the current public mapper.
      created.sortOrder = season.sortOrder;
      saved.push(created);
    }
    const reload = await data<Array<Season & { id: string }>>(await owner.get(`/api/trip-plans/${planId}/seasons`));
    expect(reload).toHaveLength(saved.length);
    for (const season of saved) {
      const { sortOrder: _sortOrder, ...publicSeason } = season;
      expect(reload.find((row) => row.id === season.id)).toMatchObject(publicSeason);
    }
    const stored = await admin.from('trip_plan_seasons').select('*').eq('tenant_id', SHOP_A.id).eq('plan_id', planId);
    expect(stored.error).toBeNull();
    for (const season of saved) expect(stored.data!.find((row) => row.id === season.id)).toMatchObject({
      price_override: season.priceOverride, active: season.active, sort_order: season.sortOrder,
      start_month: season.startMonth, start_day: season.startDay, end_month: season.endMonth, end_day: season.endDay,
    });
    const unit = 'idTie' in scenario ? saved.toSorted((a, b) => a.id.localeCompare(b.id))[0].priceOverride! : scenario.unit;
    const total = 'idTie' in scenario ? unit * 3 : scenario.total;
    const deposit = 'idTie' in scenario ? Math.round(total * 0.25) : scenario.deposit;
    const snapshot = { unitPrice: unit, totalAmount: total, depositAmount: deposit };
    const createdOrder = await data<{ id: string }>(await owner.post('/api/tour-orders/manual', {
      departureId, customerName: 'owned snapshot traveler', customerPhone: '0912345678', partySize: 3,
    }));
    orderIds.push(createdOrder.id);
    expect(createdOrder).toMatchObject(snapshot);
    const before = await rawOrder(createdOrder.id);
    expect(before).toMatchObject({
      tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId, departure_id: departureId,
      unit_price: unit, total_amount: total, deposit_amount: deposit, seats_reserved: false,
    });
    // #11 交叉比對：公開頁／表單用的 resolveSeasonUnitPrice 與 resolveBookingTotal（同一組啟用季節、團次日期）
    // 必須等於 create_tour_order 實際寫入的 unit_price／total_amount（涵蓋命中、未命中、跨年、重疊、null override、
    // 0 元、id tie-break；停用的季節不參與）。
    const resolverUnit = resolveSeasonUnitPrice(
      scenario.date,
      saved.filter((season) => season.active).map((season) => ({
        id: season.id, startMonth: season.startMonth, startDay: season.startDay, endMonth: season.endMonth,
        endDay: season.endDay, priceOverride: season.priceOverride, sortOrder: season.sortOrder,
      })),
      1000,
    );
    expect(resolverUnit).toBe(Number(before.unit_price));
    expect(resolveBookingTotal({ unitPrice: resolverUnit }, { pricePerPerson: 1000, priceType: scenario.type, seasonalPricing: true }, 3))
      .toEqual({ unitPrice: Number(before.unit_price), total: Number(before.total_amount) });
    const own = await data(await owner.get(`/api/tour-orders?orderId=${createdOrder.id}`));
    expect(own.content).toHaveLength(1);
    expect(own.content[0]).toMatchObject({ id: createdOrder.id, ...snapshot });
    const foreign = await data(await otherOwner.get(`/api/tour-orders?orderId=${createdOrder.id}`));
    expect(foreign.content).toEqual([]);
    expect(foreign.totalElements).toBe(0);
    expect(await rawOrder(createdOrder.id)).toEqual(before);

    // Real PUT + separate GET proves mutations persisted, while old transaction rows remain untouched.
    for (const season of saved) {
      await data(await owner.put(`/api/trip-plan-seasons/${season.id}`, { priceOverride: 9000, active: false }));
    }
    const changedSeasons = await data<Array<{ priceOverride: number; active: boolean }>>(await owner.get(`/api/trip-plans/${planId}/seasons`));
    expect(changedSeasons.every((row) => row.priceOverride === 9000 && row.active === false)).toBe(true);
    await data(await owner.put(`/api/trip-plans/${planId}`, { pricePerPerson: 7000, depositMode: 'DEPOSIT_PERCENT', depositValue: 50 }));
    const changedPlans = await data<Array<{ id: string; basePrice: number; depositValue: number }>>(await owner.get(`/api/trips/${tripId}/plans`));
    expect(changedPlans.find((row) => row.id === planId)).toMatchObject({ basePrice: 7000, depositValue: 50 });
    expect(await rawOrder(createdOrder.id)).toEqual(before);
    const unchanged = await data(await owner.get(`/api/tour-orders?orderId=${createdOrder.id}`));
    expect(unchanged.content[0]).toMatchObject({ id: createdOrder.id, ...snapshot });
    // Positive control: a new order uses updated base/deposit, distinguishing snapshot protection
    // from a broken mutation endpoint or pricing resolver that never reloads its inputs.
    const next = await data<{ id: string }>(await owner.post('/api/tour-orders/manual', {
      departureId, customerName: 'new snapshot traveler', customerPhone: '0912345678', partySize: 3,
    }));
    orderIds.push(next.id);
    const nextTotal = scenario.type === 'PER_GROUP' ? 7000 : 21000;
    expect(next).toMatchObject({ unitPrice: 7000, totalAmount: nextTotal, depositAmount: nextTotal / 2 });
    expect(await rawOrder(next.id)).toMatchObject({ unit_price: 7000, total_amount: nextTotal, deposit_amount: nextTotal / 2 });
    expect(await rawOrder(createdOrder.id)).toEqual(before);
  });
});
