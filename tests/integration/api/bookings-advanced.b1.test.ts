/**
 * 預約進階 API 整合測試 — 12 分冊 §4「Phase 5」矩陣「其餘 B 組端點：照 §3
 * 骨架，含各狀態機 409」。端點規格見 docs/integration/04-API-CONTRACTS.md §B-1：
 *   - POST /api/bookings：伺服器算 endAt=start+service.duration、price=
 *     service.price、booking_no='B'+yymmdd+4 位流水；重疊由 DB 排除約束擋
 *     → 409「該時段已有預約」
 *   - POST /api/bookings/:id/apply-points：點數足夠 → 扣點寫 log、
 *     final_price -= points（1 點 = 1 元）；不足 → 409 POINTS_001（錯誤碼總表）
 *   - POST /api/bookings/:id/revert-complete：COMPLETED→PENDING（狀態機：
 *     其他轉換一律 409 CONFLICT）
 *   - GET /api/bookings/available-slots：回 {slots:[{start,end,staffIds[]}]}，
 *     考慮 business 設定 + 已有 bookings + block_times + shifts
 *   - GET/POST /api/block-times、DELETE /api/block-times/:id
 *
 * 清理紀律（同 bookings.a2.test.ts 檔頭）：
 *   - 不使用 seed 的 customerA1/A2/A3（reports.a5 以其手算期望值），一律自建
 *     專屬顧客並在 afterAll 清掉。
 *   - 自建 booking 的時段一律取「未來很遠」（+320 天起跳；bookings.a2 用
 *     +300 天起跳，錯開避免同 staff 撞 x_bookings_overlap），每筆用完即刪。
 *   - available-slots/block-times 用寫死演算法可推的固定未來週三（種子預設
 *     business：09:00–18:00、slotInterval 30、closedDays=[0] 週日公休——見
 *     src/config/tenant-settings.ts businessSettingsSchema 預設值；tenant_settings
 *     種子為空 jsonb = 全預設）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 台北時間 date（YYYY-MM-DD）hh:mm → UTC ISO（+08:00 固定無日光節約）。 */
function taipeiIso(date: string, hhmm: string): string {
  return new Date(Date.parse(`${date}T${hhmm}:00+08:00`)).toISOString();
}

/**
 * 未來 ≥baseDays 天的第一個週三（YYYY-MM-DD）。available-slots 的 weekday 以
 * 日期字串本身的星期計（route 用 Date.UTC(y,mo-1,d).getUTCDay()），與這裡的
 * getUTCDay 一致。週三 ≠ 預設公休日（週日），必為營業日。
 */
