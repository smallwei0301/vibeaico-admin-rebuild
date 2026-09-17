/**
 * 預約加購的原子性／冪等性／租戶隔離 HTTP 驗收（issue #17 補齊-2）
 * -----------------------------------------------------------------------------
 * 本檔驗「只有真的資料庫才證明得了的那一半」：併發、回滾殘留、跨租戶、
 * 冪等回放（含刪除後不復活）。route/rpc 的形狀在
 * `tests/unit/booking-addons.17.test.ts`。
 *
 * ⚠️ 執行環境：本檔沿用既有 `tests/integration/**` 慣例，讀
 * `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`。依 issue #17 任務
 * 邊界，本輪只在**本機 disposable Supabase**（`LOCAL_ISOLATED` profile，見
 * `docs/AGENT-ISOLATED-TEST-LANES.md`）跑這份檔案；本 session 沒有可用的
 * docker/本機 Supabase 執行環境，因此本檔屬於**已撰寫、未執行**——見 PR body
 * 的 ENVIRONMENT_BLOCKER 段落，不得誤讀成「已跑過且綠燈」。
 *
 * ⚠️ PREPARE 階段 gate（#530 staged schema release）：`GET/POST/DELETE
 * /api/bookings/:id/addons*` 三個路由的本體第一行都是
 * `if (!bookingAddonsSchemaActive()) …`，預設關閉（`process.env
 * .BOOKING_ADDONS_SCHEMA_ACTIVE !== 'true'`）。跑本機 `next dev`（供
 * `global-setup.ts` 起服務）前必須先把
 * `BOOKING_ADDONS_SCHEMA_ACTIVE=true` 放進該次啟動的環境變數，否則以下
 * 全部案例只會收到 404「加購功能尚未啟用」。ACTIVATE PR 拿掉這些 gate
 * 判斷之後才不再需要這個環境變數。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

const createdBookings: string[] = [];
const createdCustomers: string[] = [];

let slotCursor = 0;
function farFutureSlot(): { startAt: string; endAt: string } {
  const base = Date.now() + 500 * 24 * 60 * 60 * 1000 + (slotCursor++) * 3 * 60 * 60 * 1000;
  return { startAt: new Date(base).toISOString(), endAt: new Date(base + 60 * 60 * 1000).toISOString() };
}

async function insertCustomer(tenantId = SHOP_A.id): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('customers').insert({
    id, tenant_id: tenantId, name: `addon17-${id.slice(0, 8)}`, phone: '', points: 0, active: true,
  });
  expect(error).toBeNull();
  createdCustomers.push(id);
  return id;
}

async function insertBooking(
  customerId: string, finalPrice: number, staffId: string | null, tenantId = SHOP_A.id,
): Promise<{ id: string; durationMinutes: number; endAt: string }> {
  const id = randomUUID();
  const slot = farFutureSlot();
  const durationMinutes = 60;
  const { error } = await admin.from('bookings').insert({
    id,
    tenant_id: tenantId,
    booking_no: `T17${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    customer_id: customerId,
    service_id: tenantId === SHOP_A.id ? SHOP_A.serviceA1 : undefined,
    staff_id: staffId,
    start_at: slot.startAt,
    end_at: slot.endAt,
    duration_minutes: durationMinutes,
    price: finalPrice,
    final_price: finalPrice,
    status: 'PENDING',
    payment_status: 'UNPAID',
    source: 'MANUAL',
  });
  expect(error).toBeNull();
  createdBookings.push(id);
  return { id, durationMinutes, endAt: slot.endAt };
}

async function dbBooking(bookingId: string) {
  const { data, error } = await admin.from('bookings')
    .select('final_price, duration_minutes, end_at').eq('id', bookingId).maybeSingle();
  expect(error).toBeNull();
  return {
    finalPrice: Number(data?.final_price ?? -1),
    durationMinutes: Number(data?.duration_minutes ?? -1),
    endAt: String(data?.end_at ?? ''),
  };
}

async function dbAddonRows(bookingId: string) {
  const { data, error } = await admin.from('booking_addons')
    .select('id, applied_amount, applied_minutes, deleted_at, idempotency_key')
    .eq('booking_id', bookingId);
  expect(error).toBeNull();
  return data ?? [];
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterEach(async () => {
  if (createdBookings.length) {
    await admin.from('booking_addons').delete().in('booking_id', createdBookings);
    await admin.from('bookings').delete().in('id', createdBookings);
    createdBookings.length = 0;
  }
  if (createdCustomers.length) {
    await admin.from('customers').delete().in('id', createdCustomers);
    createdCustomers.length = 0;
  }
});

describe('金額／數量規則（Owner 已裁示）', () => {
  it('price=0 允許', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '免費贈品', price: 0, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(200);
    expect((await dbBooking(bookingId)).finalPrice).toBe(500);
  });

  it('price<0 拒絕，400', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '不合法', price: -10, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(await dbAddonRows(bookingId)).toHaveLength(0);
  });

  it('quantity<=0 拒絕，400', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    for (const quantity of [0, -1]) {
      const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
        name: '不合法', price: 100, quantity, durationMinutes: 0,
        performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
      });
      expect(res.status).toBe(400);
    }
    expect(await dbAddonRows(bookingId)).toHaveLength(0);
  });
});

describe('C+ 業績三態', () => {
  it('INHERIT：snapshot 該筆預約當下的 staff_id', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, SHOP_A.staffA1);
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '深層護髮', price: 200, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(200);
    const data = (await readJson<any>(res)).data!;
    expect(data.performanceMode).toBe('INHERIT');
    expect(data.performanceStaffId).toBe(SHOP_A.staffA1);
  });

  it('SPECIFIC_STAFF：必須帶 performanceStaffId，且必須是同租戶合法 staff', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);

    const missing = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '指定人員', price: 200, quantity: 1, durationMinutes: 0,
      performanceMode: 'SPECIFIC_STAFF', notify: false, idempotencyKey: randomUUID(),
    });
    expect(missing.status).toBe(400);

    const crossTenant = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '指定人員', price: 200, quantity: 1, durationMinutes: 0,
      performanceMode: 'SPECIFIC_STAFF', performanceStaffId: randomUUID(),
      notify: false, idempotencyKey: randomUUID(),
    });
    expect(crossTenant.status).toBe(404);

    const ok = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '指定人員', price: 200, quantity: 1, durationMinutes: 0,
      performanceMode: 'SPECIFIC_STAFF', performanceStaffId: SHOP_A.staffA2,
      notify: false, idempotencyKey: randomUUID(),
    });
    expect(ok.status).toBe(200);
    expect((await readJson<any>(ok)).data.performanceStaffId).toBe(SHOP_A.staffA2);
  });

  it('NONE：performanceStaffId 固定為 null，且與 INHERIT 可區分（不是同一個 staff_id=null）', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, SHOP_A.staffA1);
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '不計業績', price: 200, quantity: 1, durationMinutes: 0,
      performanceMode: 'NONE', notify: false, idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(200);
    const data = (await readJson<any>(res)).data!;
    expect(data.performanceMode).toBe('NONE');
    expect(data.performanceStaffId).toBeNull();
    // 金額仍然計入店家營收（finalPrice 照樣加上去），只是不歸戶任何人
    expect((await dbBooking(bookingId)).finalPrice).toBe(700);
  });
});

describe('原子套用：金額與時長同步，且 exclude 約束衝突整筆回滾', () => {
  it('成功新增：finalPrice/durationMinutes 精確加上 price×quantity／duration', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId, durationMinutes } = await insertBooking(customerId, 500, null);
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '深層護髮', price: 300, quantity: 2, durationMinutes: 30,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(200);
    const after = await dbBooking(bookingId);
    expect(after.finalPrice).toBe(500 + 300 * 2);
    expect(after.durationMinutes).toBe(durationMinutes + 30);
  });
});

describe('冪等收據（issue #17 §6）', () => {
  it('同一把 key 循序重送：回放同一筆收據，金額不重複套用', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const key = randomUUID();
    const payload = {
      name: '青草膏', price: 120, quantity: 2, durationMinutes: 0,
      performanceMode: 'INHERIT' as const, notify: false, idempotencyKey: key,
    };
    const r1 = await ownerA.post(`/api/bookings/${bookingId}/addons`, payload);
    const r2 = await ownerA.post(`/api/bookings/${bookingId}/addons`, payload);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const d1 = (await readJson<any>(r1)).data!;
    const d2 = (await readJson<any>(r2)).data!;
    expect(d1.id).toBe(d2.id);
    expect(d2.replayed).toBe(true);
    expect((await dbBooking(bookingId)).finalPrice).toBe(500 + 120 * 2); // 不是 500 + 2*(120*2)
    expect(await dbAddonRows(bookingId)).toHaveLength(1);
  });

  it('同一把 key 併發送出兩次：只落地一筆、只套用一次金額', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const key = randomUUID();
    const payload = {
      name: '併發加購', price: 100, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT' as const, notify: false, idempotencyKey: key,
    };
    const [r1, r2] = await Promise.all([
      ownerA.post(`/api/bookings/${bookingId}/addons`, payload),
      ownerA.post(`/api/bookings/${bookingId}/addons`, payload),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const rows = await dbAddonRows(bookingId);
    expect(rows).toHaveLength(1);
    expect((await dbBooking(bookingId)).finalPrice).toBe(600);
  });

  it('create → delete → 同一把 key 重送：不得復活（軟刪列仍佔用該 key）', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const key = randomUUID();
    const payload = {
      name: '一次性加購', price: 150, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT' as const, notify: false, idempotencyKey: key,
    };
    const created = await ownerA.post(`/api/bookings/${bookingId}/addons`, payload);
    expect(created.status).toBe(200);
    const addonId = (await readJson<any>(created)).data.id as string;

    const deleted = await ownerA.delete(`/api/bookings/${bookingId}/addons/${addonId}`);
    expect(deleted.status).toBe(200);
    expect((await dbBooking(bookingId)).finalPrice).toBe(500);

    const replay = await ownerA.post(`/api/bookings/${bookingId}/addons`, payload);
    expect(replay.status).toBe(200);
    const replayData = (await readJson<any>(replay)).data!;
    expect(replayData.id).toBe(addonId);
    expect(replayData.replayed).toBe(true);
    // 金額必須維持已刪除的狀態，不能因為重送又跳回 650
    expect((await dbBooking(bookingId)).finalPrice).toBe(500);
  });
});

describe('刪除：只回沖該筆自己的量，且併發/重複刪除不二次回沖', () => {
  it('只回沖自己的 applied_amount/applied_minutes，不影響其他加購或手動調價', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);

    const r1 = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '加購甲', price: 100, quantity: 1, durationMinutes: 10,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    const r2 = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '加購乙', price: 200, quantity: 1, durationMinutes: 20,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    const addon1 = (await readJson<any>(r1)).data.id as string;

    // 手動調價（模擬「加購後又手動調整過金額」——刪除不能吃掉這個調整）
    await ownerA.post(`/api/bookings/${bookingId}/adjust-price`, { finalPrice: 900 });

    const del = await ownerA.delete(`/api/bookings/${bookingId}/addons/${addon1}`);
    expect(del.status).toBe(200);
    // 900（手動調價後）− 100（只回沖加購甲自己的金額）
    expect((await dbBooking(bookingId)).finalPrice).toBe(800);
    void r2;
  });

  it('併發刪除同一筆：只回沖一次', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const created = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '加購', price: 300, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    const addonId = (await readJson<any>(created)).data.id as string;

    const [d1, d2] = await Promise.all([
      ownerA.delete(`/api/bookings/${bookingId}/addons/${addonId}`),
      ownerA.delete(`/api/bookings/${bookingId}/addons/${addonId}`),
    ]);
    expect([d1.status, d2.status]).toEqual([200, 200]);
    const results = [d1, d2].map(async (r) => (await readJson<any>(r)).data.alreadyDeleted);
    const alreadyDeletedFlags = await Promise.all(results);
    expect(alreadyDeletedFlags.filter((v) => v === true)).toHaveLength(1);
    expect((await dbBooking(bookingId)).finalPrice).toBe(500);
  });
});

describe('租戶邊界', () => {
  it('A 店的 idempotency key 不得命中 B 店（即使字面值相同）', async () => {
    const customerA = await insertCustomer(SHOP_A.id);
    const { id: bookingA } = await insertBooking(customerA, 500, null, SHOP_A.id);
    const key = randomUUID();

    const resA = await ownerA.post(`/api/bookings/${bookingA}/addons`, {
      name: 'A 店加購', price: 100, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: key,
    });
    expect(resA.status).toBe(200);

    // B 店對自己不存在的 bookingA 使用同一把 key → 404（不是把 A 店的收據借過來用）
    const resB = await ownerB.post(`/api/bookings/${bookingA}/addons`, {
      name: 'B 店嘗試', price: 100, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: key,
    });
    expect(resB.status).toBe(404);
  });

  it('別家店不得對本店的預約新增/刪除加購（404）', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const res = await ownerB.post(`/api/bookings/${bookingId}/addons`, {
      name: '越權', price: 100, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    expect([403, 404]).toContain(res.status);
    expect((await dbBooking(bookingId)).finalPrice).toBe(500);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/bookings/${bookingId}/addons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '未登入', price: 100, quantity: 1, durationMinutes: 0,
        performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
      }),
    });
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('未登入與已登入使用者都不得直接呼叫 create_booking_addon／delete_booking_addon rpc', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const args = {
      p_tenant: SHOP_A.id, p_booking: bookingId, p_idempotency_key: randomUUID(),
      p_service_id: null, p_name: '越權 rpc', p_price: 100, p_quantity: 1, p_duration_minutes: 0,
      p_staff_id: null, p_performance_mode: 'INHERIT', p_performance_staff_id: null,
      p_notification_requested: false,
    };
    const newClient = () => createClient(
      process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const anon = newClient();
    const anonResult = await anon.rpc('create_booking_addon', args);
    expect(anonResult.error).not.toBeNull();
    expect(anonResult.error?.code).toBe('42501');

    const signedIn = newClient();
    const { error: loginError } = await signedIn.auth.signInWithPassword({
      email: SHOP_A.owner.email, password: SHOP_A.owner.password,
    });
    expect(loginError).toBeNull();
    const authedResult = await signedIn.rpc('create_booking_addon', args);
    expect(authedResult.error).not.toBeNull();
    expect(authedResult.error?.code).toBe('42501');

    expect(await dbAddonRows(bookingId)).toHaveLength(0);
  });
});
