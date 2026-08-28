/**
 * 行程域後台端點整合測試 — GitHub issue #8（修復-6），12 分冊 §4 Phase 8 的 `tours.10`。
 *
 * 端點（10 分冊 §5；migration 0016 建 trips/trip_plans、0026 建
 * trip_departures/trip_addons/tour_orders 與 reserve_seats/release_seats/
 * create_tour_order）：
 *   POST   /api/trips/:id/publish | unpublish
 *   POST   /api/trips/:id/request-midao-listing
 *   GET    /api/trips/:id/departures        POST 同路徑
 *   POST   /api/trips/:id/departures/batch
 *   PUT    /api/trip-departures/:id         DELETE 同路徑
 *   GET    /api/trips/:id/addons            POST 同路徑
 *   PUT    /api/trip-addons/:id             DELETE 同路徑
 *   DELETE /api/trips/:id（有訂單 → ARCHIVED）
 *
 * 本檔要證明的事（issue #8 驗收清單第 2、4、8 項）：
 *   1. trips / plans / departures / addons 的 CRUD 真的寫進 DB（不是回 200 就算）
 *   2. publish 狀態機：DRAFT↔PUBLISHED，ARCHIVED 不得直接上架，重複 unpublish 409
 *   3. `capacity` 調低到小於 `seats_booked` → 409（10 分冊 §5 明列）
 *   4. `DELETE /api/trips/:id` 在有訂單時改為 ARCHIVED、行程仍在
 *   5. request-midao-listing：NONE→PENDING、重複 409、REJECTED→PENDING
 *   6. RLS／跨租戶：B 店帳號動 A 店的行程/團次/加購一律 404，**且 DB 沒有任何一列被改**
 *
 * 清理紀律：本檔自建專屬行程（不動 seed 的 TRIP_A —— tour-orders.10 的並發
 * 案例依賴它的 departureCap2），afterAll 依 FK 方向刪回去。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const baseUrl = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/** 未來第 n 天的 YYYY-MM-DD（與其他測試檔的日期區間錯開，避免撞唯一鍵） */
function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * DAY_MS).toISOString().slice(0, 10);
}

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
let staffA: AuthedApi;
let managerRpc: SupabaseClient;
let staffRpc: SupabaseClient;

/** 本檔專屬的行程與方案（不動 seed 的 TRIP_A） */
let tripId = '';
let tripSlug = '';
let planId = '';
/** 有訂單、用來驗 DELETE→ARCHIVED 的第二個行程 */
let tripWithOrderId = '';
let planWithOrderId = '';
let departureWithOrderId = '';
let orderId = '';

const createdDepartures: string[] = [];
const createdAddons: string[] = [];

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
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  staffA = await loginAs(STAFF_A2.email, STAFF_A2.password);
  managerRpc = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: managerLoginError } = await managerRpc.auth.signInWithPassword({
    email: SHOP_A.owner.email, password: SHOP_A.owner.password,
  });
  expect(managerLoginError).toBeNull();
  staffRpc = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: staffLoginError } = await staffRpc.auth.signInWithPassword({
    email: STAFF_A2.email, password: STAFF_A2.password,
  });
  expect(staffLoginError).toBeNull();

  // 受測行程：走真實端點建立，順便當成 POST /api/trips 的鏈路證據
  tripSlug = `itest-tours-10-${Date.now()}`;
  const res = await ownerA.post('/api/trips', {
    title: '賞鯨半日遊（tours.10 測試）',
    slug: tripSlug,
    region: '花蓮',
    status: 'DRAFT',
  });
  const body = await readJson<{ id: string }>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  tripId = body.data!.id;

  const planRes = await ownerA.post(`/api/trips/${tripId}/plans`, {
    name: '標準團（tours.10）',
    basePrice: 1800,
    priceType: 'PER_PERSON',
    maxParticipants: 10,
  });
  const planBody = await readJson<{ id: string }>(planRes);
  expect(planRes.status, JSON.stringify(planBody)).toBe(200);
  planId = planBody.data!.id;

  // 第二個行程：直接用 service role 建（含一筆訂單），供 DELETE→ARCHIVED 驗證。
  // 走 admin 而不是端點，是因為建訂單需要一個「已存在的團次 + 方案」的完整
  // 前置，用端點串會讓那個案例的失敗原因變得難以定位。
  const { data: t2 } = await admin.from('trips').insert({
    tenant_id: SHOP_A.id,
    slug: `itest-tours-10-archive-${Date.now()}`,
    title: '有訂單的行程（tours.10 測試）',
    status: 'PUBLISHED',
  }).select('id').single();
  tripWithOrderId = t2!.id;

  const { data: p2 } = await admin.from('trip_plans').insert({
    tenant_id: SHOP_A.id, trip_id: tripWithOrderId, name: '方案', base_price: 1000,
  }).select('id').single();
  planWithOrderId = p2!.id;

  const { data: d2 } = await admin.from('trip_departures').insert({
    tenant_id: SHOP_A.id, trip_id: tripWithOrderId, plan_id: planWithOrderId,
    departs_on: futureDate(400), capacity: 10,
  }).select('id').single();
  departureWithOrderId = d2!.id;

  const { data: newOrderId, error: orderErr } = await admin.rpc('create_tour_order', {
    p_tenant: SHOP_A.id,
    p_departure: departureWithOrderId,
    p_party: 1,
    p_customer_name: 'tours.10 訂單',
    p_customer_phone: '0900000010',
    p_source: 'MANUAL',
    p_note: '',
    p_payment_method: null,
    p_customer: null,
    p_hold_expires: null,
  });
  expect(orderErr, JSON.stringify(orderErr)).toBeNull();
  orderId = newOrderId as string;
});

