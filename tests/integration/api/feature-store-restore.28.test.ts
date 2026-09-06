/**
 * POST /api/feature-store/:code/restore 的真實回傳形狀（GitHub issue #28 第 ⑧ 筆）
 * -----------------------------------------------------------------------------
 * 09 分冊 §3/§6。頁面先前把這支端點的回傳值**整個丟棄**，一律顯示「訂閱已恢復！」，
 * 於是「N 張票券已自動恢復發布」「N 項商品已自動重新上架」「票券/商品自動恢復失敗
 * （已通知平台處理）」三句早就備好的文案全站零引用。本檔證明端點在真實資料
 * 分支下各自回什麼；副作用例外的 fallback 由不碰資料庫 schema 的單元測試鎖住。
 *
 * 與 feature-store.09.test.ts 的分工：那一檔測的是點數與到期日（restore 不扣點），
 * 沒有碰 §6 的還原副作用回傳值。本檔只碰副作用，且不動任何點數交易。
 *
 * 基線與清理：seed 給 SHOP_A 的 18 個付費碼都是 GRANTED / expires_at = null，
 * 所以這裡不必走 apply（不需要入點），直接以 service role 把 cancelled_at 設成
 * 「已取消」的狀態再打 restore。每個案例在 try/finally 內把自己造的票券／商品
 * 刪掉、把 cancelled_at 歸 null，afterAll 再統一收尾一次。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

interface RestoreResult {
  restoredCoupons?: number;
  restoredProducts?: number;
  restoreSideEffectFailed?: boolean;
}

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let admin: SupabaseClient;
let ownerA: AuthedApi;

/** 把某個碼設成「已取消但未過期」（restore 的前置狀態） */
async function markCancelled(code: string): Promise<void> {
  const { error } = await admin
    .from('feature_subscriptions')
    .upsert(
      {
        tenant_id: SHOP_A.id,
        code,
        active: true,
        expires_at: null,
        source: 'GRANTED',
        cancelled_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,code' },
    );
  expect(error).toBeNull();
}

async function clearCancelled(code: string): Promise<void> {
  await admin
    .from('feature_subscriptions')
    .update({ cancelled_at: null })
    .eq('tenant_id', SHOP_A.id)
    .eq('code', code);
}

const TOUCHED_CODES = ['SHIFT_MANAGEMENT', 'COUPON_SYSTEM', 'PRODUCT_SALES'];

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  for (const code of TOUCHED_CODES) await clearCancelled(code);
});

describe('restore 分支 1：沒有還原副作用的碼（09 §3）', () => {
  it('SHIFT_MANAGEMENT restore → 200 且 data 不含任何還原欄位（頁面只顯示「訂閱已恢復」）', async () => {
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

describe('restore 分支 2：還原副作用成功，回實際筆數（09 §6）', () => {
  it('COUPON_SYSTEM：2 張 auto_paused 票券 → restoredCoupons=2，且票券真的變回 PUBLISHED', async () => {
    const pausedIds = [randomUUID(), randomUUID()];
    // 對照組：沒有被功能自動暫停的票券，restore 不該碰它
    const untouchedId = randomUUID();
    await markCancelled('COUPON_SYSTEM');
    try {
      const { error: e0 } = await admin.from('coupons').insert([
        ...pausedIds.map((id) => ({
          id, tenant_id: SHOP_A.id, name: `票券-暫停-${suffix()}`,
          discount_type: 'AMOUNT', discount_value: 50,
          status: 'PAUSED', auto_paused_by_feature: true,
        })),
        {
          id: untouchedId, tenant_id: SHOP_A.id, name: `票券-店家自己停的-${suffix()}`,
          discount_type: 'AMOUNT', discount_value: 50,
          status: 'PAUSED', auto_paused_by_feature: false,
        },
      ]);
      expect(e0).toBeNull();

      const res = await ownerA.post('/api/feature-store/COUPON_SYSTEM/restore');
      expect(res.status).toBe(200);
      const body = await readJson<RestoreResult>(res);
      expect(body.success).toBe(true);
      expect(body.data?.restoredCoupons).toBe(2);
      expect(body.data?.restoredProducts).toBe(0);
      expect(body.data?.restoreSideEffectFailed).toBeUndefined();

      const { data: rows } = await admin
        .from('coupons')
        .select('id, status, auto_paused_by_feature')
        .in('id', [...pausedIds, untouchedId]);
      const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
      for (const id of pausedIds) {
        expect(byId.get(id)!.status).toBe('PUBLISHED');
        expect(byId.get(id)!.auto_paused_by_feature).toBe(false);
      }
      // 店家自己停的票券不該被 restore 順手打開
      expect(byId.get(untouchedId)!.status).toBe('PAUSED');
    } finally {
      await admin.from('coupons').delete().in('id', [...pausedIds, untouchedId]);
      await clearCancelled('COUPON_SYSTEM');
    }
  });

  it('PRODUCT_SALES：1 項 auto_paused 商品 → restoredProducts=1，且商品真的重新上架', async () => {
    const productId = randomUUID();
    await markCancelled('PRODUCT_SALES');
    try {
      const { error: e0 } = await admin.from('products').insert({
        id: productId, tenant_id: SHOP_A.id, name: `商品-暫停-${suffix()}`,
        price: 300, active: false, auto_paused_by_feature: true,
      });
      expect(e0).toBeNull();

      const res = await ownerA.post('/api/feature-store/PRODUCT_SALES/restore');
      expect(res.status).toBe(200);
      const body = await readJson<RestoreResult>(res);
      expect(body.data?.restoredProducts).toBe(1);
      expect(body.data?.restoredCoupons).toBe(0);

      const { data: row } = await admin
        .from('products')
        .select('active, auto_paused_by_feature')
        .eq('id', productId)
        .single();
      expect(row!.active).toBe(true);
      expect(row!.auto_paused_by_feature).toBe(false);
    } finally {
      await admin.from('products').delete().eq('id', productId);
      await clearCancelled('PRODUCT_SALES');
    }
  });

  it('COUPON_SYSTEM 但沒有任何 auto_paused 票券 → restoredCoupons=0（頁面不顯示「0 張票券…」）', async () => {
    await markCancelled('COUPON_SYSTEM');
    try {
      const res = await ownerA.post('/api/feature-store/COUPON_SYSTEM/restore');
      const body = await readJson<RestoreResult>(res);
      expect(body.data?.restoredCoupons).toBe(0);
      expect(body.data?.restoreSideEffectFailed).toBeUndefined();
    } finally {
      await clearCancelled('COUPON_SYSTEM');
    }
  });
});
