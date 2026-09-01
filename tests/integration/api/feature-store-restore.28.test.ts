/**
 * Issue #28 ⑧：驗證 feature-store restore 的實際 API 回傳值。
 *
 * 這裡只測 TEST 可穩定重現的資料庫分支：無副作用、票券副作用、商品副作用。
 * `restoreSideEffectFailed` 需要在 TEST 臨時安裝 database trigger 才能誘發，
 * 不把未授權的 Management API 憑證塞進 CI；其前端 warning mapping 由 unit test
 * 覆蓋，若要做端點級 fault-injection 仍是 TEST credential gate。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

type RestoreResult = {
  restoredCoupons?: number;
  restoredProducts?: number;
  restoreSideEffectFailed?: boolean;
};

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

async function markCancelled(code: string): Promise<void> {
  const { error } = await admin
    .from('feature_subscriptions')
    .upsert({
      tenant_id: SHOP_A.id,
      code,
      active: true,
      expires_at: null,
      source: 'GRANTED',
      cancelled_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,code' });
  expect(error).toBeNull();
}

async function clearCancelled(code: string): Promise<void> {
  const { error } = await admin
    .from('feature_subscriptions')
    .update({ cancelled_at: null })
    .eq('tenant_id', SHOP_A.id)
    .eq('code', code);
  expect(error).toBeNull();
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  for (const code of ['SHIFT_MANAGEMENT', 'COUPON_SYSTEM', 'PRODUCT_SALES']) {
    await clearCancelled(code);
  }
});

describe('restore guard：未取消的有效訂閱', () => {
  it('active 且 cancelled_at 為 null → 409，且不改變訂閱狀態', async () => {
    const code = 'SHIFT_MANAGEMENT';
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { error: upsertError } = await admin
      .from('feature_subscriptions')
      .upsert({
        tenant_id: SHOP_A.id,
        code,
        active: true,
        expires_at: expiresAt,
        source: 'GRANTED',
        cancelled_at: null,
      }, { onConflict: 'tenant_id,code' });
    expect(upsertError).toBeNull();

    try {
      const res = await ownerA.post(`/api/feature-store/${code}/restore`);
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body).toMatchObject({
        success: false,
        code: 'REQ_003',
        message: '此訂閱尚未取消，無需恢復',
      });

      const { data: row, error: readError } = await admin
        .from('feature_subscriptions')
        .select('active, expires_at, cancelled_at')
        .eq('tenant_id', SHOP_A.id)
        .eq('code', code)
        .single();
      expect(readError).toBeNull();
      expect(row).toMatchObject({ active: true, cancelled_at: null });
      expect(new Date(row?.expires_at ?? '').getTime()).toBe(new Date(expiresAt).getTime());
    } finally {
      await clearCancelled(code);
    }
  });
});

describe('restore 分支 1：沒有副作用的功能', () => {
  it('SHIFT_MANAGEMENT restore → 200，且不捏造票券／商品數量', async () => {
    await markCancelled('SHIFT_MANAGEMENT');
    try {
      const res = await ownerA.post('/api/feature-store/SHIFT_MANAGEMENT/restore');
      expect(res.status).toBe(200);
      const body = await readJson<RestoreResult>(res);
      expect(body.success).toBe(true);
      expect(body.data?.restoredCoupons).toBeUndefined();
      expect(body.data?.restoredProducts).toBeUndefined();
      expect(body.data?.restoreSideEffectFailed).toBeUndefined();
    } finally {
      await clearCancelled('SHIFT_MANAGEMENT');
    }
  });
});

describe('restore 分支 2：副作用成功時回實際數量', () => {
  it('COUPON_SYSTEM → 只恢復 auto-paused 票券並回 restoredCoupons=2', async () => {
    const pausedIds = [randomUUID(), randomUUID()];
    const untouchedId = randomUUID();
    await markCancelled('COUPON_SYSTEM');
    try {
      const { error } = await admin.from('coupons').insert([
        ...pausedIds.map((id) => ({
          id,
          tenant_id: SHOP_A.id,
          name: `restore-test-${id}`,
          discount_type: 'AMOUNT',
          discount_value: 50,
          status: 'PAUSED',
          auto_paused_by_feature: true,
        })),
        {
          id: untouchedId,
          tenant_id: SHOP_A.id,
          name: `restore-untouched-${untouchedId}`,
          discount_type: 'AMOUNT',
          discount_value: 50,
          status: 'PAUSED',
          auto_paused_by_feature: false,
        },
      ]);
      expect(error).toBeNull();

      const res = await ownerA.post('/api/feature-store/COUPON_SYSTEM/restore');
      expect(res.status).toBe(200);
      const body = await readJson<RestoreResult>(res);
      expect(body.success).toBe(true);
      expect(body.data?.restoredCoupons).toBe(2);
      expect(body.data?.restoredProducts).toBe(0);
      expect(body.data?.restoreSideEffectFailed).toBeUndefined();

      const { data: rows, error: readError } = await admin
        .from('coupons')
        .select('id, status, auto_paused_by_feature')
        .in('id', [...pausedIds, untouchedId]);
      expect(readError).toBeNull();
      const byId = new Map((rows ?? []).map((row) => [row.id as string, row]));
      for (const id of pausedIds) {
        expect(byId.get(id)?.status).toBe('PUBLISHED');
        expect(byId.get(id)?.auto_paused_by_feature).toBe(false);
      }
      expect(byId.get(untouchedId)?.status).toBe('PAUSED');
    } finally {
      await admin.from('coupons').delete().in('id', [...pausedIds, untouchedId]);
      await clearCancelled('COUPON_SYSTEM');
    }
  });

  it('PRODUCT_SALES → 恢復 auto-paused 商品並回 restoredProducts=1', async () => {
    const productId = randomUUID();
    await markCancelled('PRODUCT_SALES');
    try {
      const { error } = await admin.from('products').insert({
        id: productId,
        tenant_id: SHOP_A.id,
        name: `restore-product-${productId}`,
        price: 300,
        active: false,
        auto_paused_by_feature: true,
      });
      expect(error).toBeNull();

      const res = await ownerA.post('/api/feature-store/PRODUCT_SALES/restore');
      expect(res.status).toBe(200);
      const body = await readJson<RestoreResult>(res);
      expect(body.success).toBe(true);
      expect(body.data?.restoredCoupons).toBe(0);
      expect(body.data?.restoredProducts).toBe(1);
      expect(body.data?.restoreSideEffectFailed).toBeUndefined();

      const { data: row, error: readError } = await admin
        .from('products')
        .select('active, auto_paused_by_feature')
        .eq('id', productId)
        .single();
      expect(readError).toBeNull();
      expect(row?.active).toBe(true);
      expect(row?.auto_paused_by_feature).toBe(false);
    } finally {
      await admin.from('products').delete().eq('id', productId);
      await clearCancelled('PRODUCT_SALES');
    }
  });

  it('COUPON_SYSTEM 沒有 auto-paused 票券 → 回 0 而非捏造數量', async () => {
    await markCancelled('COUPON_SYSTEM');
    try {
      const res = await ownerA.post('/api/feature-store/COUPON_SYSTEM/restore');
      expect(res.status).toBe(200);
      const body = await readJson<RestoreResult>(res);
      expect(body.success).toBe(true);
      expect(body.data?.restoredCoupons).toBe(0);
      expect(body.data?.restoreSideEffectFailed).toBeUndefined();
    } finally {
      await clearCancelled('COUPON_SYSTEM');
    }
  });
});
