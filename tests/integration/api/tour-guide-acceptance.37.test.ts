import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type Slot = { start: string; end: string; staffIds: string[] };

const DAY_MS = 24 * 60 * 60 * 1000;

function futureWednesday(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * DAY_MS);
  date.setUTCDate(date.getUTCDate() + ((3 - date.getUTCDay() + 7) % 7));
  return date.toISOString().slice(0, 10);
}

function taipeiIso(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute)).toISOString();
}

async function json<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let tripId = '';
let planId = '';
let customerId = '';
let foreignStaffId = '';
const bookingIds: string[] = [];
const orderIds: string[] = [];

async function departure(params: {
  date: string;
  time: string;
  primaryStaffId: string;
}): Promise<Response> {
  return ownerA.post(`/api/trips/${tripId}/departures`, {
    planId,
    departsOn: params.date,
    startTime: params.time,
    capacity: 8,
    primaryStaffId: params.primaryStaffId,
  });
}

async function slots(date: string): Promise<Slot[]> {
  const response = await ownerA.get(
    `/api/bookings/available-slots?serviceId=${SHOP_A.serviceA1}&date=${date}`,
  );
  const body = await json<{ slots: Slot[] }>(response);
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data!.slots;
}

function slotAt(all: Slot[], date: string, time: string): Slot {
  const slot = all.find((item) => item.start === taipeiIso(date, time));
  expect(slot).toBeDefined();
  return slot!;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  customerId = randomUUID();
  const customer = await admin.from('customers').insert({
    id: customerId, tenant_id: SHOP_A.id, name: '37 acceptance traveler', phone: '', points: 0, active: true,
  });
  expect(customer.error).toBeNull();

  const { data: trip, error: tripError } = await admin.from('trips').insert({
    tenant_id: SHOP_A.id,
    slug: `itest-tour-guide-acceptance-${Date.now()}`,
    title: 'tour guide acceptance',
    status: 'DRAFT',
  }).select('id').single();
  expect(tripError).toBeNull();
  tripId = trip!.id;

  const { data: plan, error: planError } = await admin.from('trip_plans').insert({
    tenant_id: SHOP_A.id,
    trip_id: tripId,
    name: 'tour guide acceptance plan',
    base_price: 1000,
    duration_minutes: 120,
  }).select('id').single();
  expect(planError).toBeNull();
  planId = plan!.id;

  foreignStaffId = randomUUID();
  const foreignStaff = await admin.from('staff').insert({
    id: foreignStaffId,
    tenant_id: SHOP_B.id,
    name: 'foreign guide',
    active: true,
    bookable: true,
    availability_policy: 'DEFAULT_AVAILABLE',
  });
  expect(foreignStaff.error).toBeNull();
});

afterAll(async () => {
  if (orderIds.length) await admin.from('tour_orders').delete().in('id', orderIds);
  if (bookingIds.length) await admin.from('bookings').delete().in('id', bookingIds);
  if (tripId) await admin.from('trips').delete().eq('id', tripId);
  if (customerId) await admin.from('customers').delete().eq('id', customerId);
  if (foreignStaffId) await admin.from('staff').delete().eq('id', foreignStaffId);
});

