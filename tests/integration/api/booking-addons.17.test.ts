/** Issue #17 integration TEST suite. CI runs it only after migrations 0053–0059 are applied. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

type Envelope<T = unknown> = { success: boolean; data?: T; code?: string; message?: string };
const json = async <T>(r: Response) => (await r.json()) as Envelope<T>;
async function expectFailure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await json(response)).toMatchObject({ success: false, code });
}
let admin: SupabaseClient, direct: SupabaseClient, ownerA: AuthedApi, ownerB: AuthedApi, staffA: AuthedApi;
const mock = new LineMockServer();
const bookings: string[] = [], customers: string[] = [], staffRows: string[] = [], foreignServices: string[] = [], foreignStaff: string[] = [];
let lineSnapshot: any;
let configuredLineSnapshot: any;
let quotaSnapshot: any;
let slot = 0;
let initialized = false;

function requiredTestEnv(name: 'TEST_SUPABASE_URL' | 'TEST_SUPABASE_SERVICE_ROLE_KEY' | 'TEST_SUPABASE_ANON_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`[Issue #17] ${name} is required for the booking-addons integration suite.`);
  return value;
}

async function customer(lineUserId: string | null) {
  const id = randomUUID(); customers.push(id);
  const { error } = await admin.from('customers').insert({ id, tenant_id: SHOP_A.id, name: `I17-${id}`, phone: '', line_user_id: lineUserId });
  expect(error).toBeNull(); return id;
}
function addonBody(body: Record<string, unknown>, idempotencyKey = randomUUID()) {
  return { ...body, idempotencyKey };
}
async function booking(customerId: string, staffId: string | null = null) {
  const id = randomUUID(); bookings.push(id); slot += 1;
  const start = new Date(Date.now() + (400 + slot) * 86_400_000).toISOString();
  const end = new Date(Date.parse(start) + 3_600_000).toISOString();
  const { error } = await admin.from('bookings').insert({ id, tenant_id: SHOP_A.id, booking_no: `I17${id.slice(0, 8)}`,
    customer_id: customerId, service_id: SHOP_A.serviceA1, staff_id: staffId, start_at: start, end_at: end,
    duration_minutes: 60, price: 1000, final_price: 1000, status: 'CONFIRMED', source: 'MANUAL' });
  expect(error).toBeNull(); return id;
}
async function bookingAt(customerId: string, staffId: string, start: string) {
  const id = randomUUID(); bookings.push(id); const end = new Date(Date.parse(start) + 3_600_000).toISOString();
  const { error } = await admin.from('bookings').insert({ id, tenant_id: SHOP_A.id, booking_no: `I17${id.slice(0, 8)}`,
    customer_id: customerId, service_id: SHOP_A.serviceA1, staff_id: staffId, start_at: start, end_at: end,
    duration_minutes: 60, price: 1000, final_price: 1000, status: 'CONFIRMED', source: 'MANUAL' });
  expect(error).toBeNull(); return id;
}
async function staff() {
  const id = randomUUID(); staffRows.push(id);
  const { error } = await admin.from('staff').insert({ id, tenant_id: SHOP_A.id, name: `I17 staff ${id}`, active: true, bookable: true });
  expect(error).toBeNull(); return id;
}
function month() { const d = new Date(Date.now() + 8 * 3_600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
const baseUrl = () => process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
async function state(id: string) {
  const { data, error } = await admin.from('bookings').select('final_price,duration_minutes,start_at,end_at').eq('id', id).single();
  expect(error).toBeNull(); return data as any;
}
async function addonState(id: string) {
  const { data, error } = await admin.from('booking_addons').select('id,notified,applied_amount,applied_minutes').eq('id', id).single();
  expect(error).toBeNull(); return data as any;
}

beforeAll(async () => {
  const url = requiredTestEnv('TEST_SUPABASE_URL');
  const serviceRoleKey = requiredTestEnv('TEST_SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = requiredTestEnv('TEST_SUPABASE_ANON_KEY');
  admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  direct = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await direct.auth.signInWithPassword({ email: SHOP_A.owner.email, password: SHOP_A.owner.password });
  expect(loginError).toBeNull();
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  staffA = await loginAs(STAFF_A2.email, STAFF_A2.password);
  await mock.start();
  initialized = true;
  const { data, error: settingsError } = await admin.from('tenant_settings').select('line,line_channel_secret_enc,line_channel_access_token_enc').eq('tenant_id', SHOP_A.id).single();
  expect(settingsError).toBeNull();
  lineSnapshot = data;
  const quotaInitial = await admin.from('push_quota_usage').select('*').eq('tenant_id', SHOP_A.id).eq('month', month()).maybeSingle();
  expect(quotaInitial.error).toBeNull(); quotaSnapshot = quotaInitial.data;
  configuredLineSnapshot = {
    ...lineSnapshot,
    line_channel_secret_enc: encryptSecret('i17-secret'),
    line_channel_access_token_enc: encryptSecret('i17-token'),
  };
  expect((await admin.from('tenant_settings').update(configuredLineSnapshot).eq('tenant_id', SHOP_A.id)).error).toBeNull();
});
beforeEach(() => { mock.reset(); });
afterAll(async () => {
  if (!initialized) return;
  await mock.stop();
  const bookingIds = [...bookings];
  if (bookings.length) expect((await admin.from('bookings').delete().in('id', bookings)).error).toBeNull();
  if (customers.length) expect((await admin.from('customers').delete().in('id', customers)).error).toBeNull();
  if (staffRows.length) expect((await admin.from('staff').delete().in('id', staffRows)).error).toBeNull();
  if (foreignStaff.length) expect((await admin.from('staff').delete().in('id', foreignStaff)).error).toBeNull();
  if (foreignServices.length) expect((await admin.from('services').delete().in('id', foreignServices)).error).toBeNull();
  if (bookingIds.length) {
    const { count, error } = await admin.from('booking_addons').select('id', { count: 'exact', head: true }).in('booking_id', bookingIds);
    expect(error).toBeNull(); expect(count).toBe(0);
  }
  if (lineSnapshot) expect((await admin.from('tenant_settings').update(lineSnapshot).eq('tenant_id', SHOP_A.id)).error).toBeNull();
  if (quotaSnapshot) expect((await admin.from('push_quota_usage').upsert(quotaSnapshot)).error).toBeNull();
  else expect((await admin.from('push_quota_usage').delete().eq('tenant_id', SHOP_A.id).eq('month', month())).error).toBeNull();
  if (foreignStaff.length) {
    const { count, error } = await admin.from('staff').select('id', { count: 'exact', head: true }).in('id', foreignStaff);
    expect(error).toBeNull(); expect(count).toBe(0);
  }
  if (foreignServices.length) {
    const { count, error } = await admin.from('services').select('id', { count: 'exact', head: true }).in('id', foreignServices);
    expect(error).toBeNull(); expect(count).toBe(0);
  }
  const quotaRestored = await admin.from('push_quota_usage').select('*').eq('tenant_id', SHOP_A.id).eq('month', month()).maybeSingle();
  expect(quotaRestored.error).toBeNull(); expect(quotaRestored.data ?? null).toEqual(quotaSnapshot ?? null);
});

describe('Issue #17 API/RPC CRUD and isolation', () => {
  it('manager add/get/delete atomically changes exact amount, duration and end_at', async () => {
    const id = await booking(await customer(null)); const before = await state(id);
    const created = await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'I17 add', price: 200, quantity: 2, durationMinutes: 15, notify: false }));
    expect(created.status).toBe(200); const body = await json<any>(created); const addonId = body.data!.addon.id;
    expect(body.data!.notified).toBe('NONE'); expect(body.data!.finalPrice).toBe(1400);
    expect((await state(id)).duration_minutes).toBe(90);
    expect((await ownerA.get(`/api/bookings/${id}/addons`)).status).toBe(200);
    expect((await ownerA.delete(`/api/bookings/${id}/addons/${addonId}`)).status).toBe(200);
    const after = await state(id); expect(Number(after.final_price)).toBe(Number(before.final_price));
    expect(after.duration_minutes).toBe(before.duration_minutes); expect(after.end_at).toBe(before.end_at);
  });
  it('allows zero, rejects negative without residue, and isolates another tenant', async () => {
    const id = await booking(await customer(null));
    expect((await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'gift', price: 0, quantity: 1, durationMinutes: 0, notify: false }))).status).toBe(200);
    await expectFailure(await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'bad', price: -1, quantity: 1, durationMinutes: 0, notify: false })), 400, 'REQ_001');
    await expectFailure(await ownerB.get(`/api/bookings/${id}/addons`), 404, 'REQ_002');
    await expectFailure(await ownerB.post(`/api/bookings/${id}/addons`, addonBody({ name: 'cross', price: 1, quantity: 1, durationMinutes: 0, notify: false })), 404, 'REQ_002');
  });
  it('requires authentication and a MANAGER role for add-on mutations', async () => {
    const id = await booking(await customer(null));
    const payload = addonBody({ name: 'auth', price: 1, quantity: 1, durationMinutes: 0, notify: false });
    await expectFailure(await fetch(`${baseUrl()}/api/bookings/${id}/addons`), 401, 'AUTH_001');
    await expectFailure(await fetch(`${baseUrl()}/api/bookings/${id}/addons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), 401, 'AUTH_001');
    await expectFailure(await fetch(`${baseUrl()}/api/bookings/${id}/addons/random-addon`, { method: 'DELETE' }), 401, 'AUTH_001');
    await expectFailure(await staffA.post(`/api/bookings/${id}/addons`, payload), 403, 'AUTH_005');
    const created = await ownerA.post(`/api/bookings/${id}/addons`, payload);
    const addonId = (await json<any>(created)).data!.addon.id;
    await expectFailure(await staffA.delete(`/api/bookings/${id}/addons/${addonId}`), 403, 'AUTH_005');
    await expectFailure(await ownerB.delete(`/api/bookings/${id}/addons/${addonId}`), 404, 'REQ_002');
    await expectFailure(await ownerA.delete(`/api/bookings/${id}/addons/${randomUUID()}`), 404, 'REQ_002');
    expect(await addonState(addonId)).toMatchObject({ notified: 'NONE' });
  });
  it('rejects service and staff ids that belong to a different tenant', async () => {
    const serviceId = randomUUID(), staffId = randomUUID();
    foreignServices.push(serviceId); foreignStaff.push(staffId);
    expect((await admin.from('services').insert({ id: serviceId, tenant_id: SHOP_B.id, name: `I17 foreign ${serviceId}`, duration_minutes: 30, price: 1 })).error).toBeNull();
    expect((await admin.from('staff').insert({ id: staffId, tenant_id: SHOP_B.id, name: `I17 foreign ${staffId}`, active: true, bookable: true })).error).toBeNull();
    const id = await booking(await customer(null));
    await expectFailure(await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'wrong service', price: 1, quantity: 1, durationMinutes: 0, serviceId, notify: false })), 404, 'REQ_002');
    await expectFailure(await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'wrong staff', price: 1, quantity: 1, durationMinutes: 0, staffId, notify: false })), 404, 'REQ_002');
  });
  it('rejects authenticated direct booking_addons INSERT, UPDATE and DELETE privileges', async () => {
    const id = await booking(await customer(null));
    const created = await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'route only', price: 1, quantity: 1, durationMinutes: 0, notify: false }));
    const addonId = (await json<any>(created)).data!.addon.id;
    const { error: insertError } = await direct.from('booking_addons').insert({
      tenant_id: SHOP_A.id, booking_id: id, name: 'forbidden', price: 0, quantity: 1, duration_minutes: 0,
      applied_amount: 0, applied_minutes: 0, performance_mode: 'NONE', notified: 'NONE',
    });
    // 0054 revokes table DML privileges before RLS; PostgREST must surface a
    // database permission denial rather than treating direct writes as no-ops.
    const update = await direct.from('booking_addons').update({ notified: 'LINE' }).eq('id', addonId).select('id');
    const remove = await direct.from('booking_addons').delete().eq('id', addonId).select('id');
    for (const error of [insertError, update.error, remove.error]) {
      expect(error?.code).toBe('42501');
    }
    expect(await addonState(addonId)).toMatchObject({ id: addonId, notified: 'NONE', applied_amount: 1, applied_minutes: 0 });
  });
  it('records LINE and NO_LINE outcomes without using a real provider', async () => {
    const beforeUsage = await admin.from('push_quota_usage').select('used').eq('tenant_id', SHOP_A.id).eq('month', month()).maybeSingle();
    expect(beforeUsage.error).toBeNull(); const before = beforeUsage.data?.used ?? 0;
    const silent = await booking(await customer('Ui17-silent-user'));
    const silentResult = await ownerA.post(`/api/bookings/${silent}/addons`, addonBody({ name: 'no push', price: 1, quantity: 1, durationMinutes: 0, notify: false }));
    expect(silentResult.status).toBe(200); expect(mock.requests).toHaveLength(0);
    const bound = await booking(await customer('Ui17-bound-user'));
    const line = await ownerA.post(`/api/bookings/${bound}/addons`, addonBody({ name: 'line', price: 1, quantity: 1, durationMinutes: 0, notify: true }));
    const lineBody = await json<any>(line);
    expect(lineBody.data!.notified).toBe('LINE'); expect(await addonState(lineBody.data!.addon.id)).toMatchObject({ notified: 'LINE' });
    expect(mock.requestsFor('/v2/bot/message/push')).toHaveLength(1);
    const afterUsage = await admin.from('push_quota_usage').select('used').eq('tenant_id', SHOP_A.id).eq('month', month()).maybeSingle();
    expect(afterUsage.error).toBeNull(); const after = afterUsage.data?.used;
    expect(after).toBe(before + 1);
    mock.reset(); const unbound = await booking(await customer(null));
    const noLine = await ownerA.post(`/api/bookings/${unbound}/addons`, addonBody({ name: 'none', price: 1, quantity: 1, durationMinutes: 0, notify: true }));
    const noLineBody = await json<any>(noLine);
    expect(noLineBody.data!.notified).toBe('NO_LINE'); expect(await addonState(noLineBody.data!.addon.id)).toMatchObject({ notified: 'NO_LINE' });
    expect(mock.requests).toHaveLength(0);
  });

  it('replays one idempotency key without a second price mutation, quota reservation or LINE push', async () => {
    const id = await booking(await customer('Ui17-idempotent-user'));
    const key = randomUUID();
    const payload = addonBody({ name: 'replay-safe', price: 25, quantity: 2, durationMinutes: 0, notify: true }, key);
    const beforeUsage = await admin.from('push_quota_usage').select('used').eq('tenant_id', SHOP_A.id).eq('month', month()).maybeSingle();
    expect(beforeUsage.error).toBeNull();

    const first = await ownerA.post(`/api/bookings/${id}/addons`, payload);
    expect(first.status).toBe(200);
    const firstBody = await json<any>(first);
    expect(firstBody.data!.notified).toBe('LINE');
    expect(mock.requestsFor('/v2/bot/message/push')).toHaveLength(1);
    const firstPrice = (await state(id)).final_price;
    const firstUsage = await admin.from('push_quota_usage').select('used').eq('tenant_id', SHOP_A.id).eq('month', month()).single();
    expect(firstUsage.error).toBeNull();

    mock.reset();
    const replay = await ownerA.post(`/api/bookings/${id}/addons`, payload);
    expect(replay.status).toBe(200);
    const replayBody = await json<any>(replay);
    expect(replayBody.data!.addon.id).toBe(firstBody.data!.addon.id);
    expect(replayBody.data!.finalPrice).toBe(firstBody.data!.finalPrice);
    expect(replayBody.data!.notified).toBe('LINE');
    expect(mock.requestsFor('/v2/bot/message/push')).toHaveLength(0);
    expect((await state(id)).final_price).toBe(firstPrice);
    expect((await admin.from('booking_addons').select('id', { count: 'exact', head: true }).eq('booking_id', id)).count).toBe(1);
    const replayUsage = await admin.from('push_quota_usage').select('used').eq('tenant_id', SHOP_A.id).eq('month', month()).single();
    expect(replayUsage.error).toBeNull(); expect(replayUsage.data?.used).toBe(firstUsage.data?.used);
  });

  it('surfaces a persisted PENDING notification without sending again on an ambiguous retry', async () => {
    const id = await booking(await customer('Ui17-pending-user'));
    const key = randomUUID();
    const created = await ownerA.post(`/api/bookings/${id}/addons`, addonBody({
      name: 'pending-fixture', price: 7, quantity: 1, durationMinutes: 0, notify: false,
    }, key));
    expect(created.status).toBe(200);
    const addonId = (await json<any>(created)).data!.addon.id;
    expect((await admin.from('booking_addons').update({ notification_requested: true, notified: 'PENDING' }).eq('id', addonId)).error).toBeNull();
    const before = await state(id);
    mock.reset();

    const replay = await ownerA.post(`/api/bookings/${id}/addons`, addonBody({
      name: 'pending-fixture', price: 7, quantity: 1, durationMinutes: 0, notify: true,
    }, key));
    expect(replay.status).toBe(409);
    await expect(json(replay)).resolves.toMatchObject({
      success: false, code: 'REQ_003', data: { persisted: true, notificationPending: true },
    });
    expect(mock.requestsFor('/v2/bot/message/push')).toHaveLength(0);
    expect(await state(id)).toEqual(before);
    expect((await admin.from('booking_addons').select('id', { count: 'exact', head: true }).eq('booking_id', id)).count).toBe(1);
  });

  it('maps a staff overlap to 409 and leaves no add-on residue', async () => {
    const c = await customer(null); const start = new Date(Date.now() + 900 * 86_400_000).toISOString();
    const first = await bookingAt(c, SHOP_A.staffA1, start);
    await bookingAt(await customer(null), SHOP_A.staffA1, new Date(Date.parse(start) + 60 * 60_000).toISOString());
    const res = await ownerA.post(`/api/bookings/${first}/addons`, addonBody({ name: 'overlap', price: 1, quantity: 1, durationMinutes: 30, notify: false }));
    expect(res.status).toBe(409); expect((await json(res)).code).toBe('REQ_003');
    const { count } = await admin.from('booking_addons').select('id', { count: 'exact', head: true }).eq('booking_id', first);
    expect(count).toBe(0); expect(Number((await state(first)).final_price)).toBe(1000);
  });

  it('serializes concurrent add and delete with one final add-on and exact rollback', async () => {
    const id = await booking(await customer(null));
    const before = await state(id);
    const initial = await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'concurrent old', price: 10, quantity: 1, durationMinutes: 0, notify: false }));
    const initialId = (await json<any>(initial)).data!.addon.id;
    const [removed, added] = await Promise.all([
      ownerA.delete(`/api/bookings/${id}/addons/${initialId}`),
      ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'concurrent new', price: 7, quantity: 1, durationMinutes: 0, notify: false })),
    ]);
    expect(removed.status).toBe(200); expect(added.status).toBe(200);
    const { data, error } = await admin.from('booking_addons').select('id,name,applied_amount').eq('booking_id', id);
    expect(error).toBeNull(); expect(data).toEqual([expect.objectContaining({ name: 'concurrent new', applied_amount: 7 })]);
    const after = await state(id);
    expect(Number(after.final_price)).toBe(Number(before.final_price) + 7);
    expect(after.duration_minutes).toBe(before.duration_minutes);
    expect(after.end_at).toBe(before.end_at);
  });

  it('atomically reserves the final quota unit under concurrent receipt requests', async () => {
    const feature = await admin.from('feature_subscriptions').select('active,expires_at').eq('tenant_id', SHOP_A.id).eq('code', 'EXTRA_PUSH').maybeSingle();
    expect(feature.error).toBeNull(); const extra = feature.data;
    const limit = extra?.active && (!extra.expires_at || new Date(extra.expires_at) > new Date()) ? 700 : 200;
    const prior = await admin.from('push_quota_usage').select('*').eq('tenant_id', SHOP_A.id).eq('month', month()).maybeSingle();
    expect(prior.error).toBeNull();
    try {
      expect((await admin.from('push_quota_usage').upsert({ tenant_id: SHOP_A.id, month: month(), used: limit - 1 }, { onConflict: 'tenant_id,month' })).error).toBeNull();
      mock.reset();
      const firstBooking = await booking(await customer('Ui17-concurrent-a'));
      const secondBooking = await booking(await customer('Ui17-concurrent-b'));
      const [first, second] = await Promise.all([
        ownerA.post(`/api/bookings/${firstBooking}/addons`, addonBody({ name: 'quota a', price: 1, quantity: 1, durationMinutes: 0, notify: true })),
        ownerA.post(`/api/bookings/${secondBooking}/addons`, addonBody({ name: 'quota b', price: 1, quantity: 1, durationMinutes: 0, notify: true })),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const losing = first.status === 409 ? first : second;
      await expect(json(losing)).resolves.toMatchObject({ success: false, code: 'REQ_003', data: { persisted: true } });
      const { data: usage, error: usageError } = await admin.from('push_quota_usage').select('used').eq('tenant_id', SHOP_A.id).eq('month', month()).single();
      expect(usageError).toBeNull(); expect(usage?.used).toBe(limit);
      expect(mock.requestsFor('/v2/bot/message/push')).toHaveLength(1);
      const { data: outcomes, error: outcomesError } = await admin.from('booking_addons').select('notified').in('booking_id', [firstBooking, secondBooking]);
      expect(outcomesError).toBeNull(); expect(outcomes?.map((row) => row.notified).sort()).toEqual(['LINE', 'QUOTA_EXCEEDED']);
    } finally {
      if (prior.data) expect((await admin.from('push_quota_usage').upsert(prior.data)).error).toBeNull();
      else expect((await admin.from('push_quota_usage').delete().eq('tenant_id', SHOP_A.id).eq('month', month())).error).toBeNull();
    }
  });

  it('rejects a post-0053 positive oversized-duration snapshot without mutation', async () => {
    const id = await booking(await customer(null));
    const { data: addon, error } = await admin.from('booking_addons').insert({
      tenant_id: SHOP_A.id, booking_id: id, name: 'positive corrupt duration', price: 1, quantity: 1,
      duration_minutes: 120, applied_amount: 1, applied_minutes: 120,
      performance_mode: 'NONE', notified: 'NONE',
    }).select('id').single();
    expect(error).toBeNull();
    const before = await state(id);
    const response = await ownerA.delete(`/api/bookings/${id}/addons/${addon!.id}`);
    expect(response.status).toBe(409); expect((await json(response)).code).toBe('REQ_003');
    expect(await state(id)).toEqual(before);
    expect(await addonState(addon!.id)).toMatchObject({ applied_amount: 1, applied_minutes: 120 });
  });

  it('persists PRIMARY, SPECIFIC_STAFF and NONE C+ modes', async () => {
    const id = await booking(await customer(null), SHOP_A.staffA1);
    for (const body of [
      { name: 'primary', price: 1, quantity: 1, durationMinutes: 0, notify: false },
      { name: 'specific', price: 1, quantity: 1, durationMinutes: 0, staffId: SHOP_A.staffA2, notify: false },
      { name: 'none', price: 1, quantity: 1, durationMinutes: 0, noPersonalCredit: true, notify: false },
    ]) expect((await ownerA.post(`/api/bookings/${id}/addons`, addonBody(body))).status).toBe(200);
    const { data, error } = await admin.from('booking_addons').select('name,performance_mode,performance_staff_id').eq('booking_id', id).order('created_at');
    expect(error).toBeNull(); expect(data).toMatchObject([
      { name: 'primary', performance_mode: 'PRIMARY', performance_staff_id: SHOP_A.staffA1 },
      { name: 'specific', performance_mode: 'SPECIFIC_STAFF', performance_staff_id: SHOP_A.staffA2 },
      { name: 'none', performance_mode: 'NONE', performance_staff_id: null },
    ]);
  });

  it('staff deletion clears only performance_staff_id through the composite FK', async () => {
    const worker = await staff(); const id = await booking(await customer(null));
    const add = await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'staff clear', price: 1, quantity: 1, durationMinutes: 0, staffId: worker, notify: false }));
    const addonId = (await json<any>(add)).data!.addon.id;
    expect((await admin.from('staff').delete().eq('id', worker)).error).toBeNull();
    const { data, error } = await admin.from('booking_addons').select('tenant_id,performance_staff_id').eq('id', addonId).single();
    expect(error).toBeNull(); expect(data).toMatchObject({ tenant_id: SHOP_A.id, performance_staff_id: null });
  });

  it('records NOT_CONFIGURED and FAILED receipt outcomes without false LINE success', async () => {
    const bound = await booking(await customer('Ui17-config-user'));
    expect((await admin.from('tenant_settings').update({ line_channel_access_token_enc: '' }).eq('tenant_id', SHOP_A.id)).error).toBeNull();
    const unconfigured = await ownerA.post(`/api/bookings/${bound}/addons`, addonBody({ name: 'no config', price: 1, quantity: 1, durationMinutes: 0, notify: true }));
    const unconfiguredBody = await json<any>(unconfigured);
    expect(unconfiguredBody.data!.notified).toBe('NOT_CONFIGURED'); expect(await addonState(unconfiguredBody.data!.addon.id)).toMatchObject({ notified: 'NOT_CONFIGURED' });
    expect(mock.requests).toHaveLength(0);
    expect((await admin.from('tenant_settings').update(configuredLineSnapshot).eq('tenant_id', SHOP_A.id)).error).toBeNull(); mock.failNext(500);
    const failed = await ownerA.post(`/api/bookings/${bound}/addons`, addonBody({ name: 'failed', price: 1, quantity: 1, durationMinutes: 0, notify: true }));
    const failedBody = await json<any>(failed);
    expect(failedBody.data!.notified).toBe('FAILED'); expect(await addonState(failedBody.data!.addon.id)).toMatchObject({ notified: 'FAILED' });
    expect(mock.requestsFor('/v2/bot/message/push')).toHaveLength(1);
  });

  it('returns persisted-add-on 409 on quota exhaustion with zero LINE requests', async () => {
    const { data: extra } = await admin.from('feature_subscriptions').select('active,expires_at').eq('tenant_id', SHOP_A.id).eq('code', 'EXTRA_PUSH').maybeSingle();
    const enabled = !!extra?.active && (!extra.expires_at || new Date(extra.expires_at) > new Date());
    const limit = enabled ? 700 : 200;
    expect((await admin.from('push_quota_usage').upsert({ tenant_id: SHOP_A.id, month: month(), used: limit }, { onConflict: 'tenant_id,month' })).error).toBeNull();
    mock.reset(); const id = await booking(await customer('Ui17-quota-user'));
    const res = await ownerA.post(`/api/bookings/${id}/addons`, addonBody({ name: 'quota', price: 3, quantity: 1, durationMinutes: 0, notify: true }));
    expect(res.status).toBe(409);
    const body = await json<{ persisted?: boolean }>(res);
    expect(body).toMatchObject({ success: false, code: 'REQ_003', data: { persisted: true } });
    expect(body.message).toContain('加購已新增'); expect(mock.requests).toHaveLength(0);
    const { data, error } = await admin.from('booking_addons').select('notified,applied_amount,applied_minutes').eq('booking_id', id).single();
    expect(error).toBeNull(); expect(data).toMatchObject({ notified: 'QUOTA_EXCEEDED', applied_amount: 3, applied_minutes: 0 });
    expect(Number((await state(id)).final_price)).toBe(1003);
  });
});

// Runtime evidence is produced only when the TEST verifier runs this file. It
// intentionally creates no negative financial snapshot; the positive corrupt
// duration fixture above exercises the guarded rollback path after 0053/0054.
