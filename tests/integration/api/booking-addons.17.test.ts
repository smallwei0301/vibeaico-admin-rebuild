/**
 * 預約加購 API 整合測試 — GitHub issue #17（補齊-2）。
 *
 * 端點（04 分冊 §B-1.1，migration 0020 `booking_addons`）：
 *   GET    /api/bookings/:id/addons
 *   POST   /api/bookings/:id/addons          {serviceId?, name, price, quantity,
 *                                             durationMinutes, staffId?, notify}
 *   DELETE /api/bookings/:id/addons/:addonId
 *
 * 本檔要證明的四件事（issue #17 驗收清單）：
 *   1. RLS／跨租戶：B 店帳號拿 A 店的預約 id 讀寫加購一律 404，且沒有任何資料列被寫入
 *   2. 金額：新增後 final_price 正確增加、刪除後回沖；0 元接受、負數拒絕
 *   3. `notify=true` → mock LINE 收到消費明細且推播額度 −1；
 *      `notify=false` → **mock.requests 整個為空**（不是「/push 沒被打」而已）
 *   4. 額度用盡 → 409、**mock LINE 零請求**，但加購仍寫入且金額仍生效
 *
 * 另含派工單指定的邊界：**加購後手動調價、再刪除加購**——回沖是「減去當初實際
 * 加上去的金額」，不是重算，所以調價後刪除會從調過的價再扣一次。這是刻意的
 * 定義（見 addons route 檔頭），這裡把它釘住，避免日後被「順手改成重算」。
 *
 * 手法沿用 chat-image.15.test.ts：mock LINE 綁 LINE_API_BASE 的固定 port；
 * SHOP_A 的 LINE 憑證由 beforeAll 以 encryptSecret 寫入、afterAll 還原快照；
 * 額度上限依 EXTRA_PUSH 訂閱現算（seed 給 SHOP_A 全部付費碼 → 700 而非 200）。
 *
 * 清理紀律（同 bookings-advanced.b1.test.ts）：不用 seed 的 customerA1/A2/A3
 * （reports.a5 以其手算期望值），一律自建專屬顧客；預約時段取「未來很遠」
 * （+360 天起跳，與 bookings.a2 的 +300、b1 的 +320 錯開，避免撞
 * x_bookings_overlap）；每筆用完即刪。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const CHANNEL_SECRET = 'itest-line-channel-secret-17-addon';
const CHANNEL_TOKEN = 'itest-line-access-token-17-addon';
const ADDON_LINE_USER = 'Uaddon17itest00000000000000000001';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

type AddonResult = {
  addon: { id: string; name: string; appliedAmount: number; appliedMinutes: number; notified: string };
  finalPrice: number;
  endAt: string;
  durationMinutes: number;
  notified: string;
};

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * HOUR_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
let quotaRowExistedAtStart = false;
let quotaUsedAtStart = 0;

let customerId = '';           // 未綁 LINE 的顧客（多數案例用）
let customerLineId = '';       // 已綁 LINE 的顧客（通知案例用）
const createdBookings: string[] = [];
let farFutureCounter = 0;

/** 未來很遠（+360 天起）、彼此不重疊的時段 */
function farFutureSlot(): { startAt: string; endAt: string } {
  farFutureCounter += 1;
  const start = new Date(Date.now() + 360 * DAY_MS + farFutureCounter * 3 * HOUR_MS);
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + HOUR_MS).toISOString() };
}

async function insertCustomer(name: string, lineUserId: string | null): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('customers').insert({
    id, tenant_id: SHOP_A.id, name, phone: '', points: 0, active: true,
    line_user_id: lineUserId,
  });
  expect(error).toBeNull();
  return id;
}