describe('issue #37 persisted availability and C+ contracts', () => {
  it('blocks a departure that overlaps a normal booking without leaving a departure or assignment', async () => {
    const date = futureWednesday(910);
    const booking = await ownerA.post('/api/bookings', {
      customerId,
      serviceId: SHOP_A.serviceA1,
      staffId: SHOP_A.staffA1,
      startAt: taipeiIso(date, '09:00'),
      note: 'tour overlap acceptance',
    });
    const bookingBody = await json<{ id: string }>(booking);
    expect(booking.status, JSON.stringify(bookingBody)).toBe(200);
    bookingIds.push(bookingBody.data!.id);

    const before = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true }).eq('trip_id', tripId);
    const response = await departure({ date, time: '09:00', primaryStaffId: SHOP_A.staffA1 });
    const body = await json(response);
    expect(response.status, JSON.stringify(body)).toBe(409);

    const after = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true }).eq('trip_id', tripId);
    expect(after.count).toBe(before.count);
  });

  it('removes every assigned guide from slots, CANCELLED releases them, and reassignment moves occupancy', async () => {
    const date = futureWednesday(920);
    const created = await departure({ date, time: '09:00', primaryStaffId: SHOP_A.staffA1 });
    const createdBody = await json<{ id: string }>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(200);
    const departureId = createdBody.data!.id;

    const occupied = slotAt(await slots(date), date, '09:00');
    expect(occupied.staffIds).not.toContain(SHOP_A.staffA1);
    expect(occupied.staffIds).toContain(SHOP_A.staffA2);

    const cancelled = await ownerA.put(`/api/trip-departures/${departureId}`, { status: 'CANCELLED' });
    expect(cancelled.status, await cancelled.text()).toBe(200);
    const released = slotAt(await slots(date), date, '09:00');
    expect(released.staffIds).toContain(SHOP_A.staffA1);

    const reassigned = await ownerA.put(`/api/trip-departures/${departureId}`, {
      status: 'OPEN',
      primaryStaffId: SHOP_A.staffA2,
    });
    expect(reassigned.status, await reassigned.text()).toBe(200);
    const moved = slotAt(await slots(date), date, '09:00');
    expect(moved.staffIds).toContain(SHOP_A.staffA1);
    expect(moved.staffIds).not.toContain(SHOP_A.staffA2);

    const { data: assignments, error } = await admin.from('trip_departure_staff')
      .select('staff_id, role').eq('departure_id', departureId);
    expect(error).toBeNull();
    expect(assignments).toEqual([{ staff_id: SHOP_A.staffA2, role: 'PRIMARY' }]);
  });

  it('rejects a foreign-tenant guide id without creating a half departure', async () => {
    const before = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true }).eq('trip_id', tripId);
    const response = await departure({
      date: futureWednesday(930),
      time: '09:00',
      primaryStaffId: foreignStaffId,
    });
    const body = await json(response);
    expect(response.status, JSON.stringify(body)).toBe(404);
    expect(body.code).toBe('REQ_002');

    const after = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true }).eq('trip_id', tripId);
    expect(after.count).toBe(before.count);
  });

  it('freezes PRIMARY, SPECIFIC_STAFF, and NONE tour-addon performance on completion', async () => {
    const date = futureWednesday(940);
    const created = await departure({ date, time: '09:00', primaryStaffId: SHOP_A.staffA1 });
    const dep = await json<{ id: string }>(created);
    expect(created.status, JSON.stringify(dep)).toBe(200);

    const manual = await ownerA.post('/api/tour-orders/manual', {
      departureId: dep.data!.id,
      customerName: 'performance traveler',
      customerPhone: '0900000000',
      partySize: 1,
    });
    const order = await json<{ id: string }>(manual);
    expect(manual.status, JSON.stringify(order)).toBe(200);
    const orderId = order.data!.id;
    orderIds.push(orderId);

    for (const addon of [
      { name: 'primary addon', unitPrice: 30, quantity: 2, performanceMode: 'PRIMARY' },
      { name: 'specific addon', unitPrice: 20, quantity: 3, performanceMode: 'SPECIFIC_STAFF', specificStaffId: SHOP_A.staffA2 },
      { name: 'none addon', unitPrice: 10, quantity: 1, performanceMode: 'NONE' },
    ]) {
      const response = await ownerA.post(`/api/tour-orders/${orderId}/addons`, addon);
      expect(response.status, await response.text()).toBe(200);
    }

    const paid = await ownerA.post(`/api/tour-orders/${orderId}/confirm-payment`);
    expect(paid.status, await paid.text()).toBe(200);
    const completed = await ownerA.post(`/api/tour-orders/${orderId}/complete`);
    expect(completed.status, await completed.text()).toBe(200);

    const { data: addons, error } = await admin.from('tour_order_addons')
      .select('name, performance_mode, performance_staff_id, performance_amount, performance_frozen_at')
      .eq('tenant_id', SHOP_A.id).eq('order_id', orderId).order('name');
    expect(error).toBeNull();
    expect(addons).toEqual([
      expect.objectContaining({
        name: 'none addon',
        performance_mode: 'NONE',
        performance_staff_id: null,
        performance_amount: null,
        performance_frozen_at: expect.any(String),
      }),
      expect.objectContaining({
        name: 'primary addon',
        performance_mode: 'PRIMARY',
        performance_staff_id: SHOP_A.staffA1,
        performance_amount: 60,
        performance_frozen_at: expect.any(String),
      }),
      expect.objectContaining({
        name: 'specific addon',
        performance_mode: 'SPECIFIC_STAFF',
        performance_staff_id: SHOP_A.staffA2,
        performance_amount: 60,
        performance_frozen_at: expect.any(String),
      }),
    ]);
  });
});
