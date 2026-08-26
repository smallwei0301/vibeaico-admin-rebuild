/**
 * 「假欄位混在真資料列裡」的欄位落地 — issue #35 / migration 0022
 * -----------------------------------------------------------------------------
 * 三頁原本用頁內常數（`BOOKING_EXTRAS_*` / `COUPON_EXTRAS_*` / `LEVEL_EXTRAS_*`）
 * 餵一部分欄位。本檔驗的是接線後那條鏈的中後段：**DB 寫入 X → 端點回 X**
 * （頁面拿到 X 那一段由 `tests/unit/page-local-field-lock.35.test.ts` 的靜態鎖
 * 與型別保證：`mapBooking`/`mapCoupon`/`mapMembershipLevel` 的輸出就是頁面 state
 * 的型別）。
 *
 * 欄位清單（migration 0022）：
 *   bookings.coupon_discount / points_redeemed、bookings_view.customer_points
 *   coupons.min_order_amount / max_discount_amount / gift_item /
 *     limit_per_customer / private_mode（＋ lastRedeemedCode 由 instances 即時算）
 *   membership_levels.description / active / is_default
 *
 * ⚠️ 特別釘住「null ≠ 0」：沒有折抵紀錄的預約必須回 `null`，不是 0。
 *    0 是「折抵了 0 元」，是一個有意義的答案；拿它當「還不知道」會誤導店家。
 *
 * 清理紀律：本檔自建的 coupons / coupon_instances / membership_levels 一律在
 * finally 以 service role 刪除；改動到的 seed 資料（bookings 的折抵欄位、
 * customers.points、customers.membership_level_id）在 finally 還原成種子值。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

type BookingRow = {
  id: string;
  couponDiscount: number | null;
  pointsRedeemed: number | null;
  customerPoints: number | null;
  finalPrice: number;
};

type CouponRow = {
  id: string;
  minOrderAmount: number | null;
  maxDiscountAmount: number | null;
  giftItem: string;
  limitPerCustomer: number | null;
  privateMode: boolean;
  lastRedeemedCode: string | null;
};

type LevelRow = {
  id: string;
  description: string;
  active: boolean;
  isDefault: boolean;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

/** GET /api/bookings 的整頁掃描（seed 只有 4 筆，size=100 足夠）後取指定那一筆。 */
async function fetchBooking(id: string): Promise<BookingRow> {
  const res = await ownerA.get('/api/bookings?size=100');
  expect(res.status).toBe(200);
  const body = await readJson<{ content: BookingRow[] }>(res);
  expect(body.success).toBe(true);
  const row = body.data!.content.find((b) => b.id === id);
  expect(row, `GET /api/bookings 找不到 ${id}`).toBeDefined();
  return row!;
}

async function fetchCoupon(id: string): Promise<CouponRow> {
  const res = await ownerA.get('/api/coupons');
  expect(res.status).toBe(200);
  const body = await readJson<CouponRow[]>(res);
  expect(body.success).toBe(true);
  const row = body.data!.find((c) => c.id === id);
  expect(row, `GET /api/coupons 找不到 ${id}`).toBeDefined();
  return row!;
}

async function fetchLevel(id: string): Promise<LevelRow> {
  const res = await ownerA.get('/api/membership-levels');
  expect(res.status).toBe(200);
  const body = await readJson<LevelRow[]>(res);
  expect(body.success).toBe(true);
  const row = body.data!.find((l) => l.id === id);
  expect(row, `GET /api/membership-levels 找不到 ${id}`).toBeDefined();
  return row!;
}

/* ========================================================================== */
/* 預約：coupon_discount / points_redeemed / customer_points                   */
/* ========================================================================== */