/** service role 直插 booking（前置資料；staff 預設 null 避開排除約束） */
async function insertBooking(params: {
  customerId?: string;
  status?: string;
  finalPrice?: number;
  staffId?: string | null;
  startAt?: string;
  endAt?: string;
}): Promise<string> {
  const id = randomUUID();
  const slot = params.startAt && params.endAt
    ? { startAt: params.startAt, endAt: params.endAt }
    : farFutureSlot();
  const { error } = await admin.from('bookings').insert({
    id,
    tenant_id: SHOP_A.id,
    booking_no: `TEST17${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    customer_id: params.customerId ?? customerId,
    service_id: SHOP_A.serviceA1,
    staff_id: params.staffId ?? null,
    start_at: slot.startAt,
    end_at: slot.endAt,
    duration_minutes: 60,
    price: 1000,
    final_price: params.finalPrice ?? 1000,
    status: params.status ?? 'CONFIRMED',
    source: 'MANUAL',
    note: '',
  });
  expect(error).toBeNull();
  createdBookings.push(id);
  return id;
}

async function readBooking(id: string) {
  const { data, error } = await admin.from('bookings')
    .select('final_price, duration_minutes, start_at, end_at, status')
    .eq('id', id).maybeSingle();
  expect(error).toBeNull();
  return data as {
    final_price: number; duration_minutes: number; start_at: string; end_at: string; status: string;
  };
}

async function addonRows(bookingId: string) {
  const { data, error } = await admin.from('booking_addons')
    .select('id, name, price, quantity, applied_amount, applied_minutes, notified, staff_id')
    .eq('booking_id', bookingId).order('created_at', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as {
    id: string; name: string; price: number; quantity: number;
    applied_amount: number; applied_minutes: number; notified: string; staff_id: string | null;
  }[];
}

async function quotaUsed(): Promise<number> {
  const { data, error } = await admin.from('push_quota_usage')
    .select('used').eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey()).maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number): Promise<void> {
  const { error } = await admin.from('push_quota_usage')
    .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used }, { onConflict: 'tenant_id,month' });
  expect(error).toBeNull();
}

/** 與 src/server/features.ts isFeatureActive 同一條規則，現算 SHOP_A 的推播上限 */
async function currentPushQuotaLimit(): Promise<number> {
  const { data, error } = await admin.from('feature_subscriptions')
    .select('active, expires_at').eq('tenant_id', SHOP_A.id).eq('code', 'EXTRA_PUSH').maybeSingle();
  expect(error).toBeNull();
  const row = data as { active: boolean; expires_at: string | null } | null;
  const active = !!row?.active && (!row.expires_at || new Date(row.expires_at) > new Date());
  return active ? 700 : 200;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.LINE_API_BASE).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

  await mock.start();

  const { data: snap, error: e0 } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;
  const { error: e1 } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
  }).eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  const { data: q } = await admin.from('push_quota_usage')
    .select('used').eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey()).maybeSingle();
  quotaRowExistedAtStart = !!q;
  quotaUsedAtStart = (q as { used: number } | null)?.used ?? 0;

  customerId = await insertCustomer('加購測試顧客（未綁 LINE）', null);
  customerLineId = await insertCustomer('加購測試顧客（已綁 LINE）', ADDON_LINE_USER);
});

beforeEach(() => { mock.reset(); });

afterAll(async () => {
  await mock.stop();

  if (createdBookings.length > 0) {
    // booking_addons 以 booking_id on delete cascade，刪預約即一併清掉
    await admin.from('bookings').delete().in('id', createdBookings);
  }
  for (const id of [customerId, customerLineId]) {
    if (id) await admin.from('customers').delete().eq('id', id);
  }
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update(settingsSnapshot).eq('tenant_id', SHOP_A.id);
  }
  if (quotaRowExistedAtStart) {
    await admin.from('push_quota_usage')
      .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used: quotaUsedAtStart },
        { onConflict: 'tenant_id,month' });
  } else {
    await admin.from('push_quota_usage')
      .delete().eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey());
  }
});

/* ========================================================== 1. 金額與 CRUD */

describe('加購 CRUD 與金額（04 §B-1.1）', () => {
  it('新增加購：final_price 增加 price×quantity，明細列記下 applied_amount', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });

    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '深層護髮', price: 800, quantity: 2, durationMinutes: 0, notify: false,
    });
    expect(res.status).toBe(200);
    const body = await readJson<AddonResult>(res);
    expect(body.success).toBe(true);
    expect(body.data!.finalPrice).toBe(2600);          // 1000 + 800×2
    expect(body.data!.addon.appliedAmount).toBe(1600);

    expect(Number((await readBooking(bookingId)).final_price)).toBe(2600);
    const rows = await addonRows(bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('深層護髮');
    expect(Number(rows[0].applied_amount)).toBe(1600);
  });

  it('GET 回該筆預約的加購明細（依建立時間）', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '青草膏', price: 120, quantity: 1, durationMinutes: 0, notify: false,
    });
    await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '刮痧', price: 300, quantity: 1, durationMinutes: 0, notify: false,
    });

    const res = await ownerA.get(`/api/bookings/${bookingId}/addons`);
    expect(res.status).toBe(200);
    const body = await readJson<{ name: string; appliedAmount: number }[]>(res);
    expect(body.data!.map((a) => a.name)).toEqual(['青草膏', '刮痧']);
    expect(Number((await readBooking(bookingId)).final_price)).toBe(1420);
  });

  it('刪除加購：回沖 applied_amount，明細列一併消失', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const created = await readJson<AddonResult>(await ownerA.post(
      `/api/bookings/${bookingId}/addons`,
      { name: '頭皮按摩', price: 500, quantity: 1, durationMinutes: 0, notify: false },
    ));
    expect(created.data!.finalPrice).toBe(1500);

    const res = await ownerA.delete(`/api/bookings/${bookingId}/addons/${created.data!.addon.id}`);
    expect(res.status).toBe(200);
    const body = await readJson<{ finalPrice: number; revertedAmount: number }>(res);
    expect(body.data!.finalPrice).toBe(1000);
    expect(body.data!.revertedAmount).toBe(500);

    expect(Number((await readBooking(bookingId)).final_price)).toBe(1000);
    expect(await addonRows(bookingId)).toHaveLength(0);
  });

  it('佔時長的加購延長 end_at 與 duration_minutes，刪除後一併收回', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const before = await readBooking(bookingId);

    const created = await readJson<AddonResult>(await ownerA.post(
      `/api/bookings/${bookingId}/addons`,
      { name: '熱敷', price: 200, quantity: 2, durationMinutes: 15, notify: false },
    ));
    expect(created.data!.durationMinutes).toBe(90);    // 60 + 15×2
    const after = await readBooking(bookingId);
    expect(Date.parse(after.end_at) - Date.parse(before.end_at)).toBe(30 * 60_000);

    await ownerA.delete(`/api/bookings/${bookingId}/addons/${created.data!.addon.id}`);
    const reverted = await readBooking(bookingId);
    expect(Number(reverted.duration_minutes)).toBe(60);
    expect(Date.parse(reverted.end_at)).toBe(Date.parse(before.end_at));
  });

  it('0 元加購：接受，明細有記錄但 final_price 不變', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '招待毛巾', price: 0, quantity: 1, durationMinutes: 0, notify: false,
    });
    expect(res.status).toBe(200);
    const body = await readJson<AddonResult>(res);
    expect(body.data!.finalPrice).toBe(1000);
    expect(body.data!.addon.appliedAmount).toBe(0);
    expect(await addonRows(bookingId)).toHaveLength(1);
  });

  it('負數加購價：400 拒絕，沒有任何明細列被寫入、金額不動', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '負數測試', price: -100, quantity: 1, durationMinutes: 0, notify: false,
    });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.code).toBe('REQ_001');
    expect(await addonRows(bookingId)).toHaveLength(0);
    expect(Number((await readBooking(bookingId)).final_price)).toBe(1000);
  });

  it('數量 0：400 拒絕', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '數量測試', price: 100, quantity: 0, durationMinutes: 0, notify: false,
    });
    expect(res.status).toBe(400);
    expect(await addonRows(bookingId)).toHaveLength(0);
  });

  it('加購後手動調價、再刪除加購：回沖是「減去當初加上去的金額」，不是重算', async () => {
    /*
     * 這條是刻意釘住的定義（見 addons route 檔頭「回沖」）。
     * 1000 →（加購 500）→ 1500 →（店家調價成 1200）→ 刪除加購 → 1200 − 500 = 700。
     * 「重算」會得到別的數字；final_price 是流水餘額、調價不留紀錄，無從重算。
     */
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const created = await readJson<AddonResult>(await ownerA.post(
      `/api/bookings/${bookingId}/addons`,
      { name: '精油加強', price: 500, quantity: 1, durationMinutes: 0, notify: false },
    ));
    expect(created.data!.finalPrice).toBe(1500);

    const adjust = await ownerA.post(`/api/bookings/${bookingId}/adjust-price`, { finalPrice: 1200 });
    expect(adjust.status).toBe(200);

    const del = await readJson<{ finalPrice: number; revertedAmount: number }>(
      await ownerA.delete(`/api/bookings/${bookingId}/addons/${created.data!.addon.id}`));
    expect(del.data!.finalPrice).toBe(700);
    expect(del.data!.revertedAmount).toBe(500);
    expect(Number((await readBooking(bookingId)).final_price)).toBe(700);
  });

  it('折抵已把金額壓到低於加購金額時，回沖夾在 0（不會變負數）', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const created = await readJson<AddonResult>(await ownerA.post(
      `/api/bookings/${bookingId}/addons`,
      { name: '大額加購', price: 900, quantity: 1, durationMinutes: 0, notify: false },
    ));
    expect(created.data!.finalPrice).toBe(1900);
    // 調價把總金額壓到 100（比加購的 900 還低）
    await ownerA.post(`/api/bookings/${bookingId}/adjust-price`, { finalPrice: 100 });

    const del = await readJson<{ finalPrice: number; revertedAmount: number }>(
      await ownerA.delete(`/api/bookings/${bookingId}/addons/${created.data!.addon.id}`));
    expect(del.data!.finalPrice).toBe(0);
    expect(del.data!.revertedAmount).toBe(100);
    expect(Number((await readBooking(bookingId)).final_price)).toBe(0);
  });

  it('已完成的預約不能加購／不能移除加購（409）', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000, status: 'CONFIRMED' });
    const created = await readJson<AddonResult>(await ownerA.post(
      `/api/bookings/${bookingId}/addons`,
      { name: '結案前加購', price: 300, quantity: 1, durationMinutes: 0, notify: false },
    ));
    const { error } = await admin.from('bookings')
      .update({ status: 'COMPLETED' }).eq('id', bookingId);
    expect(error).toBeNull();

    const post = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '結案後加購', price: 100, quantity: 1, durationMinutes: 0, notify: false,
    });
    expect(post.status).toBe(409);
    const del = await ownerA.delete(`/api/bookings/${bookingId}/addons/${created.data!.addon.id}`);
    expect(del.status).toBe(409);
    expect(await addonRows(bookingId)).toHaveLength(1);
  });

  it('不存在的加購 id → 404；不存在的預約 id → 404', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const del = await ownerA.delete(`/api/bookings/${bookingId}/addons/${randomUUID()}`);
    expect(del.status).toBe(404);
    const get = await ownerA.get(`/api/bookings/${randomUUID()}/addons`);
    expect(get.status).toBe(404);
  });
});

/* ========================================================== 2. 跨租戶 / RLS */

describe('RLS：跨租戶讀寫被擋（04 §0 第 7 條）', () => {
  it('B 店帳號讀／寫／刪 A 店預約的加購一律 404，且沒有任何資料列被寫入', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const created = await readJson<AddonResult>(await ownerA.post(
      `/api/bookings/${bookingId}/addons`,
      { name: 'A 店的加購', price: 400, quantity: 1, durationMinutes: 0, notify: false },
    ));

    const get = await ownerB.get(`/api/bookings/${bookingId}/addons`);
    expect(get.status).toBe(404);

    const post = await ownerB.post(`/api/bookings/${bookingId}/addons`, {
      name: 'B 店偷寫的加購', price: 999, quantity: 1, durationMinutes: 0, notify: false,
    });
    expect(post.status).toBe(404);

    const del = await ownerB.delete(`/api/bookings/${bookingId}/addons/${created.data!.addon.id}`);
    expect(del.status).toBe(404);

    // 只剩 A 店自己寫的那一筆，B 店既沒讀到也沒寫進去、也沒刪掉
    const rows = await addonRows(bookingId);
    expect(rows.map((r) => r.name)).toEqual(['A 店的加購']);
    expect(Number((await readBooking(bookingId)).final_price)).toBe(1400);
  });

  it('帶別店的 serviceId／staffId → 404，不會寫入半筆加購', async () => {
    const bookingId = await insertBooking({ finalPrice: 1000 });
    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '跨店服務', serviceId: SHOP_B.customerB1,   // 不屬於 A 店的 uuid
      price: 100, quantity: 1, durationMinutes: 0, notify: false,
    });
    expect(res.status).toBe(404);
    expect(await addonRows(bookingId)).toHaveLength(0);
  });
});

/* ============================================================ 3. LINE 通知 */

describe('addonNotify：勾了才推，沒勾就一則 LINE 請求都不發', () => {
  it('notify=false → mock LINE 的 requests 整個為空，推播額度不變', async () => {
    const bookingId = await insertBooking({ customerId: customerLineId, finalPrice: 1000 });
    const before = await quotaUsed();

    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '不通知的加購', price: 300, quantity: 1, durationMinutes: 0, notify: false,
    });
    expect(res.status).toBe(200);

    // ⚠️ 斷言是「整個 requests 為空」，不是「/push 沒有被打」——
    // 本專案既有慣例（見 line-events.ts 的 SILENT 分支）：沒要通知就不准對
    // LINE 發出任何請求，含 profile／botinfo 之類的查詢。
    expect(mock.requests).toEqual([]);
    expect(await quotaUsed()).toBe(before);
    expect((await addonRows(bookingId))[0].notified).toBe('NONE');
  });

  it('notify=true 且顧客已綁 LINE → 收到消費明細 push，推播額度 −1', async () => {
    const bookingId = await insertBooking({ customerId: customerLineId, finalPrice: 1000 });
    const before = await quotaUsed();

    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '深層護髮', price: 800, quantity: 2, durationMinutes: 0, notify: true,
    });
    expect(res.status).toBe(200);
    const body = await readJson<AddonResult>(res);
    expect(body.data!.notified).toBe('LINE');

    const pushes = mock.requestsFor('/v2/bot/message/push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body.to).toBe(ADDON_LINE_USER);
    const text = pushes[0].body.messages[0].text as string;
    expect(text).toContain('深層護髮 ×2');
    expect(text).toContain('NT$ 1,600');       // 本次加購合計
    expect(text).toContain('NT$ 2,600');       // 加購後的預約金額
    expect(pushes[0].headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);

    expect(await quotaUsed()).toBe(before + 1);
    expect((await addonRows(bookingId))[0].notified).toBe('LINE');
  });

  it('notify=true 但顧客未綁 LINE → 零 LINE 請求、額度不變，回 NO_LINE（加購照樣成立）', async () => {
    const bookingId = await insertBooking({ customerId, finalPrice: 1000 });
    const before = await quotaUsed();

    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '未綁 LINE 的加購', price: 250, quantity: 1, durationMinutes: 0, notify: true,
    });
    expect(res.status).toBe(200);
    expect((await readJson<AddonResult>(res)).data!.notified).toBe('NO_LINE');

    expect(mock.requests).toEqual([]);
    expect(await quotaUsed()).toBe(before);
    expect(Number((await readBooking(bookingId)).final_price)).toBe(1250);
    expect((await addonRows(bookingId))[0].notified).toBe('NO_LINE');
  });

  it('推播額度用盡 → 409、mock LINE 零請求，但加購已寫入且金額已生效', async () => {
    const bookingId = await insertBooking({ customerId: customerLineId, finalPrice: 1000 });
    const limit = await currentPushQuotaLimit();
    await setQuotaUsed(limit);

    const res = await ownerA.post(`/api/bookings/${bookingId}/addons`, {
      name: '額度用完時的加購', price: 600, quantity: 1, durationMinutes: 0, notify: true,
    });
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.code).toBe('REQ_003');
    // 訊息必須說清楚「加購已新增」，否則店家會以為整筆失敗而重加一次
    expect(body.message).toContain('加購已新增');

    expect(mock.requests).toEqual([]);
    expect(await quotaUsed()).toBe(limit);

    const rows = await addonRows(bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0].notified).toBe('QUOTA_EXCEEDED');
    expect(Number((await readBooking(bookingId)).final_price)).toBe(1600);
  });
});
