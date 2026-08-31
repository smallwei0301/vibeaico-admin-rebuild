/** #41 HTTP boundaries: provider and completion are explicitly fail-closed. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
let admin: SupabaseClient;
let owner: AuthedApi;
let tripId = '';
let departureId = '';
let orderId = '';

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  owner = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  const trip = await admin.from('trips').insert({
    tenant_id: SHOP_A.id, slug: `tour-http-${randomUUID()}`, title: 'tour HTTP contracts', status: 'PUBLISHED',
  }).select('id').single();
  expect(trip.error, JSON.stringify(trip.error)).toBeNull();
  tripId = trip.data!.id;
  const plan = await admin.from('trip_plans').insert({
    tenant_id: SHOP_A.id, trip_id: tripId, slug: 'http', name: 'http', base_price: 100,
    price_type: 'PER_PERSON', deposit_mode: 'FULL', deposit_value: 0, min_to_depart: 9,
    max_participants: 10, formation_deadline_days_before: 10,
  }).select('id').single();
  expect(plan.error, JSON.stringify(plan.error)).toBeNull();
  const departure = await admin.from('trip_departures').insert({
    tenant_id: SHOP_A.id, trip_id: tripId, plan_id: plan.data!.id,
    departs_on: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10), capacity: 10, status: 'OPEN',
  }).select('id').single();
  expect(departure.error, JSON.stringify(departure.error)).toBeNull();
  departureId = departure.data!.id;
  const order = await admin.rpc('create_tour_order', {
    p_tenant: SHOP_A.id, p_departure: departureId, p_party: 1,
    p_customer_name: 'HTTP contract', p_customer_phone: '0900000000', p_source: 'MANUAL',
    p_note: '', p_payment_method: null, p_customer: null, p_hold_expires: null,
  });
  expect(order.error, JSON.stringify(order.error)).toBeNull();
  orderId = order.data as string;
});

afterAll(async () => {
  if (departureId) await admin.from('notification_outbox').delete().eq('aggregate_id', departureId);
  if (tripId) await admin.from('trips').delete().eq('id', tripId);
});

describe('Issue #41 tour-order HTTP contracts', () => {
  it('accepts a bank receipt through HTTP, then leaves provider callback fail-closed until #9', async () => {
    const receipt = `http-bank-${randomUUID()}`;
    const confirmed = await owner.post(`/api/tour-orders/${orderId}/confirm-payment`, {
      amount: 100, receiptReference: receipt,
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ success: true, data: { orderId } });

    const provider = await fetch(`${BASE}/api/tour-orders/${orderId}/provider-success`, { method: 'POST' });
    expect(provider.status).toBe(503);
    expect(await provider.json()).toMatchObject({
      success: false, code: 'PAYMENT_PROVIDER_BLOCKED_BY_DEPENDENCY_9',
    });
  });

  it('does not fake completion while #37 atomic performance is unavailable', async () => {
    const completion = await owner.post(`/api/tour-orders/${orderId}/complete`);
    expect(completion.status).toBe(503);
    expect(await completion.json()).toMatchObject({
      success: false, code: 'TOUR_COMPLETION_BLOCKED_BY_DEPENDENCY_37',
    });
    const state = await admin.from('tour_orders').select('status').eq('id', orderId).single();
    expect(state.data?.status).toBe('CONFIRMED');
  });
});