function farFutureWednesday(baseDays: number): string {
  const d = new Date(Date.now() + baseDays * DAY_MS);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let farFutureCounter = 0;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

async function insertCustomer(name: string, points = 0): Promise<string> {
  const id = randomUUID();
  const { error } = await admin
    .from('customers')
    .insert({ id, tenant_id: SHOP_A.id, name, phone: '', points, active: true });
  expect(error).toBeNull();
  return id;
}

async function deleteCustomer(id: string): Promise<void> {
  const { error } = await admin.from('customers').delete().eq('id', id);
  expect(error).toBeNull();
}

/** 未來很遠（+320 天起）、彼此不重疊的時段。 */
function farFutureSlot(): { startAt: string; endAt: string } {
  farFutureCounter += 1;
  const start = new Date(Date.now() + 320 * DAY_MS + farFutureCounter * 2 * HOUR_MS);
  const end = new Date(start.getTime() + HOUR_MS);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

/** service role 直插 booking（前置資料；staff 預設 null 避開排除約束）。 */
async function insertBooking(params: {
  customerId: string;
  status: string;
  finalPrice?: number;
  staffId?: string | null;
  startAt?: string;
  endAt?: string;
}): Promise<string> {
  const id = randomUUID();
  const slot = params.startAt && params.endAt
    ? { startAt: params.startAt, endAt: params.endAt }
    : farFutureSlot();
  const price = params.finalPrice ?? 800;
  const { error } = await admin.from('bookings').insert({
    id,
    tenant_id: SHOP_A.id,
    booking_no: `TESTB1${uniqueSuffix()}`,
    customer_id: params.customerId,
    service_id: SHOP_A.serviceA1,
    staff_id: params.staffId ?? null,
    start_at: slot.startAt,
    end_at: slot.endAt,
    duration_minutes: 60,
    price: 800,
    final_price: price,
    status: params.status,
    payment_status: 'UNPAID',
    source: 'MANUAL',
  });
  expect(error).toBeNull();
  return id;
}

async function deleteBooking(id: string): Promise<void> {
  const { error } = await admin.from('bookings').delete().eq('id', id);
  expect(error).toBeNull();
}

describe('POST /api/bookings 手動建立（04 §B-1）', () => {
  let customerId: string;
  beforeAll(async () => {
    customerId = await insertCustomer('B1 建立預約專屬顧客');
  });
  afterAll(async () => {
    await deleteCustomer(customerId);
  });

  it('成功：回 id；booking_no B+yymmdd+4 碼；endAt=start+duration；price 取服務價', async () => {
    const { startAt } = farFutureSlot();
    const res = await ownerA.post('/api/bookings', {
      customerId,
      serviceId: SHOP_A.serviceA1,
      staffId: SHOP_A.staffA1,
      startAt,
      note: 'B1 整合測試',
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ id: string }>(res);
    expect(body.success).toBe(true);
    expect(typeof body.data?.id).toBe('string');
    const bookingId = body.data!.id;
    try {
      const { data, error } = await admin
        .from('bookings')
        .select('booking_no, start_at, end_at, duration_minutes, price, final_price, status')
        .eq('id', bookingId)
        .single();
      expect(error).toBeNull();
      const row = data as any;
      // 'B' + yymmdd + 4 位流水（04 §B-1）
      expect(row.booking_no).toMatch(/^B\d{6}\d{4}$/);
      // endAt = start + service.duration（serviceA1 = 60 分）
      expect(new Date(row.start_at).toISOString()).toBe(new Date(startAt).toISOString());
      expect(new Date(row.end_at).getTime() - new Date(row.start_at).getTime()).toBe(60 * 60 * 1000);
      expect(row.duration_minutes).toBe(60);
      expect(Number(row.price)).toBe(800);
      expect(Number(row.final_price)).toBe(800);
      expect(row.status).toBe('PENDING');
    } finally {
      await deleteBooking(bookingId);
    }
  });

  it('同員工同時段第二筆 → 409「該時段已有預約」（DB 排除約束 23P01）', async () => {
    const { startAt } = farFutureSlot();
    const payload = {
      customerId,
      serviceId: SHOP_A.serviceA1,
      staffId: SHOP_A.staffA1,
      startAt,
    };
    const first = await ownerA.post('/api/bookings', payload);
    expect(first.status).toBe(200);
    const firstId = (await readJson<{ id: string }>(first)).data!.id;
    try {
      const second = await ownerA.post('/api/bookings', payload);
      expect(second.status).toBe(409);
      const body = await readJson(second);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
      expect(body.message).toBe('該時段已有預約');
    } finally {
      await deleteBooking(firstId);
    }
  });
});

describe('POST /api/bookings/:id/apply-points（04 §B-1：1 點 = 1 元）', () => {
  it('點數不足 → 409 POINTS_001，final_price 與顧客點數皆不變', async () => {
    const customerId = await insertCustomer('B1 點數不足顧客', 5);
    const bookingId = await insertBooking({ customerId, status: 'PENDING', finalPrice: 800 });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 100 });
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('POINTS_001');

      const { data: b } = await admin.from('bookings').select('final_price').eq('id', bookingId).single();
      expect(Number((b as any).final_price)).toBe(800);
      const { data: c } = await admin.from('customers').select('points').eq('id', customerId).single();
      expect((c as any).points).toBe(5);
    } finally {
      await deleteBooking(bookingId);
      await deleteCustomer(customerId);
    }
  });

  it('成功折抵：final_price -= points，扣點並寫 REDEEM_BOOKING 負 delta log', async () => {
    const customerId = await insertCustomer('B1 折抵成功顧客', 100);
    const bookingId = await insertBooking({ customerId, status: 'PENDING', finalPrice: 800 });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/apply-points`, { points: 40 });
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);

      const { data: b } = await admin.from('bookings').select('final_price').eq('id', bookingId).single();
      expect(Number((b as any).final_price)).toBe(760); // 800 - 40（1 點 = 1 元）

      const { data: c } = await admin.from('customers').select('points').eq('id', customerId).single();
      expect((c as any).points).toBe(60);

      const { data: logs, error: lErr } = await admin
        .from('customer_point_logs')
        .select('delta, reason, points_after')
        .eq('customer_id', customerId);
      expect(lErr).toBeNull();
      expect(logs).toHaveLength(1);
      expect((logs as any[])[0].delta).toBe(-40);
      expect((logs as any[])[0].reason).toBe('REDEEM_BOOKING');
      expect((logs as any[])[0].points_after).toBe(60);
    } finally {
      await deleteBooking(bookingId);
      await deleteCustomer(customerId); // customer_point_logs FK on delete cascade
    }
  });
});

describe('POST /api/bookings/:id/revert-complete（04 §A-2 狀態機：僅 COMPLETED→PENDING）', () => {
  it('非 COMPLETED（PENDING）→ 409 REQ_003，狀態不變', async () => {
    const customerId = await insertCustomer('B1 revert 測試顧客');
    const bookingId = await insertBooking({ customerId, status: 'PENDING' });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/revert-complete`);
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
      const { data } = await admin.from('bookings').select('status').eq('id', bookingId).single();
      expect((data as any).status).toBe('PENDING');
    } finally {
      await deleteBooking(bookingId);
      await deleteCustomer(customerId);
    }
  });
});

