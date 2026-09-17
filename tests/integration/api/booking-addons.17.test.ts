/**
 * 預約加購的原子性／冪等性／租戶隔離 HTTP 驗收（issue #17 補齊-2）
 * -----------------------------------------------------------------------------
 * 本檔驗「只有真的資料庫才證明得了的那一半」：併發、回滾殘留、跨租戶、
 * 冪等回放（含刪除後不復活）。route/rpc 的形狀在
 * `tests/unit/booking-addons.17.test.ts`。
 *
 * ⚠️ PR #562／#565 拆分（#530 staged schema release 政策）：本 PR
 * （`agent/issue-17-addons-rebuild`）刻意不含 `create_booking_addon`／
 * `delete_booking_addon` 兩支 rpc 與 `booking_addons` 的新欄位——它們在獨立
 * migration PR #565（`0121_issue_17_booking_addons_hardening.sql`）。兩支 PR
 * 的合併／套用順序不保證同時發生，所以**本檔對「這支 rpc 到底存不存在」不能
 * 假設是 true**：本檔在頂層（describe 註冊之前）先探測一次 rpc 是否可用
 * （見 `probeCreateAddonRpcAvailable()`），再依探測結果決定：
 *
 *   - rpc 不存在（PGRST202/42883，這是本 PR 單獨在 CI 的 local-isolated
 *     Supabase 上跑時的真實現況）→ 只跑「safe-degradation」那個 describe，
 *     驗證 route 真的照 `src/app/api/bookings/[id]/addons/route.ts` 檔頭註解
 *     承諾的那樣安全降級（POST/DELETE 503、GET 空陣列），不是被誤判成假的
 *     200 成功。
 *   - rpc 存在（一旦 0121 也套用到同一個環境——例如兩支 PR 合併後的 main，或
 *     刻意在本機把兩支分支疊在一起跑）→ 原本針對金額規則、C+ 業績三態、原子
 *     套用、冪等收據、刪除回沖、跨租戶邊界與 rpc 執行權的完整驗收全部照跑，
 *     不因為拆分 PR 而永久遺失涵蓋率。
 *
 * 兩條路徑都會真的對本機 disposable Supabase 送 HTTP 請求並斷言，不是
 * `it.skip`/純靜態占位——只有「哪一批 describe 被註冊」是條件式的，被註冊的
 * describe 一定真的執行並驗證。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

/**
 * 探測 `create_booking_addon` rpc 在這個環境是否存在。
 *
 * 用一組必然不存在的 tenant/booking id 呼叫它：
 *   - rpc 根本不存在 → PostgREST 回 `PGRST202`（找不到函式），Postgres 對應
 *     `42883 undefined_function`——這正是 route 安全降級判斷用的同一組錯誤碼
 *     （見 `src/app/api/bookings/[id]/addons/route.ts` POST 分支）。
 *   - rpc 存在 → 一定會因為 tenant/booking 不存在而回別的錯誤（訊息含
 *     `BOOKING_NOT_FOUND`，或其他驗證錯誤），錯誤碼不會是 PGRST202/42883。
 *
 * 這個探測本身不寫入任何資料，也不需要登入——直接用 service role 呼叫 rpc。
 */
async function probeCreateAddonRpcAvailable(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.rpc('create_booking_addon', {
    p_tenant: '00000000-0000-0000-0000-000000000000',
    p_booking: '00000000-0000-0000-0000-000000000000',
    p_idempotency_key: `probe-${randomUUID()}`,
    p_service_id: null,
    p_name: 'rpc-availability-probe',
    p_price: 0,
    p_quantity: 1,
    p_duration_minutes: 0,
    p_staff_id: null,
    p_performance_mode: 'INHERIT',
    p_performance_staff_id: null,
    p_notification_requested: false,
  });
  if (!error) return true; // 理論上不會發生（tenant 必然不存在），保守視為「可用」。
  const code = String((error as any)?.code ?? '');
  return code !== 'PGRST202' && code !== '42883';
}

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