afterAll(async () => {
  // FK 方向：訂單 → 團次/加購 → 方案 → 行程
  if (orderId) await admin.from('tour_orders').delete().eq('id', orderId);
  for (const id of createdDepartures) await admin.from('trip_departures').delete().eq('id', id);
  for (const id of createdAddons) await admin.from('trip_addons').delete().eq('id', id);
  if (departureWithOrderId) await admin.from('trip_departures').delete().eq('id', departureWithOrderId);
  if (tripWithOrderId) await admin.from('trips').delete().eq('id', tripWithOrderId);
  if (tripId) await admin.from('trips').delete().eq('id', tripId);
});

/* ==================================================== 上架狀態機 */
describe('POST /api/trips/:id/publish|unpublish', () => {
  it('publish：DRAFT → PUBLISHED，且 DB 真的改了', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/publish`);
    const body = await readJson<{ status: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.status).toBe('PUBLISHED');

    const { data } = await admin.from('trips').select('status').eq('id', tripId).single();
    expect(data!.status).toBe('PUBLISHED');
  });

  it('publish 不碰 midao_listing（兩條上架通道互相獨立）', async () => {
    const { data } = await admin.from('trips').select('midao_listing').eq('id', tripId).single();
    expect(data!.midao_listing).toBe('NONE');
  });

  it('unpublish：PUBLISHED → DRAFT', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/unpublish`);
    const body = await readJson<{ status: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.status).toBe('DRAFT');

    const { data } = await admin.from('trips').select('status').eq('id', tripId).single();
    expect(data!.status).toBe('DRAFT');
  });

  it('重複 unpublish（已是 DRAFT）→ 409，不是靜默成功', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/unpublish`);
    const body = await readJson(res);
    expect(res.status).toBe(409);
    expect(body.code).toBe('REQ_003');
  });

  it('ARCHIVED 的行程不得直接 publish → 409', async () => {
    await admin.from('trips').update({ status: 'ARCHIVED' }).eq('id', tripId);
    const res = await ownerA.post(`/api/trips/${tripId}/publish`);
    expect(res.status).toBe(409);

    const { data } = await admin.from('trips').select('status').eq('id', tripId).single();
    expect(data!.status).toBe('ARCHIVED');
    await admin.from('trips').update({ status: 'DRAFT' }).eq('id', tripId);
  });

  it('publish 不存在的行程 → 404', async () => {
    const res = await ownerA.post('/api/trips/00000000-0000-4000-8000-0000000000ff/publish');
    expect(res.status).toBe(404);
  });
});

/* ================================================ Midao 上架申請 */
describe('POST /api/trips/:id/request-midao-listing', () => {
  it('NONE → PENDING', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/request-midao-listing`);
    const body = await readJson<{ midaoListing: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.midaoListing).toBe('PENDING');

    const { data } = await admin.from('trips').select('midao_listing').eq('id', tripId).single();
    expect(data!.midao_listing).toBe('PENDING');
  });

  it('重複送審（已 PENDING）→ 409', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/request-midao-listing`);
    expect(res.status).toBe(409);
  });

  it('已 LISTED → 409', async () => {
    await admin.from('trips').update({ midao_listing: 'LISTED' }).eq('id', tripId);
    const res = await ownerA.post(`/api/trips/${tripId}/request-midao-listing`);
    expect(res.status).toBe(409);
  });

  it('REJECTED → PENDING，且清掉上一次的退回原因', async () => {
    await admin.from('trips')
      .update({ midao_listing: 'REJECTED', midao_listing_note: '照片解析度不足' })
      .eq('id', tripId);

    const res = await ownerA.post(`/api/trips/${tripId}/request-midao-listing`);
    const body = await readJson<{ midaoListing: string; midaoListingNote: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.midaoListing).toBe('PENDING');
    expect(body.data!.midaoListingNote).toBe('');

    const { data } = await admin.from('trips')
      .select('midao_listing, midao_listing_note').eq('id', tripId).single();
    expect(data!.midao_listing).toBe('PENDING');
    expect(data!.midao_listing_note).toBe('');

    await admin.from('trips').update({ midao_listing: 'NONE' }).eq('id', tripId);
  });
});

/* ========================================================= 團次 */
describe('團次 CRUD（/api/trips/:id/departures、/api/trip-departures/:id）', () => {
  let departureId = '';

  it('POST：建立團次，seats_booked 由 DB 起算 0（不接受客戶端寫入）', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/departures`, {
      planId,
      departsOn: futureDate(410),
      startTime: '09:00',
      capacity: 8,
      // #37 的 2+ 導遊契約：測試種子有兩位可指派人員，必須明確選 PRIMARY。
      primaryStaffId: SHOP_A.staffA1,
      assistantStaffIds: [SHOP_A.staffA2],
      // 刻意送一個不該被採信的值
      seatsBooked: 99,
    });
    const body = await readJson<{ id: string; seatsBooked: number; planName: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    departureId = body.data!.id;
    createdDepartures.push(departureId);

    expect(body.data!.seatsBooked).toBe(0);
    expect(body.data!.planName).toBe('標準團（tours.10）');

    const { data } = await admin.from('trip_departures')
      .select('capacity, seats_booked, start_time').eq('id', departureId).single();
    expect(data!.capacity).toBe(8);
    expect(data!.seats_booked).toBe(0);
    expect(String(data!.start_time).slice(0, 5)).toBe('09:00');
  });

  it('POST：同方案同日同時間重複 → 409（唯一鍵）', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/departures`, {
      planId, departsOn: futureDate(410), startTime: '09:00', capacity: 8, primaryStaffId: SHOP_A.staffA1,
    });
    expect(res.status).toBe(409);
  });

  it('POST：方案不屬於此行程 → 404', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/departures`, {
      planId: planWithOrderId, departsOn: futureDate(411), capacity: 5,
    });
    expect(res.status).toBe(404);
  });

  it('GET：列出團次並帶回 planName', async () => {
    const res = await ownerA.get(`/api/trips/${tripId}/departures`);
    const body = await readJson<Array<{ id: string; planName: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.some((d) => d.id === departureId)).toBe(true);
    expect(body.data!.find((d) => d.id === departureId)!.planName).toBe('標準團（tours.10）');
  });

  it('GET /api/calendar：團次帶主導遊、協同導遊與名額', async () => {
    const day = futureDate(410);
    const res = await ownerA.get(`/api/calendar?from=${day}T00%3A00%3A00.000Z&to=${day}T23%3A59%3A59.999Z`);
    const body = await readJson<{ events: Array<{
      id: string; type: string; meta?: {
        departureId?: string; primaryStaffId?: string | null; assistantStaffIds?: string[];
        seatsBooked?: number; capacity?: number;
      };
    }> }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    const event = body.data!.events.find((item) => item.meta?.departureId === departureId);
    expect(event?.type).toBe('DEPARTURE');
    expect(event?.meta?.primaryStaffId).toBe(SHOP_A.staffA1);
    expect(event?.meta?.assistantStaffIds).toEqual([SHOP_A.staffA2]);
    expect(event?.meta?.seatsBooked).toBe(0);
    expect(event?.meta?.capacity).toBe(8);
  });

  it('PUT：改 capacity 與 status，DB 跟著變', async () => {
    const res = await ownerA.put(`/api/trip-departures/${departureId}`, {
      capacity: 12, status: 'CLOSED', note: '天氣待觀察',
    });
    const body = await readJson<{ capacity: number; status: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.capacity).toBe(12);
    expect(body.data!.status).toBe('CLOSED');

    const { data } = await admin.from('trip_departures')
      .select('capacity, status, note').eq('id', departureId).single();
    expect(data!.capacity).toBe(12);
    expect(data!.status).toBe('CLOSED');
    expect(data!.note).toBe('天氣待觀察');

    await ownerA.put(`/api/trip-departures/${departureId}`, { status: 'OPEN' });
  });

  it('PUT：capacity 調到低於 seats_booked → 409，且 capacity 一個字都沒改', async () => {
    // 用 rpc 佔 3 席（10 分冊 §2：名額只能經 reserve_seats 變動）
    const { error } = await admin.rpc('reserve_seats', { p_departure: departureId, p_count: 3 });
    expect(error).toBeNull();

    const res = await ownerA.put(`/api/trip-departures/${departureId}`, { capacity: 2 });
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.code).toBe('REQ_003');
    expect(body.message).toContain('3');

    const { data } = await admin.from('trip_departures')
      .select('capacity, seats_booked').eq('id', departureId).single();
    expect(data!.capacity).toBe(12);
    expect(data!.seats_booked).toBe(3);
  });

  it('PUT：capacity 調到剛好等於 seats_booked → 允許', async () => {
    const res = await ownerA.put(`/api/trip-departures/${departureId}`, { capacity: 3 });
    const body = await readJson<{ capacity: number }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.capacity).toBe(3);

    await admin.rpc('release_seats', { p_departure: departureId, p_count: 3 });
    await ownerA.put(`/api/trip-departures/${departureId}`, { capacity: 12 });
  });

  it('POST batch：依 weekdays 展開日期區間，重複的日期跳過而非整批失敗', async () => {
    const from = futureDate(500);
    const to = futureDate(513);          // 14 天 = 剛好兩個完整週
    const weekdaysOf = (a: string, b: string) => {
      const out: number[] = [];
      for (const d = new Date(`${a}T00:00:00Z`); d <= new Date(`${b}T00:00:00Z`);
           d.setUTCDate(d.getUTCDate() + 1)) out.push(d.getUTCDay());
      return out;
    };
    // 取區間內第一天的星期，保證至少命中 2 天
    const targetWeekday = weekdaysOf(from, to)[0];

    const res = await ownerA.post(`/api/trips/${tripId}/departures/batch`, {
      planId, from, to, weekdays: [targetWeekday], startTime: '14:00', capacity: 6, primaryStaffId: SHOP_A.staffA1,
    });
    const body = await readJson<{ created: number; skipped: number; departures: Array<{ id: string }> }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.created).toBe(2);
    expect(body.data!.skipped).toBe(0);
    for (const d of body.data!.departures) createdDepartures.push(d.id);

    const { count } = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true })
      .eq('trip_id', tripId).eq('start_time', '14:00:00');
    expect(count).toBe(2);

    // 再跑一次同樣的區間：全部都已存在 → created 0 / skipped 2
    const again = await ownerA.post(`/api/trips/${tripId}/departures/batch`, {
      planId, from, to, weekdays: [targetWeekday], startTime: '14:00', capacity: 6, primaryStaffId: SHOP_A.staffA1,
    });
    const againBody = await readJson<{ created: number; skipped: number }>(again);
    expect(again.status, JSON.stringify(againBody)).toBe(200);
    expect(againBody.data!.created).toBe(0);
    expect(againBody.data!.skipped).toBe(2);
  });

  it('POST batch：結束日早於起始日 → 400', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/departures/batch`, {
      planId, from: futureDate(520), to: futureDate(519), weekdays: [1], capacity: 5,
    });
    expect(res.status).toBe(400);
  });

  it('DELETE：沒有訂單的團次可以刪，DB 真的不見了', async () => {
    const res = await ownerA.delete(`/api/trip-departures/${departureId}`);
    const body = await readJson<{ deleted: boolean }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.deleted).toBe(true);

    const { data } = await admin.from('trip_departures').select('id').eq('id', departureId).maybeSingle();
    expect(data).toBeNull();
  });

  it('DELETE：有訂單的團次 → 409，團次仍在', async () => {
    const res = await ownerA.delete(`/api/trip-departures/${departureWithOrderId}`);
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(409);

    const { data } = await admin.from('trip_departures')
      .select('id').eq('id', departureWithOrderId).maybeSingle();
    expect(data).not.toBeNull();
  });
});

/* ========================================================= 加購 */
describe('加購 CRUD（/api/trips/:id/addons、/api/trip-addons/:id）', () => {
  let addonId = '';

  it('POST：建立加購項，stock 未給 → null（不限量）', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/addons`, {
      name: '接駁車', price: 200, unit: 'PER_PERSON',
    });
    const body = await readJson<{ id: string; stock: number | null; sortOrder: number }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    addonId = body.data!.id;
    createdAddons.push(addonId);
    expect(body.data!.stock).toBeNull();
    expect(body.data!.sortOrder).toBe(0);

    const { data } = await admin.from('trip_addons')
      .select('name, price, unit, stock, active').eq('id', addonId).single();
    expect(data!.name).toBe('接駁車');
    expect(Number(data!.price)).toBe(200);
    expect(data!.stock).toBeNull();
    expect(data!.active).toBe(true);
  });

  it('GET：列出加購項', async () => {
    const res = await ownerA.get(`/api/trips/${tripId}/addons`);
    const body = await readJson<Array<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.some((a) => a.id === addonId)).toBe(true);
  });

  it('PUT：stock 送 0 是「限量 0」、送 null 是「不限量」，兩者不可混為一談', async () => {
    const zero = await ownerA.put(`/api/trip-addons/${addonId}`, { stock: 0 });
    const zeroBody = await readJson<{ stock: number | null }>(zero);
    expect(zero.status, JSON.stringify(zeroBody)).toBe(200);
    expect(zeroBody.data!.stock).toBe(0);

    const nul = await ownerA.put(`/api/trip-addons/${addonId}`, { stock: null });
    const nulBody = await readJson<{ stock: number | null }>(nul);
    expect(nul.status, JSON.stringify(nulBody)).toBe(200);
    expect(nulBody.data!.stock).toBeNull();

    const { data } = await admin.from('trip_addons').select('stock').eq('id', addonId).single();
    expect(data!.stock).toBeNull();
  });

  it('PUT：負數價格 → 400', async () => {
    const res = await ownerA.put(`/api/trip-addons/${addonId}`, { price: -1 });
    expect(res.status).toBe(400);
  });

  it('DELETE：刪除加購項，DB 真的不見了', async () => {
    const res = await ownerA.delete(`/api/trip-addons/${addonId}`);
    expect(res.status).toBe(200);
    const { data } = await admin.from('trip_addons').select('id').eq('id', addonId).maybeSingle();
    expect(data).toBeNull();
    createdAddons.splice(createdAddons.indexOf(addonId), 1);
  });
});

