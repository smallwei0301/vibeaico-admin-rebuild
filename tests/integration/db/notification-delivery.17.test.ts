/** #40 / 17 §7 real TEST database and RPC contracts; source-only in review. */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { dispatchPendingNotifications } from '@/server/notifications/outbox';

let admin: SupabaseClient;
const outboxIds: string[] = [];
const bookingIds: string[] = [];

beforeAll(() => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
});

afterEach(async () => {
  if (bookingIds.length) expect((await admin.from('bookings').delete().in('id', bookingIds.splice(0))).error).toBeNull();
  if (outboxIds.length) expect((await admin.from('notification_outbox').delete().in('id', outboxIds.splice(0))).error).toBeNull();
});

async function createBooking() {
  const bookingId = randomUUID();
  bookingIds.push(bookingId);
  const { error } = await admin.from('bookings').insert({
    id: bookingId, tenant_id: SHOP_A.id, booking_no: `N40-${randomUUID()}`,
    customer_id: SHOP_A.customerA1, service_id: SHOP_A.serviceA1,
    start_at: '2031-01-04T10:00:00.000Z', end_at: '2031-01-04T11:00:00.000Z',
    duration_minutes: 60, price: 1, final_price: 1,
  });
  expect(error).toBeNull();
  const event = await admin.from('notification_outbox').select('id', { count: 'exact' })
    .eq('aggregate_id', bookingId).eq('event_name', 'BOOKING_CREATED');
  expect(event.error).toBeNull();
  expect(event.count).toBe(1);
  const outboxId = (event.data as Array<{ id: string }>)[0]!.id;
  outboxIds.push(outboxId);
  return { bookingId, outboxId };
}