describe('GET /api/bookings：折抵欄位與顧客點數（0022，issue #35）', () => {
  it('種子狀態沒有折抵紀錄 → couponDiscount / pointsRedeemed 回 null（**不是 0**）', async () => {
    const row = await fetchBooking(SHOP_A.bookingPending);
    expect(row.couponDiscount).toBeNull();
    expect(row.pointsRedeemed).toBeNull();
  });

  it('DB 寫入 coupon_discount=150 / points_redeemed=50 → 端點回同一組數字', async () => {
    try {
      const { error } = await admin.from('bookings')
        .update({ coupon_discount: 150, points_redeemed: 50 })
        .eq('id', SHOP_A.bookingConfirmed);
      expect(error).toBeNull();

      const row = await fetchBooking(SHOP_A.bookingConfirmed);
      expect(row.couponDiscount).toBe(150);
      expect(row.pointsRedeemed).toBe(50);
    } finally {
      await admin.from('bookings')
        .update({ coupon_discount: null, points_redeemed: null })
        .eq('id', SHOP_A.bookingConfirmed);
    }
  });

  it('DB 寫入 coupon_discount=0 → 端點回 0（0 與「無紀錄」不可互相冒充）', async () => {
    try {
      const { error } = await admin.from('bookings')
        .update({ coupon_discount: 0 }).eq('id', SHOP_A.bookingConfirmed);
      expect(error).toBeNull();
      expect((await fetchBooking(SHOP_A.bookingConfirmed)).couponDiscount).toBe(0);
    } finally {
      await admin.from('bookings').update({ coupon_discount: null }).eq('id', SHOP_A.bookingConfirmed);
    }
  });

  it('DB 寫入 customers.points=777 → 端點的 customerPoints 回 777（bookings_view.customer_points）', async () => {
    const { data: before } = await admin.from('customers')
      .select('points').eq('id', SHOP_A.customerA1).single();
    const original = (before as any)?.points ?? 0;
    try {
      const { error } = await admin.from('customers')
        .update({ points: 777 }).eq('id', SHOP_A.customerA1);
      expect(error).toBeNull();

      const res = await ownerA.get('/api/bookings?size=100');
      const body = await readJson<{ content: (BookingRow & { customerId: string })[] }>(res);
      const rows = body.data!.content.filter((b) => b.customerId === SHOP_A.customerA1);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.customerPoints).toBe(777);
    } finally {
      await admin.from('customers').update({ points: original }).eq('id', SHOP_A.customerA1);
    }
  });
});

describe('POST /api/bookings/:id/apply-coupon：回 couponDiscount 且累計進 DB（issue #35）', () => {
  it('AMOUNT 100 的票券套在 PENDING 預約上 → 回應含 couponDiscount=100，DB 與端點都看得到', async () => {
    const couponId = randomUUID();
    const instanceId = randomUUID();
    const code = `T35${Date.now().toString(36).slice(-5).toUpperCase()}`;

    const { data: b0 } = await admin.from('bookings')
      .select('final_price').eq('id', SHOP_A.bookingPending).single();
    const originalFinal = Number((b0 as any).final_price);

    try {
      expect((await admin.from('coupons').insert({
        id: couponId, tenant_id: SHOP_A.id, name: '#35 折抵測試券',
        discount_type: 'AMOUNT', discount_value: 100, total_quantity: 0, status: 'PUBLISHED',
      })).error).toBeNull();
      expect((await admin.from('coupon_instances').insert({
        id: instanceId, tenant_id: SHOP_A.id, coupon_id: couponId,
        customer_id: SHOP_A.customerA1, code,
      })).error).toBeNull();

      const res = await ownerA.post(`/api/bookings/${SHOP_A.bookingPending}/apply-coupon`, { code });
      expect(res.status).toBe(200);
      const body = await readJson<{ finalPrice: number; couponDiscount: number }>(res);
      expect(body.success).toBe(true);
      expect(body.data!.couponDiscount).toBe(100);

      const { data: after } = await admin.from('bookings')
        .select('coupon_discount').eq('id', SHOP_A.bookingPending).single();
      expect(Number((after as any).coupon_discount)).toBe(100);

      expect((await fetchBooking(SHOP_A.bookingPending)).couponDiscount).toBe(100);
    } finally {
      await admin.from('coupon_instances').delete().eq('coupon_id', couponId);
      await admin.from('coupons').delete().eq('id', couponId);
      await admin.from('bookings')
        .update({ final_price: originalFinal, coupon_discount: null, custom_fields: {} })
        .eq('id', SHOP_A.bookingPending);
    }
  });
});