/* ========================================= DELETE 行程（有訂單→ARCHIVED） */
describe('DELETE /api/trips/:id', () => {
  it('有訂單 → 改為 ARCHIVED，行程仍在，訂單也還在', async () => {
    const res = await ownerA.delete(`/api/trips/${tripWithOrderId}`);
    const body = await readJson<{ deleted: boolean; archived: boolean }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.deleted).toBe(false);
    expect(body.data!.archived).toBe(true);

    const { data: trip } = await admin.from('trips')
      .select('status').eq('id', tripWithOrderId).maybeSingle();
    expect(trip).not.toBeNull();
    expect(trip!.status).toBe('ARCHIVED');

    const { data: order } = await admin.from('tour_orders')
      .select('id').eq('id', orderId).maybeSingle();
    expect(order).not.toBeNull();
  });

  it('沒有訂單 → 真的刪除，方案/團次/加購由 cascade 一併移除', async () => {
    const { data: t3 } = await admin.from('trips').insert({
      tenant_id: SHOP_A.id,
      slug: `itest-tours-10-hard-delete-${Date.now()}`,
      title: '可刪的行程（tours.10 測試）',
    }).select('id').single();
    const { data: p3 } = await admin.from('trip_plans').insert({
      tenant_id: SHOP_A.id, trip_id: t3!.id, name: '方案', base_price: 500,
    }).select('id').single();
    const { data: d3 } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id, trip_id: t3!.id, plan_id: p3!.id,
      departs_on: futureDate(600), capacity: 4,
    }).select('id').single();

    const res = await ownerA.delete(`/api/trips/${t3!.id}`);
    const body = await readJson<{ deleted: boolean }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.deleted).toBe(true);

    const { data: gone } = await admin.from('trips').select('id').eq('id', t3!.id).maybeSingle();
    expect(gone).toBeNull();
    const { data: depGone } = await admin.from('trip_departures')
      .select('id').eq('id', d3!.id).maybeSingle();
    expect(depGone).toBeNull();
  });
});