describe('notification delivery ledger (17 §7)', () => {
  it('leaves zero events for a rejected business statement and commits one event for one booking', async () => {
    const failedBookingId = randomUUID();
    const { error: failed } = await admin.from('bookings').insert({
      id: failedBookingId, tenant_id: SHOP_A.id, booking_no: `N40-${randomUUID()}`,
      customer_id: SHOP_A.customerA1, service_id: SHOP_A.serviceA1,
      start_at: '2031-01-02T11:00:00.000Z', end_at: '2031-01-02T10:00:00.000Z', duration_minutes: 60, price: 1, final_price: 1,
    });
    expect(failed).not.toBeNull();
    const rollback = await admin.from('notification_outbox').select('*', { count: 'exact', head: true }).eq('aggregate_id', failedBookingId);
    expect(rollback.error).toBeNull();
    expect(rollback.count).toBe(0);

    const bookingId = randomUUID();
    bookingIds.push(bookingId);
    const { error: committed } = await admin.from('bookings').insert({
      id: bookingId, tenant_id: SHOP_A.id, booking_no: `N40-${randomUUID()}`,
      customer_id: SHOP_A.customerA1, service_id: SHOP_A.serviceA1,
      start_at: '2031-01-03T10:00:00.000Z', end_at: '2031-01-03T11:00:00.000Z', duration_minutes: 60, price: 1, final_price: 1,
    });
    expect(committed).toBeNull();
    const committedEvent = await admin.from('notification_outbox').select('id', { count: 'exact' })
      .eq('aggregate_id', bookingId).eq('event_name', 'BOOKING_CREATED');
    expect(committedEvent.error).toBeNull();
    expect(committedEvent.count).toBe(1);
    outboxIds.push((committedEvent.data as Array<{ id: string }>)[0]!.id);
  });

  it('is idempotent and gives a pending delivery to exactly one of two concurrent service workers', async () => {
    const { bookingId, outboxId } = await createBooking();
    // A repeated statement that does not change status cannot manufacture a
    // second event; the trigger remains the sole event writer.
    expect((await admin.from('bookings').update({ status: 'PENDING' }).eq('id', bookingId)).error).toBeNull();
    const events = await admin.from('notification_outbox').select('id', { count: 'exact' })
      .eq('aggregate_id', bookingId).eq('event_name', 'BOOKING_CREATED');
    expect(events.error).toBeNull();
    expect(events.count).toBe(1);
    const delivery = await admin.from('notification_deliveries').insert({
      outbox_id: outboxId, tenant_id: SHOP_A.id, recipient_type: 'TENANT_OWNER', recipient_ref: SHOP_A.id,
      channel: 'EMAIL', destination_ref: 'INTEGRATION_TEST', status: 'PENDING', next_attempt_at: new Date().toISOString(),
    }).select('id').single();
    expect(delivery.error).toBeNull();
    const workerTwo = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const [one, two] = await Promise.all([admin.rpc('claim_notification_deliveries', { p_limit: 1 }), workerTwo.rpc('claim_notification_deliveries', { p_limit: 1 })]);
    expect(one.error).toBeNull(); expect(two.error).toBeNull();
    expect((one.data?.length ?? 0) + (two.data?.length ?? 0)).toBe(1);
    expect(one.data?.[0]?.id ?? two.data?.[0]?.id).toBe(delivery.data!.id);
  });

  it('runs the real dispatcher transition through retry backoff and the fifth attempt to DEAD with a fake transport', async () => {
    const { outboxId } = await createBooking();
    const inserted = await admin.from('notification_deliveries').insert({
      outbox_id: outboxId, tenant_id: SHOP_A.id, recipient_type: 'TENANT_OWNER', recipient_ref: SHOP_A.id,
      channel: 'EMAIL', destination_ref: 'INTEGRATION_TEST', status: 'PENDING', next_attempt_at: new Date(0).toISOString(),
    }).select('id').single();
    expect(inserted.error).toBeNull();
    const claimedIds: string[] = [];
    const fakeRetryableTransport = async (delivery: { id: string }) => {
      claimedIds.push(delivery.id);
      return { kind: 'retryable' as const, code: 'TEST_RETRY' };
    };
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await dispatchPendingNotifications(admin, 1, false, fakeRetryableTransport)).toBe(1);
      expect(claimedIds.at(-1)).toBe(inserted.data!.id);
      const delivery = await admin.from('notification_deliveries').select('status, attempt_count, next_attempt_at')
        .eq('id', inserted.data!.id).single();
      expect(delivery.error).toBeNull();
      if (attempt < 5) {
        expect(delivery.data).toMatchObject({ status: 'RETRY', attempt_count: attempt });
        expect(Date.parse(delivery.data!.next_attempt_at as string)).toBeGreaterThan(Date.now() - 1_000);
        // Advance only the due time; the dispatcher itself computes attempt,
        // retry state, and the terminal fifth failure.
        expect((await admin.from('notification_deliveries').update({ next_attempt_at: new Date(0).toISOString() })
          .eq('id', inserted.data!.id)).error).toBeNull();
      } else {
        expect(delivery.data).toEqual({ status: 'DEAD', attempt_count: 5, next_attempt_at: null });
      }
    }
    const deadAlert = await admin.from('notification_outbox').select('id')
      .eq('idempotency_key', `delivery-dead:${inserted.data!.id}`).maybeSingle();
    expect(deadAlert.error).toBeNull();
    if (deadAlert.data) outboxIds.push(deadAlert.data.id);
  });

  it('allows service role and rejects anonymous plus authenticated callers', async () => {
    expect((await admin.rpc('claim_notification_deliveries', { p_limit: 1 })).error).toBeNull();
    const client = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.rpc('claim_notification_deliveries', { p_limit: 1 })).error?.code).toBe('42501');
    expect((await client.auth.signInWithPassword(SHOP_A.owner)).error).toBeNull();
    expect((await client.rpc('claim_notification_deliveries', { p_limit: 1 })).error?.code).toBe('42501');
  });

  it('rejects direct trigger-internal event enqueue RPCs for service, anonymous, and authenticated callers', async () => {
    const args = {
      p_tenant_id: SHOP_A.id, p_event_name: 'BOOKING_CREATED', p_aggregate_type: 'BOOKING',
      p_aggregate_id: randomUUID(), p_idempotency_key: `forbidden-${randomUUID()}`, p_payload: {},
    };
    expect((await admin.rpc('enqueue_notification_event', args)).error?.code).toBe('42501');
    const client = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.rpc('enqueue_notification_event', args)).error?.code).toBe('42501');
    expect((await client.auth.signInWithPassword(SHOP_A.owner)).error).toBeNull();
    expect((await client.rpc('enqueue_notification_event', args)).error?.code).toBe('42501');
  });

  it('never lease-reclaims an address-less auth delivery after its inline sender crashes', async () => {
    const auth = await admin.rpc('enqueue_auth_verification_delivery', {
      p_recipient_ref: `auth-itest-${randomUUID()}`, p_idempotency_key: `auth-itest-${randomUUID()}`,
    });
    expect(auth.error).toBeNull();
    const row = (Array.isArray(auth.data) ? auth.data[0] : auth.data) as { id: string; outbox_id: string };
    outboxIds.push(row.outbox_id);
    expect((await admin.from('notification_deliveries').update({ processing_started_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', row.id)).error).toBeNull();
    const claims = await admin.rpc('claim_notification_deliveries', { p_limit: 100 });
    expect(claims.error).toBeNull();
    expect((claims.data ?? []).map((claim: { id: string }) => claim.id)).not.toContain(row.id);
    const persisted = await admin.from('notification_deliveries').select('status, reclaimable').eq('id', row.id).single();
    expect(persisted.error).toBeNull();
    expect(persisted.data).toEqual({ status: 'PROCESSING', reclaimable: false });
  });
});