describe('POST /api/bookings/:id/apply-points：折抵點數累計進 DB（issue #35）', () => {
  it('折抵 30 點 → bookings.points_redeemed=30，端點回 30', async () => {
    const { data: b0 } = await admin.from('bookings')
      .select('final_price').eq('id', SHOP_A.bookingConfirmed).single();
    const originalFinal = Number((b0 as any).final_price);
    const { data: c0 } = await admin.from('customers')
      .select('points').eq('id', SHOP_A.customerA1).single();
    const originalPoints = (c0 as any).points as number;

    try {
      // 先確保這筆預約的顧客有足夠點數（seed 不保證）
      const { data: booking } = await admin.from('bookings')
        .select('customer_id').eq('id', SHOP_A.bookingConfirmed).single();
      const customerId = (booking as any).customer_id as string;
      const { data: cur } = await admin.from('customers')
        .select('points').eq('id', customerId).single();
      const curPoints = (cur as any).points as number;
      expect((await admin.from('customers').update({ points: 500 }).eq('id', customerId)).error).toBeNull();

      const res = await ownerA.post(`/api/bookings/${SHOP_A.bookingConfirmed}/apply-points`, { points: 30 });
      expect(res.status).toBe(200);

      const { data: after } = await admin.from('bookings')
        .select('points_redeemed').eq('id', SHOP_A.bookingConfirmed).single();
      expect((after as any).points_redeemed).toBe(30);

      expect((await fetchBooking(SHOP_A.bookingConfirmed)).pointsRedeemed).toBe(30);

      await admin.from('customers').update({ points: curPoints }).eq('id', customerId);
    } finally {
      await admin.from('bookings')
        .update({ final_price: originalFinal, points_redeemed: null })
        .eq('id', SHOP_A.bookingConfirmed);
      await admin.from('customers').update({ points: originalPoints }).eq('id', SHOP_A.customerA1);
      await admin.from('customer_point_logs').delete()
        .eq('tenant_id', SHOP_A.id).eq('reason', 'REDEEM_BOOKING');
    }
  });
});

/* ========================================================================== */
/* 票券                                                                        */
/* ========================================================================== */

describe('票券的五個欄位：POST 寫入 → DB → GET 回同值（0022，issue #35）', () => {
  it('建立時帶門檻／上限／兌換項目／每人限領／私密 → 三處數字一致；PUT 改掉之後也一致', async () => {
    let couponId = '';
    try {
      const createRes = await ownerA.post('/api/coupons', {
        name: '#35 欄位落地測試券',
        discountType: 'AMOUNT',
        discountValue: 200,
        minOrderAmount: 1500,
        maxDiscountAmount: null,
        giftItem: '兌換一杯手沖',
        limitPerCustomer: 2,
        privateMode: true,
      });
      expect(createRes.status).toBe(200);
      couponId = (await readJson<{ id: string }>(createRes)).data!.id;

      // DB
      const { data: dbRow, error } = await admin.from('coupons')
        .select('min_order_amount, max_discount_amount, gift_item, limit_per_customer, private_mode')
        .eq('id', couponId).single();
      expect(error).toBeNull();
      expect(Number((dbRow as any).min_order_amount)).toBe(1500);
      expect((dbRow as any).max_discount_amount).toBeNull();
      expect((dbRow as any).gift_item).toBe('兌換一杯手沖');
      expect((dbRow as any).limit_per_customer).toBe(2);
      expect((dbRow as any).private_mode).toBe(true);

      // 端點
      const api = await fetchCoupon(couponId);
      expect(api.minOrderAmount).toBe(1500);
      expect(api.maxDiscountAmount).toBeNull();
      expect(api.giftItem).toBe('兌換一杯手沖');
      expect(api.limitPerCustomer).toBe(2);
      expect(api.privateMode).toBe(true);

      // PUT 改掉（含 null = 明確清空）
      const putRes = await ownerA.put(`/api/coupons/${couponId}`, {
        minOrderAmount: null, maxDiscountAmount: 300, giftItem: '',
        limitPerCustomer: 5, privateMode: false,
      });
      expect(putRes.status).toBe(200);

      const api2 = await fetchCoupon(couponId);
      expect(api2.minOrderAmount).toBeNull();
      expect(api2.maxDiscountAmount).toBe(300);
      expect(api2.giftItem).toBe('');
      expect(api2.limitPerCustomer).toBe(5);
      expect(api2.privateMode).toBe(false);
    } finally {
      if (couponId) {
        await admin.from('coupon_instances').delete().eq('coupon_id', couponId);
        await admin.from('coupons').delete().eq('id', couponId);
      }
    }
  });
});

