/** #41 lifecycle epochs: run only on the serialized TEST Supabase lane. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';

const url = () => process.env.TEST_SUPABASE_URL!;
const serviceKey = () => process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = () => process.env.TEST_SUPABASE_ANON_KEY!;
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

let admin: SupabaseClient;
let ownerId: string;
let ownerBId: string;
let tripId: string;
let cycleDepartureId: string;
let deadlineDepartureId: string;
let thresholdDepartureId: string;
let paymentDepartureId: string;
let cancellationDepartureId: string;
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

async function recordBankPayment(orderId: string, receiptReference: string, amount = 100) {
  return admin.rpc('record_tour_order_payment_41', {
    p_tenant: SHOP_A.id, p_order: orderId, p_actor_user: ownerId,
    p_amount: amount, p_channel: 'BANK_MANUAL', p_receipt_reference: receiptReference,
  });
}

async function cancelOrder(orderId: string, reason = 'integration cancellation') {
  return admin.rpc('cancel_tour_order_41', {
    p_tenant: SHOP_A.id, p_order: orderId, p_actor_user: ownerId, p_reason: reason,
  });
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
  const ownerB = await admin.from('tenant_users').select('user_id')
    .eq('tenant_id', SHOP_B.id).eq('role', 'OWNER').single();
  expect(ownerB.error, JSON.stringify(ownerB.error)).toBeNull();
  ownerBId = ownerB.data!.user_id;

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
    {
      tenant_id: SHOP_A.id, trip_id: tripId, slug: 'threshold-four', name: 'threshold-four',
      base_price: 100, price_type: 'PER_PERSON', deposit_mode: 'FULL', deposit_value: 0,
      min_to_depart: 4, max_participants: 10, formation_deadline_days_before: 10,
    },
    {
      tenant_id: SHOP_A.id, trip_id: tripId, slug: 'payment', name: 'payment',
      base_price: 100, price_type: 'PER_PERSON', deposit_mode: 'FULL', deposit_value: 0,
      min_to_depart: 9, max_participants: 10, formation_deadline_days_before: 10,
    },
    {
      tenant_id: SHOP_A.id, trip_id: tripId, slug: 'cancellation', name: 'cancellation',
      base_price: 100, price_type: 'PER_PERSON', deposit_mode: 'FULL', deposit_value: 0,
      min_to_depart: 2, max_participants: 10, formation_deadline_days_before: 10,
    },
  ]).select('id, slug');
  expect(plans.error, JSON.stringify(plans.error)).toBeNull();

  const cyclePlanId = plans.data!.find((plan) => plan.slug === 'cycle')!.id;
  const deadlinePlanId = plans.data!.find((plan) => plan.slug === 'deadline')!.id;
  const thresholdPlanId = plans.data!.find((plan) => plan.slug === 'threshold-four')!.id;
  const paymentPlanId = plans.data!.find((plan) => plan.slug === 'payment')!.id;
  const cancellationPlanId = plans.data!.find((plan) => plan.slug === 'cancellation')!.id;
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
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: thresholdPlanId, departs_on: futureDate(46), capacity: 10, status: 'OPEN' },
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: paymentPlanId, departs_on: futureDate(47), capacity: 10, status: 'OPEN' },
    { tenant_id: SHOP_A.id, trip_id: tripId, plan_id: cancellationPlanId, departs_on: futureDate(48), capacity: 10, status: 'OPEN' },
  ]).select('id, plan_id, min_to_depart_snapshot, formation_deadline_at');
  expect(departures.error, JSON.stringify(departures.error)).toBeNull();
  const cycle = departures.data!.find((departure) => departure.plan_id === cyclePlanId)!;
  const deadlineDeparture = departures.data!.find((departure) => departure.plan_id === deadlinePlanId)!;
  cycleDepartureId = cycle.id;
  deadlineDepartureId = deadlineDeparture.id;
  thresholdDepartureId = departures.data!.find((departure) => departure.plan_id === thresholdPlanId)!.id;
  paymentDepartureId = departures.data!.find((departure) => departure.plan_id === paymentPlanId)!.id;
  cancellationDepartureId = departures.data!.find((departure) => departure.plan_id === cancellationPlanId)!.id;
  departureIds.push(cycleDepartureId, deadlineDepartureId, thresholdDepartureId, paymentDepartureId, cancellationDepartureId);

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
    const [firstPayment, secondPayment] = await Promise.all([
      recordBankPayment(first, `cycle-first-${randomUUID()}`),
      recordBankPayment(second, `cycle-second-${randomUUID()}`),
    ]);
    expect(firstPayment.error, JSON.stringify(firstPayment.error)).toBeNull();
    expect(secondPayment.error, JSON.stringify(secondPayment.error)).toBeNull();
    const formed = await eventsFor(cycleDepartureId, 'TOUR_GROUP_FORMED');
    expect(formed).toHaveLength(1);
    expect(formed[0]!.idempotency_key).toBe(`tour-group-formed:${cycleDepartureId}:r1`);

    const firstCancel = await cancelOrder(first);
    expect(firstCancel.error, JSON.stringify(firstCancel.error)).toBeNull();
    const firstRisk = await eventsFor(cycleDepartureId, 'TOUR_GROUP_AT_RISK');
    expect(firstRisk).toHaveLength(1);
    expect(firstRisk[0]!.idempotency_key).toBe(`tour-group-at-risk:${cycleDepartureId}:1:r2`);

    const continueDecision = await admin.rpc('decide_tour_formation', {
      p_tenant: SHOP_A.id, p_departure: cycleDepartureId, p_decision: 'CONTINUE',
      p_actor_user: ownerId, p_new_deadline: null, p_note: 'first risk accepted',
    });
    expect(continueDecision.error, JSON.stringify(continueDecision.error)).toBeNull();

    // A new qualifying order restores the accepted group; cancelling that
    // order reaches the same 1-person risk count without ever resurrecting a
    // cancelled order by direct table write.
    const third = await createOrder(cycleDepartureId, 'third');
    const thirdPayment = await recordBankPayment(third, `cycle-third-${randomUUID()}`);
    expect(thirdPayment.error, JSON.stringify(thirdPayment.error)).toBeNull();
    const thirdCancel = await cancelOrder(third);
    expect(thirdCancel.error, JSON.stringify(thirdCancel.error)).toBeNull();
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

  it('keeps an unpaid hold out of the qualifying sum, then forms exactly at four paid participants', async () => {
    const hold = await admin.rpc('create_tour_order', {
      p_tenant: SHOP_A.id, p_departure: thresholdDepartureId, p_party: 1,
      p_customer_name: 'hold only', p_customer_phone: '0900000000', p_source: 'MANUAL',
      p_note: '', p_payment_method: null, p_customer: null,
      p_hold_expires: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(hold.error, JSON.stringify(hold.error)).toBeNull();
    orderIds.push(hold.data as string);
    const before = await admin.from('trip_departures').select('seats_booked, formation_status, formed_participants')
      .eq('id', thresholdDepartureId).single();
    expect(before.error, JSON.stringify(before.error)).toBeNull();
    expect(before.data).toMatchObject({ seats_booked: 1, formation_status: 'COLLECTING', formed_participants: null });

    for (let index = 0; index < 4; index += 1) {
      const order = await createOrder(thresholdDepartureId, `four-${index}`);
      const payment = await recordBankPayment(order, `threshold-four-${index}-${randomUUID()}`);
      expect(payment.error, JSON.stringify(payment.error)).toBeNull();
    }
    const after = await admin.from('trip_departures').select('seats_booked, formation_status, formed_participants')
      .eq('id', thresholdDepartureId).single();
    expect(after.error, JSON.stringify(after.error)).toBeNull();
    expect(after.data).toMatchObject({ seats_booked: 5, formation_status: 'FORMED', formed_participants: 4 });
  });

  it('records bank receipts once, rejects a conflicting replay, and rejects a cross-tenant actor/order pair', async () => {
    const first = await createOrder(paymentDepartureId, 'receipt-first');
    const reference = `receipt-${randomUUID()}`;
    const accepted = await recordBankPayment(first, reference);
    expect(accepted.error, JSON.stringify(accepted.error)).toBeNull();
    const replay = await recordBankPayment(first, reference);
    expect(replay.error, JSON.stringify(replay.error)).toBeNull();
    expect(replay.data).toBe(first);
    const receipts = await admin.from('tour_order_payment_receipts_41').select('id')
      .eq('tenant_id', SHOP_A.id).eq('channel', 'BANK_MANUAL').eq('receipt_reference', reference);
    expect(receipts.error, JSON.stringify(receipts.error)).toBeNull();
    expect(receipts.data).toHaveLength(1);

    const second = await createOrder(paymentDepartureId, 'receipt-second');
    const conflict = await recordBankPayment(second, reference);
    expect(conflict.error?.message).toContain('PAYMENT_RECEIPT_CONFLICT');
    const crossTenant = await admin.rpc('record_tour_order_payment_41', {
      p_tenant: SHOP_B.id, p_order: first, p_actor_user: ownerBId,
      p_amount: 100, p_channel: 'BANK_MANUAL', p_receipt_reference: `cross-${randomUUID()}`,
    });
    expect(crossTenant.error?.message).toContain('TOUR_ORDER_NOT_FOUND');
  });

  it('cancels one paid order atomically: capacity is released and refund stays pending', async () => {
    const order = await createOrder(cancellationDepartureId, 'cancel-paid');
    const paid = await recordBankPayment(order, `cancel-paid-${randomUUID()}`);
    expect(paid.error, JSON.stringify(paid.error)).toBeNull();
    const before = await admin.from('trip_departures').select('seats_booked').eq('id', cancellationDepartureId).single();
    expect(before.data?.seats_booked).toBe(1);
    const cancelled = await cancelOrder(order, 'traveller changed plans');
    expect(cancelled.error, JSON.stringify(cancelled.error)).toBeNull();
    const state = await admin.from('tour_orders').select('status, payment_status, refunded_amount')
      .eq('id', order).single();
    expect(state.data).toMatchObject({ status: 'CANCELLED', payment_status: 'REFUND_PENDING', refunded_amount: 0 });
    const after = await admin.from('trip_departures').select('seats_booked').eq('id', cancellationDepartureId).single();
    expect(after.data?.seats_booked).toBe(0);
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