/* ====================================== upcomingDepartureCount（衍生欄位） */
describe('GET /api/trips 的 upcomingDepartureCount', () => {
  it('只算 status=OPEN 且日期未過的團次（不是恆 0，也不是全部團次）', async () => {
    const { data: closed } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
      departs_on: futureDate(700), capacity: 5, status: 'CLOSED',
    }).select('id').single();
    createdDepartures.push(closed!.id);

    const { data: open } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
      departs_on: futureDate(701), capacity: 5, status: 'OPEN',
    }).select('id').single();
    createdDepartures.push(open!.id);

    const { data: past } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
      departs_on: '2020-01-01', capacity: 5, status: 'OPEN',
    }).select('id').single();
    createdDepartures.push(past!.id);

    // 本檔稍早 batch 建了 2 筆 OPEN 未來團次，加上這裡的 1 筆 = 3
    const res = await ownerA.get('/api/trips');
    const body = await readJson<Array<{ id: string; upcomingDepartureCount: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    const row = body.data!.find((r) => r.id === tripId)!;
    expect(row.upcomingDepartureCount).toBe(3);
  });
});

/* ============================================ 方案：後台專屬欄位與審核 */
describe('方案：後台表單欄位真的有進資料庫', () => {
  let planWithDeposit = '';

  it('POST：定金模式／啟用／季節不會被 planRowFromImport 的欄位清單吃掉', async () => {
    const res = await ownerA.post(`/api/trips/${tripId}/plans`, {
      name: '定金方案（tours.10）',
      basePrice: 4000,
      priceType: 'PER_PERSON',
      depositMode: 'DEPOSIT_PERCENT',
      depositValue: 30,
      active: false,
      yearRound: false,
      seasons: [{ id: 's1', name: '旺季', startMonth: 7, startDay: 1, endMonth: 8, endDay: 31, priceOverride: 4500, active: true }],
    });
    const body = await readJson<{ id: string; depositMode: string; depositValue: number; active: boolean; yearRound: boolean; seasons: unknown[] }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    planWithDeposit = body.data!.id;

    expect(body.data!.depositMode).toBe('DEPOSIT_PERCENT');
    expect(body.data!.depositValue).toBe(30);
    expect(body.data!.active).toBe(false);
    expect(body.data!.yearRound).toBe(false);
    expect(body.data!.seasons).toHaveLength(1);

    const { data } = await admin.from('trip_plans')
      .select('deposit_mode, deposit_value, active, year_round, seasons')
      .eq('id', planWithDeposit).single();
    expect(data!.deposit_mode).toBe('DEPOSIT_PERCENT');
    expect(Number(data!.deposit_value)).toBe(30);
    expect(data!.active).toBe(false);
    expect(data!.year_round).toBe(false);
    expect(data!.seasons).toHaveLength(1);
  });

  it('PUT：同樣的欄位改得動', async () => {
    const res = await ownerA.put(`/api/trip-plans/${planWithDeposit}`, {
      name: '定金方案（tours.10）',
      basePrice: 4000,
      depositMode: 'DEPOSIT_FIXED',
      depositValue: 800,
      active: true,
      yearRound: true,
      seasons: [],
    });
    const body = await readJson<{ depositMode: string; depositValue: number; active: boolean }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.depositMode).toBe('DEPOSIT_FIXED');
    expect(body.data!.depositValue).toBe(800);
    expect(body.data!.active).toBe(true);

    const { data } = await admin.from('trip_plans')
      .select('deposit_mode, deposit_value, seasons').eq('id', planWithDeposit).single();
    expect(data!.deposit_mode).toBe('DEPOSIT_FIXED');
    expect(Number(data!.deposit_value)).toBe(800);
    expect(data!.seasons).toEqual([]);
  });

  it('行程未上架 Midao → reviewState 維持 NONE（畫面不該說「已送審」）', async () => {
    const { data } = await admin.from('trip_plans')
      .select('review_state').eq('id', planWithDeposit).single();
    expect(data!.review_state).toBe('NONE');
  });

  it('行程已 LISTED → 方案異動寫入 review_state=PENDING（「已送出審核」才成真）', async () => {
    await admin.from('trips').update({ midao_listing: 'LISTED' }).eq('id', tripId);

    const res = await ownerA.put(`/api/trip-plans/${planWithDeposit}`, {
      name: '定金方案（tours.10）', basePrice: 4200,
    });
    const body = await readJson<{ reviewState: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.reviewState).toBe('PENDING');

    const { data } = await admin.from('trip_plans')
      .select('review_state').eq('id', planWithDeposit).single();
    expect(data!.review_state).toBe('PENDING');

    await admin.from('trips').update({ midao_listing: 'NONE' }).eq('id', tripId);
  });

  it('行程已 LISTED 時**新增**的方案也要是 PENDING（POST 與 PUT 各自都要寫）', async () => {
    await admin.from('trips').update({ midao_listing: 'LISTED' }).eq('id', tripId);

    const res = await ownerA.post(`/api/trips/${tripId}/plans`, {
      name: '上架後新增的方案（tours.10）', basePrice: 1200,
    });
    const body = await readJson<{ id: string; reviewState: string }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data!.reviewState).toBe('PENDING');

    const { data } = await admin.from('trip_plans')
      .select('review_state').eq('id', body.data!.id).single();
    expect(data!.review_state).toBe('PENDING');

    await admin.from('trip_plans').delete().eq('id', body.data!.id);
    await admin.from('trips').update({ midao_listing: 'NONE' }).eq('id', tripId);
  });

  it('DELETE：沒有訂單的方案可以刪', async () => {
    const res = await ownerA.delete(`/api/trip-plans/${planWithDeposit}`);
    expect(res.status).toBe(200);
    const { data } = await admin.from('trip_plans').select('id').eq('id', planWithDeposit).maybeSingle();
    expect(data).toBeNull();
  });

  it('DELETE：有訂單的方案 → 409（而不是撞外鍵回 500），方案仍在', async () => {
    const res = await ownerA.delete(`/api/trip-plans/${planWithOrderId}`);
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.code).toBe('REQ_003');

    const { data } = await admin.from('trip_plans')
      .select('id').eq('id', planWithOrderId).maybeSingle();
    expect(data).not.toBeNull();
  });
});