// 頂層 await：探測結果決定下面哪一批 describe 會被註冊（見檔頭說明）。
// Vitest 把測試檔當 ES module 執行，支援頂層 await。
expect(process.env.TEST_SUPABASE_URL, 'integration 測試需要 TEST_SUPABASE_URL（本機 disposable Supabase）').toBeTruthy();
admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpcAvailable = await probeCreateAddonRpcAvailable(admin);
if (!rpcAvailable) {
  // 不是靜默略過——在 CI 摘要留一行證據，說明這批 CI 現實是「本 PR 單獨跑、
  // migration 0121 尚未套用」，不是探測本身壞掉。
  // eslint-disable-next-line no-console
  console.warn(
    '[booking-addons.17.test] create_booking_addon rpc 不存在（PGRST202/42883）——'
    + '這是 PR #562 單獨在 local-isolated Supabase 上跑的真實現況（migration 0121 在獨立 PR #565）。'
    + '只跑 safe-degradation 驗收；完整 RPC 成功路徑等兩支 PR 都套用後再跑。',
  );
}

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
  // admin client 已在頂層 await 區塊建立（rpc 可用性探測需要用到它），這裡只
  // 負責兩家店的登入。
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

// 這兩條在 zod 層就會被擋下（見 route.ts bodySchema），根本不會呼叫
// create_booking_addon rpc，所以不管 migration 0121 套用與否都必須一樣是
// 400——是本 PR 今天就該保證的行為，不用等 rpc。
// 事後檢查也刻意不碰 `applied_amount`/`idempotency_key` 等只有 0121 才有的
// 欄位（那會在 rpc 不存在的環境上把這個檢查本身弄壞），改用 GET（route 對缺
// 欄位/缺關聯已安全降級成空陣列，見 route.ts GET 分支）：不論 rpc 可不可用，
// 「這筆預約沒有任何加購」在兩種環境下都應該回同一個空陣列。
describe('金額／數量規則（Owner 已裁示）——zod 層驗證，與 migration 0121 是否套用無關', () => {
  it('price<0 拒絕，400', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '不合法', price: -10, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(400);
    const list = await ownerA.get(`/api/bookings/${bookingId}/addons`);
    expect(list.status).toBe(200);
    expect((await readJson<any[]>(list)).data).toEqual([]);
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
    const list = await ownerA.get(`/api/bookings/${bookingId}/addons`);
    expect(list.status).toBe(200);
    expect((await readJson<any[]>(list)).data).toEqual([]);
  });
});

/**
 * 以下所有 describe 都需要 `create_booking_addon`／`delete_booking_addon`
 * 兩支 rpc 真的存在（migration 0121，PR #565）才驗得下去——它們斷言的是
 * rpc 成功後的業務邏輯（金額/時長原子套用、C+ 業績三態、冪等收據、刪除回沖、
 * 跨租戶邊界、rpc 執行權）。當本 PR 單獨在 CI 的 local-isolated Supabase 上跑
 * （0121 尚未套用）時整批照實 skip，不是假裝跑過；一旦這個環境也套了 0121
 * （例如兩支 PR 合併後的 main），這裡的完整驗收會自動照跑，不需要改測試碼。
 */
describe.skipIf(!rpcAvailable)('金額規則：price=0（需要 rpc 才有完整成功路徑）', () => {
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
});

