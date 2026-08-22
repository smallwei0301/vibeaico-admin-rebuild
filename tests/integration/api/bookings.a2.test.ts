/**
 * 預約 API 整合測試 — 12 分冊 §4「Phase 3（核心 API）」矩陣：
 *   「bookings 列表：狀態/關鍵字/員工/日期四種篩選、分頁 totalElements 正確」
 *   「complete 累點：pointEarnEnabled + rate 換算 + rounding 三模式各一例；
 *    關閉時不加點」
 * 端點行為規格見 docs/integration/04-API-CONTRACTS.md §A-2、§0 參考實作。
 *
 * ⚠️ TDD 紅燈說明：撰寫本檔當下 `src/app/api/bookings/**` 完全未實作（Phase 3
 * 施工中），全部紅燈——誠實的「先寫測試」狀態，不得為轉綠放寬斷言（12 §2.4）。
 *
 * 清理紀律（12 §2.3「自建資料一律清理」+ 本檔對 reports.a5 的義務）：
 *   - reports.a5.test.ts 用 seed 的 4 筆 bookings（全部掛 customerA1／staffA1）
 *     手算 dashboard/staff-performance 的期望值，若本檔留下任何一筆多餘的
 *     bookings 或 customers，那些手算值就會被污染而變紅。因此本檔**完全不
 *     使用 SHOP_A.customerA1/A2/A3**，一律另建專屬的測試顧客，且每筆自建的
 *     booking 用完立刻刪除（不留到 afterAll 才批次清）。
 *   - 自建 booking 一律 `staff_id: null`（不指定服務人員）：02 分冊的
 *     `x_bookings_overlap` 排除約束只在 `staff_id is not null` 時生效，這樣
 *     可以完全避開跟 seed 4 筆（都掛 staffA1、時段在 seed 執行當下 ±6 小時內）
 *     的重疊檢查，不必精算時段。
 *   - 自建 booking 的 `start_at` 一律取「未來很遠」（+300 天起跳，每筆再加
 *     不同流水位移避免撞號/撞時段），確保不會被 reports.a5 的
 *     `todayBookings`／`monthRevenue`（本月）誤算進去。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { Booking, Paged } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

/** 專屬測試顧客（不是 SHOP_A.customerA1/A2/A3，見檔頭清理紀律）。 */
async function insertCustomer(name: string): Promise<string> {
  const id = randomUUID();
  const { error } = await admin
    .from('customers')
    .insert({ id, tenant_id: SHOP_A.id, name, phone: '', points: 0, active: true });
  expect(error).toBeNull();
  return id;
}

async function deleteCustomer(id: string): Promise<void> {
  const { error } = await admin.from('customers').delete().eq('id', id);
  expect(error).toBeNull();
}

