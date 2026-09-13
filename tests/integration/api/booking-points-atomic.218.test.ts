/**
 * 預約點數折抵的原子性 HTTP 驗收（GitHub issue #218）
 * -----------------------------------------------------------------------------
 * 本檔驗的是**只有真實資料庫才證明得了的那一半**：併發、回滾殘留、跨租戶。
 * route 與 rpc 的形狀在 `tests/unit/booking-points-atomic.218.test.ts`。
 *
 * 核心是這一條（#218 的症狀）：
 *
 *   兩個併發請求各折 30 點 → 點數真的少了 60，`final_price` 卻只降了 30。
 *
 * ⚠️ **只看點數的測試會全綠**——扣點那一半在修改前就有 CAS，本來就是對的。
 * 要抓到它，必須同時斷言「點數少了多少」與「價格降了多少」是同一個數字。
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

async function insertCustomer(points: number, tenantId = SHOP_A.id): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('customers').insert({
    id, tenant_id: tenantId, name: `218-${id.slice(0, 8)}`, phone: '', points, active: true,
  });
  expect(error).toBeNull();
  createdCustomers.push(id);
  return id;
}

/** 未來很遠且彼此不重疊的時段，避免撞到既有預約 */
let slotCursor = 0;
function farFutureSlot(): { startAt: string; endAt: string } {
  const base = Date.now() + 400 * 24 * 60 * 60 * 1000 + (slotCursor++) * 3 * 60 * 60 * 1000;
  return {
    startAt: new Date(base).toISOString(),
    endAt: new Date(base + 60 * 60 * 1000).toISOString(),
  };
}