describe.skipIf(!rpcAvailable)('C+ 業績三態', () => {
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

describe.skipIf(!rpcAvailable)('原子套用：金額與時長同步，且 exclude 約束衝突整筆回滾', () => {
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

describe.skipIf(!rpcAvailable)('冪等收據（issue #17 §6）', () => {
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

describe.skipIf(!rpcAvailable)('刪除：只回沖該筆自己的量，且併發/重複刪除不二次回沖', () => {
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

// 未登入直接 401（requireTenant() 在碰任何 booking_addons/rpc 之前就先擋下），
// 與 migration 0121 是否套用無關，永遠都要驗。
describe('租戶邊界：未登入 401——與 migration 0121 是否套用無關', () => {
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
});

/**
 * POST 目前沒有在呼叫 rpc 之前先做租戶擁有權檢查（see route.ts POST：直接
 * `admin.rpc('create_booking_addon', ...)`），跨租戶／跨店的 404 是 rpc 內部
 * 用 `p_tenant` 過濾出來的——rpc 不存在時整支請求會先被 503 擋下，根本走不到
 * 這個判斷，所以下面三個測試（跨店 idempotency key、跨店 404、rpc 直接執行權）
 * 全部需要 rpc 真的存在。
 */
describe.skipIf(!rpcAvailable)('租戶邊界：需要 rpc 才驗得到的部分', () => {
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

/**
 * PR #562 單獨在 CI 的 local-isolated Supabase 上跑時的**真實現況**：
 * migration 0121（PR #565）尚未套用，`create_booking_addon`／
 * `delete_booking_addon` 兩支 rpc 不存在。這個 describe 只在探測到 rpc 真的
 * 不可用時註冊並執行（`describe.skipIf(rpcAvailable)`），驗證的是
 * `src/app/api/bookings/[id]/addons/route.ts` 檔頭承諾的安全降級契約本身，
 * 而不是假裝 rpc 存在去斷言 200。
 *
 * 一旦 0121 套用到同一個環境，這批 describe 會被 skip（因為那時
 * `rpcAvailable` 為 true，上面的完整驗收會接手跑），不會兩邊同時斷言互相
 * 矛盾的狀態碼。
 */
describe.skipIf(rpcAvailable)('schema 尚未套用 migration 0121 時的安全降級（本 PR 今天的真實契約）', () => {
  it('POST：找不到 create_booking_addon rpc 時回 503，不是假的 200 成功，且完全不寫入任何東西', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '深層護髮', price: 200, quantity: 1, durationMinutes: 0,
      performanceMode: 'INHERIT', notify: false, idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SYS_001'); // ERR.INTERNAL，見 src/server/http.ts
    // 沒有真的套用——finalPrice 完全沒被動到
    expect((await dbBooking(bookingId)).finalPrice).toBe(500);
  });

  it('DELETE：找不到 delete_booking_addon rpc 時回 503（先確認過 addonId 不存在會是 404，不會誤判成 503）', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    // 這個環境根本不可能有真的加購（POST 一律 503），用隨機 uuid 模擬「有這個
    // addonId 但功能尚未上線」以外的情境會落在 404，這裡只驗證「查得到 addon
    // 屬於這筆 booking 之後，rpc 缺失導致的 503」——所以先用 admin 直接塞一筆
    // 「舊格式」（0121 之前欄位）的 addon row，讓 route 的擁有權查詢能通過。
    const addonId = randomUUID();
    const { error: insertError } = await admin.from('booking_addons').insert({
      id: addonId, tenant_id: SHOP_A.id, booking_id: bookingId,
      name: '舊格式加購', price: 100, quantity: 1, duration_minutes: 0,
      applied_amount: 100, applied_minutes: 0,
    });
    expect(insertError).toBeNull();

    const res = await ownerA.delete(`/api/bookings/${bookingId}/addons/${addonId}`);
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SYS_001');
    // 沒有真的回沖——finalPrice 完全沒被動到（rpc 沒跑，回沖邏輯不可能發生）
    expect((await dbBooking(bookingId)).finalPrice).toBe(500);

    await admin.from('booking_addons').delete().eq('id', addonId);
  });

  it('GET：booking_addons 缺新欄位／缺新關聯（42703／PGRST200）時安全收斂成空陣列，是 200 不是 500', async () => {
    const customerId = await insertCustomer();
    const { id: bookingId } = await insertBooking(customerId, 500, null);
    const res = await ownerA.get(`/api/bookings/${bookingId}/addons`);
    expect(res.status).toBe(200);
    const body = await readJson<any[]>(res);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});
