/**
 * 點數折抵的預約狀態閘門（issue #291）
 * -----------------------------------------------------------------------------
 * ## 這一檔要證的是什麼
 *
 * `redeem_booking_points`（`0090`）的守門序列完全沒有檢查 `bookings.status`，於是
 * **已取消的預約仍然折得下去**：顧客的點數被真的扣掉、帳本真的記一筆，換到的是
 * 一筆不會發生的預約的折扣。點數等同金額（1 點 = 1 元），這是實質損失。
 *
 * Owner 2026-09-08 裁示：擋 COMPLETED / CANCELLED / NO_SHOW，只允許 PENDING /
 * CONFIRMED。`0093` 在 rpc 裡加上這道白名單檢查。
 *
 * ## ⚠️ 為什麼被擋的案例不能只斷言「回了 409」
 *
 * 一個「先扣點、才發現狀態不對、然後 raise」的錯誤實作**也會回 409**。真正要證明的
 * 是「被擋下時什麼都沒發生」，所以每一個被擋的狀態都逐一斷言三件事都沒有變：
 * 顧客點數、`bookings.final_price`、以及該顧客的點數帳本筆數。這是 PB-029：測試
 * 的名稱不能宣稱得比它實際驗到的多。
 *
 * ## 前置隔離
 *
 * 每條測試自己造顧客與預約（`T291` 前綴），afterEach 只刪自己造的。時段取很遠的
 * 未來且彼此不重疊，避免撞到既有預約的重疊約束。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
const ALLOWED: BookingStatus[] = ['PENDING', 'CONFIRMED'];
const BLOCKED: BookingStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

let admin: SupabaseClient;
let ownerA: AuthedApi;

const createdBookings: string[] = [];
const createdCustomers: string[] = [];

/** 未來很遠且彼此不重疊的時段，避免撞到既有預約 */
let slotCursor = 0;
function farFutureSlot(): { startAt: string; endAt: string } {
  const base = Date.now() + 800 * 24 * 60 * 60 * 1000 + (slotCursor++) * 3 * 60 * 60 * 1000;
  return {
    startAt: new Date(base).toISOString(),
    endAt: new Date(base + 60 * 60 * 1000).toISOString(),
  };
}

async function insertCustomer(points: number): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('customers').insert({
    id, tenant_id: SHOP_A.id, name: `T291-${id.slice(0, 8)}`, phone: '', points, active: true,
  });
  expect(error).toBeNull();
  createdCustomers.push(id);
  return id;
}

async function insertBooking(
  customerId: string, finalPrice: number, status: BookingStatus,
): Promise<string> {
  const id = randomUUID();
  const slot = farFutureSlot();
  const { error } = await admin.from('bookings').insert({
    id,
    tenant_id: SHOP_A.id,
    booking_no: `T291${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    customer_id: customerId,
    service_id: SHOP_A.serviceA1,
    // staff_id 一律 null：`x_bookings_overlap` 只在 staff_id is not null 時生效，
    // 給 null 就完全避開時段重疊約束，不必為了測狀態去編排不衝突的時段。
    staff_id: null,
    start_at: slot.startAt,
    end_at: slot.endAt,
    duration_minutes: 60,
    price: finalPrice,
    final_price: finalPrice,
    status,
    payment_status: 'UNPAID',
    source: 'MANUAL',
  });
  expect(error).toBeNull();
  createdBookings.push(id);
  return id;
}

async function snapshot(customerId: string, bookingId: string) {
  const [{ data: customer }, { data: booking }, { data: logs }] = await Promise.all([
    admin.from('customers').select('points').eq('id', customerId).maybeSingle(),
    admin.from('bookings').select('final_price').eq('id', bookingId).maybeSingle(),
    admin.from('customer_point_logs').select('id').eq('customer_id', customerId),
  ]);
  return {
    points: Number(customer?.points ?? -1),
    finalPrice: Number(booking?.final_price ?? -1),
    logCount: (logs ?? []).length,
  };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterEach(async () => {
  // 只刪自己造的：整表 delete 會清掉別的測試檔的前置資料。
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

describe('已結案的預約不得再折抵點數（issue #291）', () => {
  for (const status of BLOCKED) {
    it(`${status} → 409，且點數、final_price、帳本三者皆未變動`, async () => {
      const customerId = await insertCustomer(500);
      const bookingId = await insertBooking(customerId, 1000, status);
      const before = await snapshot(customerId, bookingId);
      expect(before).toEqual({ points: 500, finalPrice: 1000, logCount: 0 });

      const response = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 50 });
      const payload = await readJson(response);
      expect(response.status).toBe(409);
      expect(payload.success).toBe(false);
      // 訊息要說得出「為什麼」與「怎麼辦」，不是只回一句無法折抵。
      expect(payload.message ?? '').toContain('無法再折抵');
      expect(payload.message ?? '').toContain('已確認');

      // ⚠️ 這三行才是重點。只斷言 409 的話，一個「先扣點、才發現狀態不對、
      // 然後 raise」的實作也會全綠——而那正是這個 issue 要防的損失本身。
      expect(await snapshot(customerId, bookingId)).toEqual(before);
    });
  }

  for (const status of ALLOWED) {
    it(`${status} → 200，折抵照常生效（對照組：證明擋的是狀態，不是把整支端點關掉）`, async () => {
      const customerId = await insertCustomer(500);
      const bookingId = await insertBooking(customerId, 1000, status);

      const response = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 50 });
      const payload = await readJson<{ finalPrice: number; customerPoints: number }>(response);
      expect(response.status, payload.message ?? '').toBe(200);
      expect(payload.data).toEqual({ finalPrice: 950, customerPoints: 450 });

      // 回應說的事情要真的發生在資料庫裡（不是只回一個算好的數字）。
      expect(await snapshot(customerId, bookingId))
        .toEqual({ points: 450, finalPrice: 950, logCount: 1 });
    });
  }

  it('狀態檢查排在點數不足與金額超限之前——錯誤訊息要指向真正的問題', async () => {
    /**
     * 一筆已取消、金額只有 10 元、顧客點數只有 1 點的預約，同時滿足三種失敗條件。
     * 若狀態檢查排在後面，店家會拿到「顧客點數不足」——他就會跑去幫顧客加點，
     * 加完再試一次，還是失敗。真正的問題從頭到尾沒被說出來。
     */
    const customerId = await insertCustomer(1);
    const bookingId = await insertBooking(customerId, 10, 'CANCELLED');
    const response = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 999 });
    const payload = await readJson(response);
    expect(response.status).toBe(409);
    expect(payload.message ?? '').toContain('無法再折抵');
    expect(payload.message ?? '').not.toContain('點數不足');
  });

  it('找不到的預約仍然是 404，狀態閘門沒有把它蓋掉', async () => {
    // 新增一道檢查時最容易壓掉既有語意：確認「不存在」還是走 404 那條路。
    const response = await ownerA.post(`/api/bookings/${randomUUID()}/apply-points`, { points: 10 });
    expect(response.status).toBe(404);
  });
});