describe('GET /api/bookings/available-slots + block-times（04 §B-1）', () => {
  type Slot = { start: string; end: string; staffIds: string[] };

  it('基本形狀：slots 陣列；被既有 booking 佔的窗不含該員工、未佔的窗含', async () => {
    const dateW = farFutureWednesday(340);
    const customerId = await insertCustomer('B1 slots 測試顧客');
    // staffA1 於當日台北 10:00–11:00 已有 CONFIRMED 預約
    const bookingId = await insertBooking({
      customerId,
      status: 'CONFIRMED',
      staffId: SHOP_A.staffA1,
      startAt: taipeiIso(dateW, '10:00'),
      endAt: taipeiIso(dateW, '11:00'),
    });
    try {
      const res = await ownerA.get(
        `/api/bookings/available-slots?serviceId=${SHOP_A.serviceA1}&date=${dateW}`,
      );
      expect(res.status).toBe(200);
      const body = await readJson<{ slots: Slot[] }>(res);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data?.slots)).toBe(true);
      expect(body.data!.slots.length).toBeGreaterThan(0);
      for (const s of body.data!.slots) {
        expect(typeof s.start).toBe('string');
        expect(typeof s.end).toBe('string');
        expect(Array.isArray(s.staffIds)).toBe(true);
      }

      // 10:00–11:00 的窗：staffA1 被佔用不可出現；staffA2 空檔應在
      const at10 = body.data!.slots.find((s) => s.start === taipeiIso(dateW, '10:00'));
      expect(at10).toBeDefined();
      expect(at10!.staffIds).not.toContain(SHOP_A.staffA1);
      expect(at10!.staffIds).toContain(SHOP_A.staffA2);

      // 09:00–10:00 不與該預約重疊：兩位員工都在
      const at9 = body.data!.slots.find((s) => s.start === taipeiIso(dateW, '09:00'));
      expect(at9).toBeDefined();
      expect(at9!.staffIds).toContain(SHOP_A.staffA1);
      expect(at9!.staffIds).toContain(SHOP_A.staffA2);
    } finally {
      await deleteBooking(bookingId);
      await deleteCustomer(customerId);
    }
  });

  it('POST /api/block-times（全店）後該時段 slots 消失；DELETE 後恢復', async () => {
    // 用另一個週三，與上一個測試完全脫鉤
    const dateW2 = farFutureWednesday(360);
    const blockStart = taipeiIso(dateW2, '14:00');
    const blockEnd = taipeiIso(dateW2, '15:30');
    const overlapsBlock = (s: Slot) => s.start < blockEnd && s.end > blockStart;

    // 前置：封鎖前 14:00 起的窗存在
    const before = await ownerA.get(
      `/api/bookings/available-slots?serviceId=${SHOP_A.serviceA1}&date=${dateW2}`,
    );
    expect(before.status).toBe(200);
    const beforeSlots = (await readJson<{ slots: Slot[] }>(before)).data!.slots;
    expect(beforeSlots.some((s) => s.start === taipeiIso(dateW2, '14:00'))).toBe(true);

    const created = await ownerA.post('/api/block-times', {
      startAt: blockStart,
      endAt: blockEnd,
      reason: `B1 整合測試封鎖-${uniqueSuffix()}`,
    });
    expect(created.status).toBe(200);
    const createdBody = await readJson<{ id: string }>(created);
    expect(createdBody.success).toBe(true);
    expect(typeof createdBody.data?.id).toBe('string');
    const blockId = createdBody.data!.id;

    try {
      const after = await ownerA.get(
        `/api/bookings/available-slots?serviceId=${SHOP_A.serviceA1}&date=${dateW2}`,
      );
      expect(after.status).toBe(200);
      const afterSlots = (await readJson<{ slots: Slot[] }>(after)).data!.slots;
      // 全店封鎖 → 與封鎖窗重疊的時段全部消失
      expect(afterSlots.filter(overlapsBlock)).toEqual([]);
      // 不重疊的時段仍在（例：09:00）
      expect(afterSlots.some((s) => s.start === taipeiIso(dateW2, '09:00'))).toBe(true);
    } finally {
      const del = await ownerA.delete(`/api/block-times/${blockId}`);
      expect(del.status).toBe(200);
      expect((await readJson(del)).success).toBe(true);
    }

    // 刪除後時段恢復
    const restored = await ownerA.get(
      `/api/bookings/available-slots?serviceId=${SHOP_A.serviceA1}&date=${dateW2}`,
    );
    const restoredSlots = (await readJson<{ slots: Slot[] }>(restored)).data!.slots;
    expect(restoredSlots.some((s) => s.start === taipeiIso(dateW2, '14:00'))).toBe(true);
  });
});