/* ===================================================== 複製行程 */
describe('POST /api/trips/:id/duplicate', () => {
  let sourcePlanCount = 0;
  let sourceAddonCount = 0;
  let sourceDepartureCount = 0;
  let pendingCopyIds: string[] = [];
  let behaviorCopyId = '';
  let authTripCountBaseline = 0;
  let shopBTripCountBaseline = 0;
  let checkAuthTripCount = false;
  let checkShopBTripCount = false;

  beforeAll(async () => {
    // Fixture setup belongs to the hook budget, not to the 30-second behavior
    // budget of the duplicate endpoint itself.
    const [{ data: addon, error: addonError }, { data: departure, error: departureError }, statusUpdate] = await Promise.all([
      admin.from('trip_addons').insert({
        tenant_id: SHOP_A.id, trip_id: tripId, name: '複製測試加購', price: 150,
      }).select('id').single(),
      admin.from('trip_departures').insert({
        tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
        departs_on: futureDate(1000), capacity: 9, status: 'OPEN', note: '複製測試團次',
      }).select('id').single(),
      admin.from('trips').update({ status: 'PUBLISHED', midao_listing: 'LISTED' }).eq('id', tripId),
    ]);
    expect(statusUpdate.error).toBeNull();
    expect(addonError).toBeNull();
    expect(departureError).toBeNull();
    expect(addon).not.toBeNull();
    expect(departure).not.toBeNull();
    createdAddons.push(addon!.id);
    createdDepartures.push(departure!.id);

    const [
      { count: plans, error: plansError },
      { count: addons, error: addonsError },
      { count: departures, error: departuresError },
      { count: copies, error: copiesError },
      { count: shopBTrips, error: shopBTripsError },
    ] = await Promise.all([
      admin.from('trip_plans').select('id', { count: 'exact', head: true }).eq('trip_id', tripId),
      admin.from('trip_addons').select('id', { count: 'exact', head: true }).eq('trip_id', tripId),
      admin.from('trip_departures').select('id', { count: 'exact', head: true }).eq('trip_id', tripId),
      admin.from('trips').select('id', { count: 'exact', head: true })
        .eq('tenant_id', SHOP_A.id).like('slug', `${tripSlug}-copy%`),
      admin.from('trips').select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_B.id),
    ]);
    expect(plansError).toBeNull();
    expect(addonsError).toBeNull();
    expect(departuresError).toBeNull();
    expect(copiesError).toBeNull();
    expect(shopBTripsError).toBeNull();
    sourcePlanCount = plans ?? 0;
    sourceAddonCount = addons ?? 0;
    sourceDepartureCount = departures ?? 0;
    authTripCountBaseline = copies ?? 0;
    shopBTripCountBaseline = shopBTrips ?? 0;
  });

  afterEach(async () => {
    if (behaviorCopyId) {
      const copyId = behaviorCopyId;
      try {
        const [
          { count: copyPlans, error: plansError },
          { count: copyAddons, error: addonsError },
          { count: copyDeps, error: depsError },
          { data: copyPlanRows, error: copyPlansError },
        ] = await Promise.all([
          admin.from('trip_plans').select('id', { count: 'exact', head: true }).eq('trip_id', copyId),
          admin.from('trip_addons').select('id', { count: 'exact', head: true }).eq('trip_id', copyId),
          admin.from('trip_departures').select('id', { count: 'exact', head: true }).eq('trip_id', copyId),
          admin.from('trip_plans').select('review_state').eq('trip_id', copyId),
        ]);
        expect(plansError).toBeNull();
        expect(addonsError).toBeNull();
        expect(depsError).toBeNull();
        expect(copyPlansError).toBeNull();
        expect(copyPlans).toBe(sourcePlanCount);
        expect(copyPlans).toBeGreaterThan(0);
        expect(copyAddons).toBe(sourceAddonCount);
        expect(copyAddons).toBeGreaterThan(0);
        expect(copyDeps).toBe(0);
        expect((copyPlanRows ?? []).every((p) => p.review_state === 'NONE')).toBe(true);
      } finally {
        const { error } = await admin.from('trips').delete().eq('id', copyId);
        if (!error) behaviorCopyId = '';
        expect(error).toBeNull();
      }
    }

    if (pendingCopyIds.length) {
      const ids = pendingCopyIds;
      const { error } = await admin.from('trips').delete().in('id', ids);
      if (!error) pendingCopyIds = [];
      expect(error).toBeNull();
    }

    if (checkShopBTripCount) {
      const { count: after } = await admin.from('trips')
        .select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_B.id);
      expect(after).toBe(shopBTripCountBaseline);
      checkShopBTripCount = false;
    }

    if (checkAuthTripCount) {
      const { count: after } = await admin.from('trips')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', SHOP_A.id).like('slug', `${tripSlug}-copy%`);
      expect(after).toBe(authTripCountBaseline);
      checkAuthTripCount = false;
    }
  });

  afterAll(async () => {
    const reset = await admin.from('trips')
      .update({ status: 'DRAFT', midao_listing: 'NONE' }).eq('id', tripId);
    const copies = tripSlug
      ? await admin.from('trips').select('id').eq('tenant_id', SHOP_A.id)
        .like('slug', `${tripSlug}-copy%`)
      : { data: [], error: null };
    const copyIds = (copies.data ?? []).map((row) => row.id);
    const copyDelete = copyIds.length
      ? await admin.from('trips').delete().in('id', copyIds)
      : { error: null };
    const remaining = tripSlug
      ? await admin.from('trips').select('id', { count: 'exact', head: true })
        .eq('tenant_id', SHOP_A.id).like('slug', `${tripSlug}-copy%`)
      : { count: 0, error: null };
    expect(reset.error).toBeNull();
    expect(copies.error).toBeNull();
    expect(copyDelete.error).toBeNull();
    expect(remaining.error).toBeNull();
    expect(remaining.count).toBe(0);
  });

  it('HTTP requires login and MANAGER before it reaches the duplicate RPC', async () => {
    checkAuthTripCount = true;
    const [anonymous, staff] = await Promise.all([
      fetch(`${baseUrl}/api/trips/${tripId}/duplicate`, { method: 'POST' }),
      staffA.post(`/api/trips/${tripId}/duplicate`),
    ]);
    const [anonymousBody, staffBody] = await Promise.all([readJson(anonymous), readJson(staff)]);
    expect(anonymous.status).toBe(401);
    expect(anonymousBody).toMatchObject({ success: false, code: 'AUTH_001' });
    expect(staff.status).toBe(403);
    expect(staffBody).toMatchObject({ success: false, code: 'AUTH_005' });
  });

  it('direct RPC rejects STAFF', async () => {
    const { error: staffError } = await staffRpc.rpc('duplicate_trip_atomic', {
      p_tenant_id: SHOP_A.id, p_source_trip_id: tripId,
    });
    expect(staffError).not.toBeNull();
    expect(staffError!.code).toBe('42501');
  });

  it('direct RPC rejects a manager targeting another tenant', async () => {
    checkShopBTripCount = true;
    const { error: crossTenantError } = await managerRpc.rpc('duplicate_trip_atomic', {
      p_tenant_id: SHOP_B.id, p_source_trip_id: tripId,
    });
    expect(crossTenantError).not.toBeNull();
    expect(crossTenantError!.code).toBe('42501');
  });

  it('複本是 DRAFT / midao NONE、方案與加購跟著複製、團次不複製', async () => {
    expect(sourceDepartureCount).toBeGreaterThan(0); // source 確實有團次

    const res = await ownerA.post(`/api/trips/${tripId}/duplicate`);
    const body = await readJson<{ id: string; title: string; slug: string; status: string; midaoListing: string; planCount: number; upcomingDepartureCount: number }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const copyId = body.data?.id;
    if (copyId) behaviorCopyId = copyId;
    expect(copyId).toBeTruthy();
    expect(body.data!.title).toContain('（複本）');
    expect(body.data!.slug).toContain('-copy');
    expect(body.data!.status).toBe('DRAFT');
    expect(body.data!.midaoListing).toBe('NONE');
    expect(body.data!.planCount).toBe(sourcePlanCount);
    expect(body.data!.upcomingDepartureCount).toBe(0);
  });

  it('連續複製兩次 → slug 不撞（-copy、-copy-2）', async () => {
    const first = await ownerA.post(`/api/trips/${tripId}/duplicate`);
    const f = await readJson<{ id: string; slug: string }>(first);
    if (f.data?.id) pendingCopyIds.push(f.data.id);
    expect(first.status, JSON.stringify(f)).toBe(200);

    const second = await ownerA.post(`/api/trips/${tripId}/duplicate`);
    const s = await readJson<{ id: string; slug: string }>(second);
    if (s.data?.id) pendingCopyIds.push(s.data.id);
    expect(second.status, JSON.stringify(s)).toBe(200);
    expect(s.data!.slug).not.toBe(f.data!.slug);
  });

  it('並發複製同一來源 → source lock 分配唯一且連續的 slug', async () => {
    const [first, second] = await Promise.all([
      ownerA.post(`/api/trips/${tripId}/duplicate`),
      ownerA.post(`/api/trips/${tripId}/duplicate`),
    ]);
    const f = await readJson<{ id: string; slug: string }>(first);
    if (f.data?.id) pendingCopyIds.push(f.data.id);
    const s = await readJson<{ id: string; slug: string }>(second);
    if (s.data?.id) pendingCopyIds.push(s.data.id);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect([f.data!.slug, s.data!.slug].sort()).toEqual([
      `${tripSlug}-copy`,
      `${tripSlug}-copy-2`,
    ]);
  });

  it('B 店複製 A 店的行程 → 404，且 B 店沒有多出任何行程', async () => {
    checkShopBTripCount = true;

    const res = await ownerB.post(`/api/trips/${tripId}/duplicate`);
    expect(res.status).toBe(404);
  });
});