async function insertBooking(
  customerId: string, finalPrice: number, tenantId = SHOP_A.id,
): Promise<string> {
  const id = randomUUID();
  const slot = farFutureSlot();
  const { error } = await admin.from('bookings').insert({
    id,
    tenant_id: tenantId,
    booking_no: `T218${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    customer_id: customerId,
    service_id: tenantId === SHOP_A.id ? SHOP_A.serviceA1 : undefined,
    staff_id: null,
    start_at: slot.startAt,
    end_at: slot.endAt,
    duration_minutes: 60,
    price: finalPrice,
    final_price: finalPrice,
    status: 'PENDING',
    payment_status: 'UNPAID',
    source: 'MANUAL',
  });
  expect(error).toBeNull();
  createdBookings.push(id);
  return id;
}

async function dbPoints(customerId: string): Promise<number> {
  const { data, error } = await admin.from('customers')
    .select('points').eq('id', customerId).maybeSingle();
  expect(error).toBeNull();
  return Number(data?.points ?? -1);
}

async function dbFinalPrice(bookingId: string): Promise<number> {
  const { data, error } = await admin.from('bookings')
    .select('final_price').eq('id', bookingId).maybeSingle();
  expect(error).toBeNull();
  return Number(data?.final_price ?? -1);
}

async function dbLogTotal(customerId: string): Promise<number> {
  const { data, error } = await admin.from('customer_point_logs')
    .select('delta').eq('customer_id', customerId);
  expect(error).toBeNull();
  return (data ?? []).reduce((sum, r: any) => sum + Number(r.delta), 0);
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
    await admin.from('bookings').delete().in('id', createdBookings);
    createdBookings.length = 0;
  }
  if (createdCustomers.length) {
    await admin.from('customer_point_logs').delete().in('customer_id', createdCustomers);
    await admin.from('customers').delete().in('id', createdCustomers);
    createdCustomers.length = 0;
  }
});

describe('扣點、折價、帳本三者永遠一致', () => {
  it('成功折抵：點數少了多少，價格就降多少，帳本也記同一個數字', async () => {
    const customerId = await insertCustomer(100);
    const bookingId = await insertBooking(customerId, 800);

    const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 40 });
    expect(res.status).toBe(200);
    const data = (await readJson<any>(res)).data!;
    expect(data.finalPrice).toBe(760);
    expect(data.customerPoints).toBe(60);

    expect(await dbPoints(customerId)).toBe(60);
    expect(await dbFinalPrice(bookingId)).toBe(760);
    expect(await dbLogTotal(customerId)).toBe(-40);
  });

  /**
   * ⚠️ 本 issue 的核心案例。修改前：兩次扣點都成功（CAS 只保證不會互相覆蓋點數），
   * 但兩邊都把 final_price 寫成「各自讀到的 800 − 30 = 770」——
   * 顧客付出 60 點，只換到 30 元折扣。
   */
  it('兩個併發折抵：點數扣掉的總額與價格降幅**必須相等**', async () => {
    const customerId = await insertCustomer(100);
    const bookingId = await insertBooking(customerId, 800);

    const [r1, r2] = await Promise.all([
      ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 30 }),
      ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 30 }),
    ]);

    const okCount = [r1, r2].filter((r) => r.status === 200).length;
    // 兩個都可能成功（點數與金額都夠），也可能其中一個因為列鎖競爭而失敗；
    // 無論成功幾個，下面這條不變量都必須成立。
    expect(okCount).toBeGreaterThanOrEqual(1);

    const pointsSpent = 100 - (await dbPoints(customerId));
    const priceCut = 800 - (await dbFinalPrice(bookingId));
    const ledger = -(await dbLogTotal(customerId));

    expect(pointsSpent).toBe(okCount * 30);
    expect(priceCut, '扣了點卻沒降價＝顧客的點數平白消失').toBe(pointsSpent);
    expect(ledger, '帳本與實際扣點對不上').toBe(pointsSpent);
  });

  it('連續折抵到剛好歸零，價格與點數同步見底', async () => {
    const customerId = await insertCustomer(50);
    const bookingId = await insertBooking(customerId, 50);

    expect((await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 20 })).status).toBe(200);
    expect((await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 30 })).status).toBe(200);

    expect(await dbPoints(customerId)).toBe(0);
    expect(await dbFinalPrice(bookingId)).toBe(0);
    expect(await dbLogTotal(customerId)).toBe(-50);
  });
});

describe('失敗路徑：一起撤回，不留半套', () => {
  it('點數不足 → 409 POINTS_001，三者全都不動', async () => {
    const customerId = await insertCustomer(5);
    const bookingId = await insertBooking(customerId, 800);

    const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 100 });
    expect(res.status).toBe(409);
    expect((await readJson(res)).code).toBe('POINTS_001');

    expect(await dbPoints(customerId)).toBe(5);
    expect(await dbFinalPrice(bookingId)).toBe(800);
    expect(await dbLogTotal(customerId), '失敗卻寫了帳本').toBe(0);
  });

  /**
   * 折抵金額超過預約金額：修改前這一條是在 route 裡先擋掉的，所以不會留下殘留；
   * 現在守門移進 rpc，要確認**點數也沒有被先扣掉**（順序錯的話會扣了才發現金額不夠）。
   */
  it('折抵超過金額 → 400，點數不得被先扣掉', async () => {
    const customerId = await insertCustomer(1000);
    const bookingId = await insertBooking(customerId, 100);

    const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 200 });
    expect(res.status).toBe(400);

    expect(await dbPoints(customerId), '金額不足卻已經扣了點').toBe(1000);
    expect(await dbFinalPrice(bookingId)).toBe(100);
    expect(await dbLogTotal(customerId)).toBe(0);
  });

  it('點數為 0 或負數 → 400，且不落地', async () => {
    const customerId = await insertCustomer(100);
    const bookingId = await insertBooking(customerId, 800);
    for (const points of [0, -10]) {
      const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points });
      expect(res.status).toBe(400);
    }
    expect(await dbPoints(customerId)).toBe(100);
    expect(await dbFinalPrice(bookingId)).toBe(800);
  });

  it('找不到預約 → 404，不動任何資料', async () => {
    const res = await ownerA.post(
      `/api/bookings/${randomUUID()}/apply-points`, { points: 10 },
    );
    expect(res.status).toBe(404);
    expect((await readJson(res)).code).toBe('REQ_002');
  });
});

describe('租戶與權限邊界', () => {
  it('別家店不得折抵本店預約的點數（回 404，且點數一分不動）', async () => {
    const customerId = await insertCustomer(100);
    const bookingId = await insertBooking(customerId, 800);

    const res = await ownerB.post(`/api/bookings/${bookingId}/apply-points`, { points: 10 });
    // SHOP_B 沒有這筆預約 → 404（不是 403：403 會洩漏「這個 id 存在」）
    expect([403, 404]).toContain(res.status);
    expect(await dbPoints(customerId), '別家店扣了本店顧客的點數').toBe(100);
    expect(await dbFinalPrice(bookingId)).toBe(800);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const customerId = await insertCustomer(100);
    const bookingId = await insertBooking(customerId, 800);
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/bookings/${bookingId}/apply-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: 10 }),
    });
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
    expect(await dbPoints(customerId)).toBe(100);
  });

  /**
   * rpc 是 security definer（繞過 RLS），所以**必須**對前端持有的 token 撤銷執行權。
   * 沒有這一條，任何登入者都能直接呼叫它扣別家店顧客的點數——route 的三道閘門
   * 完全被繞過。
   */
  it('未登入與已登入使用者都不得直接呼叫 redeem_booking_points rpc', async () => {
    const customerId = await insertCustomer(100);
    const bookingId = await insertBooking(customerId, 800);
    const args = { p_tenant: SHOP_A.id, p_booking: bookingId, p_points: 10 };
    const newClient = () => createClient(
      process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // ① 未登入（anon 角色）
    const anon = newClient();
    const anonResult = await anon.rpc('redeem_booking_points', args);
    expect(anonResult.error, 'anon 竟然呼叫得動 security definer 函式').not.toBeNull();
    expect(anonResult.error?.code, '被擋下來的理由必須是「沒有權利」，而不是「函式不存在」').toBe('42501');

    // ② 已登入的店家 owner（authenticated 角色）——這才是真正危險的那個身分。
    //    只撤 anon 不撤 authenticated（或不撤 PUBLIC）時，這一段才會抓到。
    const signedIn = newClient();
    const { data: login, error: loginError } = await signedIn.auth.signInWithPassword({
      email: SHOP_A.owner.email, password: SHOP_A.owner.password,
    });
    expect(loginError).toBeNull();
    expect(login.session, '沒有真的登入，這條就退化成第①條').toBeTruthy();

    const authedResult = await signedIn.rpc('redeem_booking_points', args);
    expect(authedResult.error, '已登入使用者竟然呼叫得動 security definer 函式').not.toBeNull();
    expect(authedResult.error?.code, '被擋下來的理由必須是「沒有權利」').toBe('42501');

    expect(await dbPoints(customerId)).toBe(100);
  });
});
