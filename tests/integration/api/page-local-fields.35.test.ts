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

  it('GET /api/coupons 反核銷最新實例後仍回較舊已核銷代碼', async () => {
    const couponId = randomUUID();
    const olderInstanceId = randomUUID();
    const newerInstanceId = randomUUID();
    const olderCode = `T35O${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const newerCode = `T35N${Date.now().toString(36).slice(-4).toUpperCase()}`;
    try {
      expect((await admin.from('coupons').insert({
        id: couponId, tenant_id: SHOP_A.id, name: '#35 核銷代碼測試券',
        discount_type: 'AMOUNT', discount_value: 50, total_quantity: 0, status: 'PUBLISHED',
      })).error).toBeNull();
      expect((await admin.from('coupon_instances').insert({
        id: olderInstanceId, tenant_id: SHOP_A.id, coupon_id: couponId,
        customer_id: SHOP_A.customerA1, code: olderCode,
        redeemed_at: '2026-08-31T10:00:00.000Z',
      })).error).toBeNull();
      expect((await admin.from('coupon_instances').insert({
        id: newerInstanceId, tenant_id: SHOP_A.id, coupon_id: couponId,
        customer_id: SHOP_A.customerA1, code: newerCode,
        redeemed_at: '2026-08-31T11:00:00.000Z',
      })).error).toBeNull();

      expect((await fetchCoupon(couponId)).lastRedeemedCode).toBe(newerCode);
      const undo = await ownerA.post(`/api/coupons/instances/${newerInstanceId}/unredeem`);
      expect(undo.status).toBe(200);
      expect((await fetchCoupon(couponId)).lastRedeemedCode).toBe(olderCode);
    } finally {
      await admin.from('coupon_instances').delete().in('id', [olderInstanceId, newerInstanceId]);
      await admin.from('coupons').delete().eq('id', couponId);
    }
  });
});

describe('membership-levels：欄位持久化與預設等級', () => {
  it('新顧客未指定等級套用 active default，重算無門檻命中也 fallback default', async () => {
    const createdIds: string[] = [];
    let customerId: string | undefined;
    try {
      const level = await ownerA.post('/api/membership-levels', {
        name: '#35 預設等級行為測試',
        thresholdSpent: 999999,
        active: true,
        isDefault: true,
      });
      expect(level.status).toBe(200);
      const levelBody = await readJson<{ id: string }>(level);
      expect(levelBody.success).toBe(true);
      const levelId = levelBody.data!.id;
      createdIds.push(levelId);

      const customer = await ownerA.post('/api/customers', {
        name: '#35 預設等級顧客', phone: '0900000035',
      });
      expect(customer.status).toBe(200);
      customerId = (await readJson<{ id: string }>(customer)).data!.id;

      const { data: assigned, error: assignedError } = await admin
        .from('customers').select('membership_level_id').eq('id', customerId).single();
      expect(assignedError).toBeNull();
      expect(assigned?.membership_level_id).toBe(levelId);

      const fallbackCustomerId = randomUUID();
      expect((await admin.from('customers').insert({
        id: fallbackCustomerId, tenant_id: SHOP_A.id,
        name: '#35 fallback 顧客', phone: '0900000036', membership_level_id: null,
      })).error).toBeNull();
      try {
        const recalc = await ownerA.put(`/api/membership-levels/${levelId}`, {
          description: '觸發無門檻 fallback 重算',
        });
        expect(recalc.status).toBe(200);
        const { data: recalculated, error: recalcError } = await admin
          .from('customers').select('membership_level_id').eq('id', fallbackCustomerId).single();
        expect(recalcError).toBeNull();
        expect(recalculated?.membership_level_id).toBe(levelId);
      } finally {
        await admin.from('customers').delete().eq('id', fallbackCustomerId);
      }
    } finally {
      if (customerId) await admin.from('customers').delete().eq('id', customerId);
      if (createdIds.length > 0) await admin.from('membership_levels').delete().in('id', createdIds);
    }
  });

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
