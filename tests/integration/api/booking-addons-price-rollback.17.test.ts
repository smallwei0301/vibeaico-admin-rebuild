import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

let admin: SupabaseClient;
let ownerA: AuthedApi;
const bookings: string[] = [];
const customers: string[] = [];
let slot = 0;

function requiredTestEnv(name: 'TEST_SUPABASE_URL' | 'TEST_SUPABASE_SERVICE_ROLE_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`[Issue #17 price rollback] ${name} is required.`);
  return value;
}

function addonBody(body: Record<string, unknown>) {
  return { ...body, idempotencyKey: randomUUID() };
}

async function makeCustomer() {
  const id = randomUUID();
  customers.push(id);
  const { error } = await admin.from('customers').insert({
    id,
    tenant_id: SHOP_A.id,
    name: `I17 rollback ${id}`,
    phone: '',
  });
  expect(error).toBeNull();
  return id;
}

async function makeBooking() {
  const id = randomUUID();
  bookings.push(id);
  slot += 1;
  const startAt = new Date(Date.now() + (1200 + slot) * 86_400_000).toISOString();
  const endAt = new Date(Date.parse(startAt) + 3_600_000).toISOString();
  const { error } = await admin.from('bookings').insert({
    id,
    tenant_id: SHOP_A.id,
    booking_no: `I17R${id.slice(0, 7)}`,
    customer_id: await makeCustomer(),
    service_id: SHOP_A.serviceA1,
    staff_id: null,
    start_at: startAt,
    end_at: endAt,
    duration_minutes: 60,
    price: 1000,
    final_price: 1000,
    status: 'CONFIRMED',
    source: 'MANUAL',
  });
  expect(error).toBeNull();
  return id;
}

async function bookingPrice(id: string) {
  const { data, error } = await admin.from('bookings').select('final_price').eq('id', id).single();
  expect(error).toBeNull();
  return Number(data?.final_price);
}

async function addonCount(bookingId: string) {
  const { count, error } = await admin.from('booking_addons')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', bookingId);
  expect(error).toBeNull();
  return count ?? 0;
}

beforeAll(async () => {
  admin = createClient(
    requiredTestEnv('TEST_SUPABASE_URL'),
    requiredTestEnv('TEST_SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  if (bookings.length) {
    expect((await admin.from('booking_addons').delete().in('booking_id', bookings)).error).toBeNull();
    expect((await admin.from('bookings').delete().in('id', bookings)).error).toBeNull();
  }
  if (customers.length) expect((await admin.from('customers').delete().in('id', customers)).error).toBeNull();
});

describe('Issue #17 price-adjustment rollback acceptance', () => {
  it('subtracts the persisted applied_amount from a later adjusted final_price', async () => {
    const bookingId = await makeBooking();
    const created = await ownerA.post(`/api/bookings/${bookingId}/addons`, addonBody({
      name: 'rollback after adjustment',
      price: 200,
      quantity: 2,
      durationMinutes: 0,
      notify: false,
    }));
    expect(created.status).toBe(200);
    const createdBody = await created.json() as { data: { addon: { id: string } } };
    expect(await bookingPrice(bookingId)).toBe(1400);

    const adjusted = await ownerA.post(`/api/bookings/${bookingId}/adjust-price`, { finalPrice: 1300 });
    expect(adjusted.status).toBe(200);
    expect(await bookingPrice(bookingId)).toBe(1300);

    const removed = await ownerA.delete(`/api/bookings/${bookingId}/addons/${createdBody.data.addon.id}`);
    expect(removed.status).toBe(200);
    expect(await bookingPrice(bookingId)).toBe(900);
    expect(await addonCount(bookingId)).toBe(0);
  });

  it('clamps rollback at zero when a later discount is below applied_amount', async () => {
    const bookingId = await makeBooking();
    const created = await ownerA.post(`/api/bookings/${bookingId}/addons`, addonBody({
      name: 'rollback floor',
      price: 200,
      quantity: 2,
      durationMinutes: 0,
      notify: false,
    }));
    expect(created.status).toBe(200);
    const createdBody = await created.json() as { data: { addon: { id: string } } };

    const adjusted = await ownerA.post(`/api/bookings/${bookingId}/adjust-price`, { finalPrice: 100 });
    expect(adjusted.status).toBe(200);
    expect(await bookingPrice(bookingId)).toBe(100);

    const removed = await ownerA.delete(`/api/bookings/${bookingId}/addons/${createdBody.data.addon.id}`);
    expect(removed.status).toBe(200);
    expect(await bookingPrice(bookingId)).toBe(0);
    expect(await addonCount(bookingId)).toBe(0);
  });
});
