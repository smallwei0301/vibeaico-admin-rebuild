/** #41 lifecycle epochs: run only on the serialized TEST Supabase lane. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';

const url = () => process.env.TEST_SUPABASE_URL!;
const serviceKey = () => process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = () => process.env.TEST_SUPABASE_ANON_KEY!;
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

let admin: SupabaseClient;
let ownerId: string;
let tripId: string;
let cycleDepartureId: string;
let deadlineDepartureId: string;
const orderIds: string[] = [];
const departureIds: string[] = [];

async function createOrder(departureId: string, label: string) {
  const created = await admin.rpc('create_tour_order', {
    p_tenant: SHOP_A.id,
    p_departure: departureId,
    p_party: 1,
    p_customer_name: `formation ${label}`,
    p_customer_phone: '0900000000',
    p_source: 'MANUAL',
    p_note: '',
    p_payment_method: null,
    p_customer: null,
    p_hold_expires: null,
  });
  expect(created.error, JSON.stringify(created.error)).toBeNull();
  const id = created.data as string;
  orderIds.push(id);
  return id;
}

async function setQualified(orderId: string, status: 'CONFIRMED' | 'CANCELLED') {
  const update = await admin.from('tour_orders').update(
    status === 'CONFIRMED'
      ? { status, payment_status: 'PAID', paid_amount: 100 }
      : { status },
  ).eq('id', orderId);
  expect(update.error, JSON.stringify(update.error)).toBeNull();
}

async function eventsFor(departureId: string, eventName: string) {
  const result = await admin.from('notification_outbox')
    .select('idempotency_key, payload')
    .eq('aggregate_id', departureId)
    .eq('event_name', eventName)
    .order('created_at');
  expect(result.error, JSON.stringify(result.error)).toBeNull();
  return result.data ?? [];
}

beforeAll(async () => {
  expect(url()).toBeTruthy();
  expect(serviceKey()).toBeTruthy();
  expect(anonKey()).toBeTruthy();
  admin = createClient(url(), serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  const owner = await admin.from('tenant_users').select('user_id')
    .eq('tenant_id', SHOP_A.id).eq('role', 'OWNER').single();
  expect(owner.error, JSON.stringify(owner.error)).toBeNull();
  ownerId = owner.data!.user_id;

  const trip = await admin.from('trips').insert({
    tenant_id: SHOP_A.id,
    slug: `formation-epoch-${randomUUID()}`,
    title: 'formation epoch integration',
    status: 'PUBLISHED',
  }).select('id').single();
  expect(trip.error, JSON.stringify(trip.error)).toBeNull();
  tripId = trip.data!.id;

  const plans = await admin.from('trip_plans').insert([
    {
      tenant_id: SHOP_A.id, trip_id: tripId, slug: 'cycle', name: 'cycle',
      base_price: 100, price_type: 'PER_PERSON', deposit_mode: 'FULL', deposit_value: 0,
      min_to_depart: 2, max_participants: 10, formation_deadline_days_before: 10,
    },
    {
      tenant_id: SHOP_A.id, trip_id: tripId, slug: 'deadline', name: 'deadline',
      base_price: 100, price_type: 'PER_PERSON', deposit_mode: 'FULL', deposit_value: 0,
      min_to_depart: 3, max_participants: 10, formation_deadline_days_before: 10,
    },
  ]).select('id, slug');
  expect(plans.error, JSON.stringify(plans.error)).toBeNull();

  const cyclePlanId = plans.data!.find((plan) => plan.slug === 'cycle')!.id;
  const deadlinePlanId = plans.data!.find((plan) => plan.slug === 'deadline')!.id;
  const deadline = new Date(Date.now() + 86_400_000).toISOString();
  const departures = await admin.from('trip_departures').insert([
    {
      tenant_id: SHOP_A.id, trip_id: tripId, plan_id: cyclePlanId,
      departs_on: futureDate(40), capacity: 10, status: 'OPEN',
    },
    {
      tenant_id: SHOP_A.id, trip_id: tripId, plan_id: deadlinePlanId,
      departs_on: futureDate(45), capacity: 10, status: 'OPEN', formation_deadline_at: deadline,
    },
  ]).select('id, plan_id, min_to_depart_snapshot, formation_deadline_at');
  expect(departures.error, JSON.stringify(departures.error)).toBeNull();
  const cycle = departures.data!.find((departure) => departure.plan_id === cyclePlanId)!;
  const deadlineDeparture = departures.data!.find((departure) => departure.plan_id === deadlinePlanId)!;
  cycleDepartureId = cycle.id;
  deadlineDepartureId = deadlineDeparture.id;
  departureIds.push(cycleDepartureId, deadlineDepartureId);

  // Snapshot is persistent on the departure; later Plan edits cannot change it.
  expect(cycle.min_to_depart_snapshot).toBe(2);
  expect(cycle.formation_deadline_at).toBeTruthy();
  expect(deadlineDeparture.min_to_depart_snapshot).toBe(3);
});

afterAll(async () => {
  if (!admin) return;
  if (departureIds.length) {
    await admin.from('notification_outbox').delete().in('aggregate_id', departureIds);
    await admin.from('tour_formation_decisions').delete().in('departure_id', departureIds);
  }
  if (orderIds.length) await admin.from('tour_orders').delete().in('id', orderIds);
  if (tripId) await admin.from('trips').delete().eq('id', tripId);
});

describe('Issue #41 persisted formation lifecycle', () => {
  it('serializes concurrent qualifying writes into one FORMEd epoch, then emits a later same-count AT_RISK epoch', async () => {
    const first = await createOrder(cycleDepartureId, 'first');
    const second = await createOrder(cycleDepartureId, 'second');

    // Both writes invoke the same locked departure refresh.  Exactly one may
    // make COLLECTING -> FORMED even when the two payment confirmations race.
    await Promise.all([setQualified(first, 'CONFIRMED'), setQualified(second, 'CONFIRMED')]);
    const formed = await eventsFor(cycleDepartureId, 'TOUR_GROUP_FORMED');
    expect(formed).toHaveLength(1);
    expect(formed[0]!.idempotency_key).toBe(`tour-group-formed:${cycleDepartureId}:r1`);

    await setQualified(first, 'CANCELLED');
    const firstRisk = await eventsFor(cycleDepartureId, 'TOUR_GROUP_AT_RISK');
    expect(firstRisk).toHaveLength(1);
    expect(firstRisk[0]!.idempotency_key).toBe(`tour-group-at-risk:${cycleDepartureId}:1:r2`);

    const continueDecision = await admin.rpc('decide_tour_formation', {
      p_tenant: SHOP_A.id, p_departure: cycleDepartureId, p_decision: 'CONTINUE',
      p_actor_user: ownerId, p_new_deadline: null, p_note: 'first risk accepted',
    });
    expect(continueDecision.error, JSON.stringify(continueDecision.error)).toBeNull();

    // Recover above threshold, then drop to the exact same participant count.
    // The stored transition revision makes this a new outbox event, not a
    // conflict with the old :1 count key.
    await setQualified(first, 'CONFIRMED');
    await setQualified(first, 'CANCELLED');
    const risks = await eventsFor(cycleDepartureId, 'TOUR_GROUP_AT_RISK');
    expect(risks.map((event) => event.idempotency_key)).toEqual([
      `tour-group-at-risk:${cycleDepartureId}:1:r2`,
      `tour-group-at-risk:${cycleDepartureId}:1:r4`,
    ]);
    expect(risks.map((event) => (event.payload as { formationTransitionRevision: number }).formationTransitionRevision))
      .toEqual([2, 4]);
  });

  it('emits a fresh REVIEW_REQUIRED epoch after EXTEND and the next deadline', async () => {
    const firstReviewAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const firstReview = await admin.rpc('review_expired_tour_formations', { p_now: firstReviewAt });
    expect(firstReview.error, JSON.stringify(firstReview.error)).toBeNull();

    const initialEvents = await eventsFor(deadlineDepartureId, 'TOUR_GROUP_REVIEW_REQUIRED');
    expect(initialEvents).toHaveLength(1);
    expect(initialEvents[0]!.idempotency_key).toBe(`tour-group-review-required:${deadlineDepartureId}:r1`);

    const extendedDeadline = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const extend = await admin.rpc('decide_tour_formation', {
      p_tenant: SHOP_A.id, p_departure: deadlineDepartureId, p_decision: 'EXTEND',
      p_actor_user: ownerId, p_new_deadline: extendedDeadline, p_note: 'extend once',
    });
    expect(extend.error, JSON.stringify(extend.error)).toBeNull();
    const secondReview = await admin.rpc('review_expired_tour_formations', {
      p_now: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    });
    expect(secondReview.error, JSON.stringify(secondReview.error)).toBeNull();

    const events = await eventsFor(deadlineDepartureId, 'TOUR_GROUP_REVIEW_REQUIRED');
    expect(events.map((event) => event.idempotency_key)).toEqual([
      `tour-group-review-required:${deadlineDepartureId}:r1`,
      `tour-group-review-required:${deadlineDepartureId}:r3`,
    ]);
  });

  it('keeps lifecycle internals out of anon and authenticated RPC access', async () => {
    const anon = createClient(url(), anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const args = {
      p_tenant: SHOP_A.id, p_event_name: 'TOUR_GROUP_FORMED', p_aggregate_type: 'TOUR_DEPARTURE',
      p_aggregate_id: cycleDepartureId, p_idempotency_key: `forbidden-${randomUUID()}`, p_payload: {},
    };
    expect((await anon.rpc('enqueue_formation_notification_41', args)).error?.code).toBe('42501');
    expect((await admin.rpc('enqueue_formation_notification_41', args)).error?.code).toBe('42501');

    const owner = createClient(url(), anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await owner.auth.signInWithPassword(SHOP_A.owner)).error).toBeNull();
    expect((await owner.rpc('decide_tour_formation', {
      p_tenant: SHOP_A.id, p_departure: cycleDepartureId, p_decision: 'CONTINUE',
      p_actor_user: ownerId, p_new_deadline: null, p_note: 'forbidden direct RPC',
    })).error?.code).toBe('42501');
  });
});