describe('票券的 lastRedeemedCode 由 coupon_instances 即時算（issue #35）', () => {
  it('沒有已核銷實例 → null；核銷一張之後 → 回那一張的 code', async () => {
    const couponId = randomUUID();
    const instanceId = randomUUID();
    const code = `T35R${Date.now().toString(36).slice(-4).toUpperCase()}`;
    try {
      expect((await admin.from('coupons').insert({
        id: couponId, tenant_id: SHOP_A.id, name: '#35 還原代碼測試券',
        discount_type: 'AMOUNT', discount_value: 50, total_quantity: 0, status: 'PUBLISHED',
      })).error).toBeNull();
      expect((await admin.from('coupon_instances').insert({
        id: instanceId, tenant_id: SHOP_A.id, coupon_id: couponId,
        customer_id: SHOP_A.customerA1, code,
      })).error).toBeNull();

      expect((await fetchCoupon(couponId)).lastRedeemedCode).toBeNull();

      expect((await admin.from('coupon_instances')
        .update({ redeemed_at: new Date().toISOString() }).eq('id', instanceId)).error).toBeNull();

      expect((await fetchCoupon(couponId)).lastRedeemedCode).toBe(code);
    } finally {
      await admin.from('coupon_instances').delete().eq('coupon_id', couponId);
      await admin.from('coupons').delete().eq('id', couponId);
    }
  });
});

/* ========================================================================== */
/* 會員等級                                                                    */
/* ========================================================================== */

describe('會員等級的 description / active / isDefault（0022，issue #35）', () => {
  it('POST 帶三個欄位 → DB → GET 回同值；PUT 改 active=false 也一致', async () => {
    let levelId = '';
    try {
      const res = await ownerA.post('/api/membership-levels', {
        name: '#35 等級落地測試',
        thresholdSpent: 999999999,   // 高門檻：不會把種子顧客升上來
        description: '此等級的專屬權益說明',
        active: true,
        isDefault: false,
      });
      expect(res.status).toBe(200);
      levelId = (await readJson<{ id: string }>(res)).data!.id;

      const { data: dbRow, error } = await admin.from('membership_levels')
        .select('description, active, is_default').eq('id', levelId).single();
      expect(error).toBeNull();
      expect((dbRow as any).description).toBe('此等級的專屬權益說明');
      expect((dbRow as any).active).toBe(true);
      expect((dbRow as any).is_default).toBe(false);

      const api = await fetchLevel(levelId);
      expect(api).toMatchObject({
        description: '此等級的專屬權益說明', active: true, isDefault: false,
      });

      const putRes = await ownerA.put(`/api/membership-levels/${levelId}`, {
        description: '改過的說明', active: false,
      });
      expect(putRes.status).toBe(200);

      expect(await fetchLevel(levelId)).toMatchObject({
        description: '改過的說明', active: false, isDefault: false,
      });
    } finally {
      if (levelId) {
        await admin.from('customers').update({ membership_level_id: null }).eq('membership_level_id', levelId);
        await admin.from('membership_levels').delete().eq('id', levelId);
      }
    }
  });

  it('第二個等級設為預設 → 第一個的 is_default 被清掉（每租戶至多一個預設等級）', async () => {
    let idA = '';
    let idB = '';
    try {
      const resA = await ownerA.post('/api/membership-levels', {
        name: '#35 預設 A', thresholdSpent: 999999998, isDefault: true,
      });
      expect(resA.status).toBe(200);
      idA = (await readJson<{ id: string }>(resA)).data!.id;
      expect((await fetchLevel(idA)).isDefault).toBe(true);

      const resB = await ownerA.post('/api/membership-levels', {
        name: '#35 預設 B', thresholdSpent: 999999999, isDefault: true,
      });
      expect(resB.status).toBe(200);
      idB = (await readJson<{ id: string }>(resB)).data!.id;

      expect((await fetchLevel(idB)).isDefault).toBe(true);
      expect((await fetchLevel(idA)).isDefault).toBe(false);
    } finally {
      for (const id of [idA, idB]) {
        if (!id) continue;
        await admin.from('customers').update({ membership_level_id: null }).eq('membership_level_id', id);
        await admin.from('membership_levels').delete().eq('id', id);
      }
      await admin.from('customers').update({ membership_level_id: null }).eq('tenant_id', SHOP_A.id);
    }
  });
});