/** 未來很遠、彼此不重疊的時段（見檔頭「清理紀律」）。 */
function farFutureSlot(): { startAt: string; endAt: string } {
  farFutureCounter += 1;
  const start = new Date(Date.now() + 300 * DAY_MS + farFutureCounter * HOUR_MS);
  const end = new Date(start.getTime() + HOUR_MS);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

async function insertBooking(params: {
  customerId: string;
  status: Booking['status'];
  finalPrice?: number;
}): Promise<string> {
  const id = randomUUID();
  const { startAt, endAt } = farFutureSlot();
  const price = params.finalPrice ?? 800;
  const { error } = await admin.from('bookings').insert({
    id,
    tenant_id: SHOP_A.id,
    booking_no: `TESTBK${uniqueSuffix()}`,
    customer_id: params.customerId,
    service_id: SHOP_A.serviceA1,
    staff_id: null,
    start_at: startAt,
    end_at: endAt,
    duration_minutes: 60,
    price,
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

async function dbBookingStatus(id: string): Promise<{ status: string; cancelReason: string | null }> {
  const { data, error } = await admin.from('bookings').select('status, cancel_reason').eq('id', id).single();
  expect(error).toBeNull();
  return { status: (data as any).status, cancelReason: (data as any).cancel_reason };
}

describe('GET /api/bookings 列表篩選與分頁（04 §A-2、§0 參考實作，僅用 seed 4 筆）', () => {
  it('status=PENDING → 只回 seed 的 bookingPending，totalElements=1', async () => {
    const res = await ownerA.get('/api/bookings?status=PENDING');
    expect(res.status).toBe(200);
    const body = await readJson<Paged<Booking>>(res);
    expect(body.success).toBe(true);
    expect(body.data!.totalElements).toBe(1);
    expect(body.data!.content).toHaveLength(1);
    expect(body.data!.content[0].id).toBe(SHOP_A.bookingPending);
    expect(body.data!.content[0].status).toBe('PENDING');
  });

  it('keyword=顧客 A1 電話尾碼（0001）→ seed 4 筆都是 customerA1，totalElements=4', async () => {
    const res = await ownerA.get('/api/bookings?keyword=0001');
    expect(res.status).toBe(200);
    const body = await readJson<Paged<Booking>>(res);
    expect(body.success).toBe(true);
    expect(body.data!.totalElements).toBe(4);
    expect(body.data!.content).toHaveLength(4);
    for (const b of body.data!.content) {
      expect(b.customerPhone).toBe('0911000001');
    }
  });

  it('staffId=staffA1 → seed 4 筆都掛 staffA1，totalElements=4', async () => {
    const res = await ownerA.get(`/api/bookings?staffId=${SHOP_A.staffA1}`);
    expect(res.status).toBe(200);
    const body = await readJson<Paged<Booking>>(res);
    expect(body.success).toBe(true);
    expect(body.data!.totalElements).toBe(4);
    for (const b of body.data!.content) {
      expect(b.staffId).toBe(SHOP_A.staffA1);
    }
  });

  it('from/to 窄窗只框住 bookingCompleted（seed：now-2h ~ now-1h）→ totalElements=1', async () => {
    // ⚠️ 已知限制（同 reports.a5 的時間手算限制）：seed 的時間是相對 seed 執行
    // 當下的 now，這裡窗口留了 1 小時緩衝（against bookingConfirmed 的 +3h 與
    // 「現在」本身），只要本測試在 seed 後 30 分鐘內執行就不受影響。
    const from = new Date(Date.now() - 3 * HOUR_MS).toISOString();
    const to = new Date(Date.now() - 0.5 * HOUR_MS).toISOString();
    const res = await ownerA.get(`/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(res.status).toBe(200);
    const body = await readJson<Paged<Booking>>(res);
    expect(body.success).toBe(true);
    expect(body.data!.totalElements).toBe(1);
    expect(body.data!.content[0].id).toBe(SHOP_A.bookingCompleted);
  });

  it('size=2 分頁 → totalPages=2、content.length=2（seed 共 4 筆）', async () => {
    const page0 = await ownerA.get('/api/bookings?size=2&page=0');
    expect(page0.status).toBe(200);
    const body0 = await readJson<Paged<Booking>>(page0);
    expect(body0.success).toBe(true);
    expect(body0.data!.totalElements).toBe(4);
    expect(body0.data!.totalPages).toBe(2);
    expect(body0.data!.content).toHaveLength(2);
    expect(body0.data!.number).toBe(0);
    expect(body0.data!.size).toBe(2);

    const page1 = await ownerA.get('/api/bookings?size=2&page=1');
    const body1 = await readJson<Paged<Booking>>(page1);
    expect(body1.data!.content).toHaveLength(2);
    expect(body1.data!.number).toBe(1);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/bookings`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('POST /api/bookings/:id/confirm（04 §0 參考實作、12 §3 骨架）', () => {
  let customerId: string;

  beforeAll(async () => {
    customerId = await insertCustomer('confirm 測試專屬顧客');
  });
  afterAll(async () => {
    await deleteCustomer(customerId);
  });

  it('PENDING → CONFIRMED；再 confirm 一次 → 409 REQ_003', async () => {
    const bookingId = await insertBooking({ customerId, status: 'PENDING' });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/confirm`);
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);
      expect((await dbBookingStatus(bookingId)).status).toBe('CONFIRMED');

      const again = await ownerA.post(`/api/bookings/${bookingId}/confirm`);
      expect(again.status).toBe(409);
      expect((await readJson(again)).code).toBe('REQ_003');
    } finally {
      await deleteBooking(bookingId);
    }
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/bookings/${SHOP_A.bookingPending}/confirm`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('B 店帳號對 A 店 booking confirm → 409 REQ_003（04 §0 參考實作：maybeSingle 帶 .eq(tenant_id) 找不到列時回 409 CONFLICT，不是 404——見檔內註解）', async () => {
    // 04 分冊 §0 給的「參考實作」樣板（confirm route）用
    // `.eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'PENDING').maybeSingle()`
    // 一次過濾「不存在／不屬於本租戶／狀態不符」三種情況，`!data` 一律丟
    // `ApiHttpError(409, …, ERR.CONFLICT)`（REQ_003）。跨租戶查詢在這個樣板下
    // 沒有走到「id 完全查無」的獨立分支，因此照樣板判定正確碼是 409 REQ_003，
    // 而不是 04 §0 規約 7 講的「一般查詢型端點」404 REQ_002（那條規則描述的是
    // 查詢/取值端點，狀態動作端點以 §0 給的樣板為準）。
    const bookingId = await insertBooking({ customerId, status: 'PENDING' });
    try {
      const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
      const res = await ownerB.post(`/api/bookings/${bookingId}/confirm`);
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
      // 且沒有真的被改到狀態
      expect((await dbBookingStatus(bookingId)).status).toBe('PENDING');
    } finally {
      await deleteBooking(bookingId);
    }
  });
});

describe('POST /api/bookings/:id/cancel（04 §A-2）', () => {
  let customerId: string;
  beforeAll(async () => {
    customerId = await insertCustomer('cancel 測試專屬顧客');
  });
  afterAll(async () => {
    await deleteCustomer(customerId);
  });

  it('PENDING → CANCELLED，寫入 cancel_reason', async () => {
    const bookingId = await insertBooking({ customerId, status: 'PENDING' });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/cancel`, { reason: '顧客改期（測試）' });
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);
      const row = await dbBookingStatus(bookingId);
      expect(row.status).toBe('CANCELLED');
      expect(row.cancelReason).toBe('顧客改期（測試）');
    } finally {
      await deleteBooking(bookingId);
    }
  });
});

describe('POST /api/bookings/:id/no-show（04 §A-2 狀態機：僅 CONFIRMED 可轉）', () => {
  let customerId: string;
  beforeAll(async () => {
    customerId = await insertCustomer('no-show 測試專屬顧客');
  });
  afterAll(async () => {
    await deleteCustomer(customerId);
  });

  it('PENDING → no-show → 409 REQ_003（狀態機不允許）', async () => {
    const bookingId = await insertBooking({ customerId, status: 'PENDING' });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/no-show`);
      expect(res.status).toBe(409);
      expect((await readJson(res)).code).toBe('REQ_003');
      expect((await dbBookingStatus(bookingId)).status).toBe('PENDING');
    } finally {
      await deleteBooking(bookingId);
    }
  });

  it('CONFIRMED → NO_SHOW → 200', async () => {
    const bookingId = await insertBooking({ customerId, status: 'CONFIRMED' });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/no-show`);
      expect(res.status).toBe(200);
      expect((await dbBookingStatus(bookingId)).status).toBe('NO_SHOW');
    } finally {
      await deleteBooking(bookingId);
    }
  });
});

describe('POST /api/bookings/:id/complete — 累點三模式 + 關閉對照（04 §A-2，12 §4 指定案例）', () => {
  // 三種 rounding 的手算範例，直接沿用 src/app/tenant/settings/page.tsx 的
  // UI 說明文案（src/i18n/zh-TW/pages/settings.ts roundingFloorExample 等）：
  //   FLOOR：消費 NT$95、比例 10 → 9 點（95/10=9.5，捨去）
  //   ROUND：消費 NT$95、比例 10 → 10 點（9.5 四捨五入）
  //   CEIL ：消費 NT$91、比例 10 → 10 點（9.1 無條件進位）
  let customerId: string;

  beforeAll(async () => {
    customerId = await insertCustomer('累點測試專屬顧客');
  });

  afterAll(async () => {
    await deleteCustomer(customerId);
    // 把 tenant_settings.points 重設回種子的初始空 jsonb（= schema 預設值：
    // pointEarnEnabled=false, pointEarnRate=100, rounding=FLOOR），避免影響
    // settings.a1 / reports.a5 對這個租戶設定值的任何潛在假設。
    const { error } = await admin.from('tenant_settings').update({ points: {} }).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
  });

  async function currentPoints(): Promise<number> {
    const { data, error } = await admin.from('customers').select('points').eq('id', customerId).single();
    expect(error).toBeNull();
    return (data as any).points as number;
  }

  async function pointLogCount(): Promise<number> {
    const { count, error } = await admin
      .from('customer_point_logs')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId);
    expect(error).toBeNull();
    return count ?? 0;
  }

  async function latestPointLog(): Promise<{ delta: number; pointsAfter: number; reason: string }> {
    const { data, error } = await admin
      .from('customer_point_logs')
      .select('delta, points_after, reason')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(error).toBeNull();
    return { delta: (data as any).delta, pointsAfter: (data as any).points_after, reason: (data as any).reason };
  }

  it.each([
    { rounding: 'FLOOR' as const, finalPrice: 95, expectedDelta: 9 },
    { rounding: 'ROUND' as const, finalPrice: 95, expectedDelta: 10 },
    { rounding: 'CEIL' as const, finalPrice: 91, expectedDelta: 10 },
  ])('rounding=$rounding：消費 $finalPrice、比例 10 → +$expectedDelta 點，寫 1 筆 customer_point_logs', async ({ rounding, finalPrice, expectedDelta }) => {
    const putRes = await ownerA.put('/api/settings', {
      points: { pointEarnEnabled: true, pointEarnRate: 10, rounding },
    });
    expect(putRes.status).toBe(200);

    const before = await currentPoints();
    const logCountBefore = await pointLogCount();
    const bookingId = await insertBooking({ customerId, status: 'CONFIRMED', finalPrice });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/complete`);
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);
      expect((await dbBookingStatus(bookingId)).status).toBe('COMPLETED');

      const after = await currentPoints();
      expect(after - before).toBe(expectedDelta);

      const logCountAfter = await pointLogCount();
      expect(logCountAfter - logCountBefore).toBe(1);

      const log = await latestPointLog();
      expect(log.delta).toBe(expectedDelta);
      expect(log.pointsAfter).toBe(after);
      // 02 分冊 §0004 customer_point_logs 欄位註解明列此情境的 reason 值。
      expect(log.reason).toBe('EARN_BOOKING');
    } finally {
      await deleteBooking(bookingId);
    }
  });

  it('關閉 pointEarnEnabled → complete 後 points 不變、不寫 log', async () => {
    const putRes = await ownerA.put('/api/settings', {
      points: { pointEarnEnabled: false, pointEarnRate: 10, rounding: 'FLOOR' },
    });
    expect(putRes.status).toBe(200);

    const before = await currentPoints();
    const logCountBefore = await pointLogCount();
    const bookingId = await insertBooking({ customerId, status: 'CONFIRMED', finalPrice: 95 });
    try {
      const res = await ownerA.post(`/api/bookings/${bookingId}/complete`);
      expect(res.status).toBe(200);

      const after = await currentPoints();
      expect(after).toBe(before);
      const logCountAfter = await pointLogCount();
      expect(logCountAfter).toBe(logCountBefore);
    } finally {
      await deleteBooking(bookingId);
    }
  });
});
