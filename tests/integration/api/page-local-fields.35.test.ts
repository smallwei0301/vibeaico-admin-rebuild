/**
 * Issue #35 bounded slice：coupons / membership-levels 的真實欄位鏈路。
 *
 * 每個案例都驗證 DB → API；頁面 payload 由
 * tests/unit/page-local-field-lock.35.test.ts 的 static seam 鎖住。
 * 本檔需要 0015 已套用到 TEST 才能執行，施工階段不自行改 TEST。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

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

const readJson = async <T>(res: Response): Promise<Envelope<T>> => (await res.json()) as Envelope<T>;

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

async function fetchCoupon(id: string): Promise<CouponRow> {
  const res = await ownerA.get('/api/coupons');
  expect(res.status).toBe(200);
  const body = await readJson<CouponRow[]>(res);
  expect(body.success).toBe(true);
  const row = body.data?.find((coupon) => coupon.id === id);
  expect(row).toBeDefined();
  return row!;
}

async function fetchLevel(id: string): Promise<LevelRow> {
  const res = await ownerA.get('/api/membership-levels');
  expect(res.status).toBe(200);
  const body = await readJson<LevelRow[]>(res);
  expect(body.success).toBe(true);
  const row = body.data?.find((level) => level.id === id);
  expect(row).toBeDefined();
  return row!;
}

describe('coupons：欄位持久化與核銷資料', () => {
  it('POST / PUT 寫入五個欄位後，DB 與 GET /api/coupons 回傳相同值', async () => {
    let couponId: string | undefined;
    try {
      const create = await ownerA.post('/api/coupons', {
        name: '#35 欄位測試券',
        discountType: 'AMOUNT',
        discountValue: 200,
        minOrderAmount: 1500,
        maxDiscountAmount: null,
        giftItem: '手沖咖啡',
        limitPerCustomer: 2,
        privateMode: true,
      });
      expect(create.status).toBe(200);
      const created = await readJson<{ id: string }>(create);
      expect(created.success).toBe(true);
      const id = created.data!.id;
      couponId = id;

      const { data: dbRow, error: dbError } = await admin.from('coupons')
        .select('min_order_amount, max_discount_amount, gift_item, limit_per_customer, private_mode')
        .eq('id', id).single();
      expect(dbError).toBeNull();
      expect(dbRow).toEqual({
        min_order_amount: 1500,
        max_discount_amount: null,
        gift_item: '手沖咖啡',
        limit_per_customer: 2,
        private_mode: true,
      });
      expect(await fetchCoupon(id)).toMatchObject({
        minOrderAmount: 1500, maxDiscountAmount: null, giftItem: '手沖咖啡',
        limitPerCustomer: 2, privateMode: true,
      });

      const update = await ownerA.put(`/api/coupons/${id}`, {
        minOrderAmount: null,
        maxDiscountAmount: 300,
        giftItem: '',
        limitPerCustomer: 5,
        privateMode: false,
      });
      expect(update.status).toBe(200);
      expect(await fetchCoupon(id)).toMatchObject({
        minOrderAmount: null, maxDiscountAmount: 300, giftItem: '',
        limitPerCustomer: 5, privateMode: false,
      });
    } finally {
      if (couponId) {
        await admin.from('coupon_instances').delete().eq('coupon_id', couponId);
        await admin.from('coupons').delete().eq('id', couponId);
      }
    }
  });

  it('GET /api/coupons 沒有已核銷實例回 null，核銷後回最近實例代碼', async () => {
    const couponId = randomUUID();
    const instanceId = randomUUID();
    const code = `T35${Date.now().toString(36).slice(-5).toUpperCase()}`;
    try {
      expect((await admin.from('coupons').insert({
        id: couponId, tenant_id: SHOP_A.id, name: '#35 核銷代碼測試券',
        discount_type: 'AMOUNT', discount_value: 50, total_quantity: 0, status: 'PUBLISHED',
      })).error).toBeNull();
      expect((await admin.from('coupon_instances').insert({
        id: instanceId, tenant_id: SHOP_A.id, coupon_id: couponId,
        customer_id: SHOP_A.customerA1, code,
      })).error).toBeNull();

      expect((await fetchCoupon(couponId)).lastRedeemedCode).toBeNull();
      expect((await admin.from('coupon_instances').update({ redeemed_at: new Date().toISOString() }).eq('id', instanceId)).error).toBeNull();
      expect((await fetchCoupon(couponId)).lastRedeemedCode).toBe(code);
    } finally {
      await admin.from('coupon_instances').delete().eq('id', instanceId);
      await admin.from('coupons').delete().eq('id', couponId);
    }
  });
});

describe('membership-levels：欄位持久化與預設等級', () => {
  it('POST / PUT 寫入說明／啟用／預設後，GET 回傳相同值且新預設會清掉舊預設', async () => {
    const createdIds: string[] = [];
    try {
      const first = await ownerA.post('/api/membership-levels', {
        name: '#35 第一等級', description: '第一說明', active: true, isDefault: true,
      });
      expect(first.status).toBe(200);
      const firstBody = await readJson<{ id: string }>(first);
      expect(firstBody.success).toBe(true);
      createdIds.push(firstBody.data!.id);

      const second = await ownerA.post('/api/membership-levels', {
        name: '#35 第二等級', description: '第二說明', active: true, isDefault: true,
      });
      expect(second.status).toBe(200);
      const secondBody = await readJson<{ id: string }>(second);
      expect(secondBody.success).toBe(true);
      createdIds.push(secondBody.data!.id);

      expect(await fetchLevel(firstBody.data!.id)).toMatchObject({ description: '第一說明', active: true, isDefault: false });
      expect(await fetchLevel(secondBody.data!.id)).toMatchObject({ description: '第二說明', active: true, isDefault: true });

      const update = await ownerA.put(`/api/membership-levels/${secondBody.data!.id}`, {
        description: '已更新說明', active: false, isDefault: false,
      });
      expect(update.status).toBe(200);
      expect(await fetchLevel(secondBody.data!.id)).toMatchObject({ description: '已更新說明', active: false, isDefault: false });
    } finally {
      if (createdIds.length > 0) {
        await admin.from('membership_levels').delete().in('id', createdIds);
      }
    }
  });
});