/* =============================================== RLS / 跨租戶隔離 */
describe('RLS：B 店帳號動 A 店的行程域資料', () => {
  let victimDeparture = '';
  let victimAddon = '';

  beforeAll(async () => {
    const { data: d } = await admin.from('trip_departures').insert({
      tenant_id: SHOP_A.id, trip_id: tripId, plan_id: planId,
      departs_on: futureDate(800), capacity: 9, status: 'OPEN', note: 'A 店原值',
    }).select('id').single();
    victimDeparture = d!.id;
    createdDepartures.push(victimDeparture);

    const { data: a } = await admin.from('trip_addons').insert({
      tenant_id: SHOP_A.id, trip_id: tripId, name: 'A 店加購', price: 300,
    }).select('id').single();
    victimAddon = a!.id;
    createdAddons.push(victimAddon);
  });

  it('GET A 店行程的團次 → 404，且看不到任何一筆', async () => {
    const res = await ownerB.get(`/api/trips/${tripId}/departures`);
    expect(res.status).toBe(404);
  });

  it('POST A 店行程的團次 → 404，且 DB 沒有多出任何一列', async () => {
    const { count: before } = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true }).eq('trip_id', tripId);

    const res = await ownerB.post(`/api/trips/${tripId}/departures`, {
      planId, departsOn: futureDate(801), capacity: 3,
    });
    expect(res.status).toBe(404);

    const { count: after } = await admin.from('trip_departures')
      .select('id', { count: 'exact', head: true }).eq('trip_id', tripId);
    expect(after).toBe(before);
  });

  it('PUT A 店的團次 → 404，且該列一個欄位都沒被改', async () => {
    const res = await ownerB.put(`/api/trip-departures/${victimDeparture}`, {
      capacity: 1, note: 'B 店竄改', status: 'CANCELLED',
    });
    expect(res.status).toBe(404);

    const { data } = await admin.from('trip_departures')
      .select('capacity, note, status').eq('id', victimDeparture).single();
    expect(data!.capacity).toBe(9);
    expect(data!.note).toBe('A 店原值');
    expect(data!.status).toBe('OPEN');
  });

  it('DELETE A 店的團次 → 404，該列仍在', async () => {
    const res = await ownerB.delete(`/api/trip-departures/${victimDeparture}`);
    expect(res.status).toBe(404);
    const { data } = await admin.from('trip_departures')
      .select('id').eq('id', victimDeparture).maybeSingle();
    expect(data).not.toBeNull();
  });

  it('PUT / DELETE A 店的加購 → 404，該列仍在且未被改', async () => {
    const put = await ownerB.put(`/api/trip-addons/${victimAddon}`, { name: 'B 店竄改', price: 1 });
    expect(put.status).toBe(404);

    const del = await ownerB.delete(`/api/trip-addons/${victimAddon}`);
    expect(del.status).toBe(404);

    const { data } = await admin.from('trip_addons')
      .select('name, price').eq('id', victimAddon).single();
    expect(data!.name).toBe('A 店加購');
    expect(Number(data!.price)).toBe(300);
  });

  it('publish / unpublish / request-midao-listing A 店的行程 → 404，狀態不變', async () => {
    const { data: before } = await admin.from('trips')
      .select('status, midao_listing').eq('id', tripId).single();

    expect((await ownerB.post(`/api/trips/${tripId}/publish`)).status).toBe(404);
    expect((await ownerB.post(`/api/trips/${tripId}/unpublish`)).status).toBe(404);
    expect((await ownerB.post(`/api/trips/${tripId}/request-midao-listing`)).status).toBe(404);

    const { data: after } = await admin.from('trips')
      .select('status, midao_listing').eq('id', tripId).single();
    expect(after).toEqual(before);
  });
});
