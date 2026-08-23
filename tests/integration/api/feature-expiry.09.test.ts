/**
 * 功能到期 cron 整合測試 — 12 分冊 §4「Phase 5/5.5」矩陣 feature-expiry.09 列：
 *   「到期 cron：票券→PAUSED+旗標、商品下架；restore 還原並回報筆數」
 * 契約出處：docs/integration/09-FEATURE-STORE.md §6（到期副作用與自動還原）+
 * §3（restore 端點回 {restoredCoupons, restoredProducts}）；cron 驗證方式同
 * 07 分冊慣例（Bearer CRON_SECRET，無/錯 Bearer → 401）。
 *
 * CRON_SECRET：.env.test 提供 TEST_CRON_SECRET，global-setup 將其載入本測試
 * 行程的 process.env 並映射成 next dev 的 CRON_SECRET（commit 8be0700），
 * 因此正例直接以 process.env.TEST_CRON_SECRET 當 Bearer 值，beforeAll 斷言
 * 其存在（缺了就是環境壞掉，紅燈報出來而不是靜默跳過）。
 *
 * 測試資料（全自建，afterAll 清理）：SHOP_B（最小種子店，無其他票券/商品，
 * 計數斷言不受干擾）建 1 張 PUBLISHED 票券 + 1 個 active 商品；把 SHOP_B 的
 * COUPON_SYSTEM / PRODUCT_SALES 訂閱列 expires_at 改成昨天製造「已到期」。
 * afterAll：兩碼 upsert 回 GRANTED 基線（active、expires_at null、
 * source='GRANTED'，onConflict 'tenant_id,code'），刪掉測試票券與商品。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const CRON_PATH = '/api/cron/feature-expiry';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

/** cron 回應不是 {success} 信封，而是裸 JSON（07 分冊慣例） */
interface CronResult {
  processedTenants: number;
  pausedCoupons: number;
  pausedProducts: number;
}

let admin: SupabaseClient;
let ownerB: AuthedApi;
let cronSecret: string;

const couponId = randomUUID();
const productId = randomUUID();

function cronFetch(headers?: Record<string, string>): Promise<Response> {
  return fetch(`${BASE_URL}${CRON_PATH}`, { headers });
}

async function setExpiry(code: string, expiresAtIso: string | null): Promise<void> {
  const { data, error } = await admin
    .from('feature_subscriptions')
    .update({ expires_at: expiresAtIso })
    .eq('tenant_id', SHOP_B.id)
    .eq('code', code)
    .select('code');
  expect(error).toBeNull();
  expect(data).toHaveLength(1); // seed 的 GRANTED 列必須存在
}

async function couponState(): Promise<{ status: string; auto_paused_by_feature: boolean }> {
  const { data, error } = await admin
    .from('coupons')
    .select('status, auto_paused_by_feature')
    .eq('id', couponId)
    .single();
  expect(error).toBeNull();
  return data as { status: string; auto_paused_by_feature: boolean };
}

async function productState(): Promise<{ active: boolean; auto_paused_by_feature: boolean }> {
  const { data, error } = await admin
    .from('products')
    .select('active, auto_paused_by_feature')
    .eq('id', productId)
    .single();
  expect(error).toBeNull();
  return data as { active: boolean; auto_paused_by_feature: boolean };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  cronSecret = process.env.TEST_CRON_SECRET ?? '';
  expect(cronSecret).toBeTruthy(); // 見檔頭：缺 = 環境問題，紅燈而非跳過

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

  // SHOP_B 自建：1 張 PUBLISHED 票券 + 1 個 active 商品（active 預設 true）
  const { error: eC } = await admin.from('coupons').insert({
    id: couponId,
    tenant_id: SHOP_B.id,
    name: '到期測試票券（09 §6）',
    discount_type: 'AMOUNT',
    discount_value: 100,
    total_quantity: 0,
    status: 'PUBLISHED',
  });
  expect(eC).toBeNull();
  const { error: eP } = await admin.from('products').insert({
    id: productId,
    tenant_id: SHOP_B.id,
    name: '到期測試商品（09 §6）',
    price: 100,
    stock: 5,
    safety_stock: 0,
  });
  expect(eP).toBeNull();
});

afterAll(async () => {
  // 還原 SHOP_B 兩碼的 GRANTED 基線
  await admin.from('feature_subscriptions').upsert(
    ['COUPON_SYSTEM', 'PRODUCT_SALES'].map((code) => ({
      tenant_id: SHOP_B.id,
      code,
      active: true,
      expires_at: null,
      source: 'GRANTED',
      cancelled_at: null,
    })),
    { onConflict: 'tenant_id,code' },
  );
  // 刪掉測試票券/商品（無 instances / inventory_logs，直接刪）
  await admin.from('coupons').delete().eq('id', couponId);
  await admin.from('products').delete().eq('id', productId);
});

describe('GET /api/cron/feature-expiry（09 §6）', () => {
  it('無 Bearer → 401；錯 Bearer → 401', async () => {
    const noAuth = await cronFetch();
    expect(noAuth.status).toBe(401);
    expect(await noAuth.text()).toBe('unauthorized');

    const badAuth = await cronFetch({ Authorization: 'Bearer wrong-secret' });
    expect(badAuth.status).toBe(401);
  });

  it('COUPON_SYSTEM/PRODUCT_SALES 到期 → 票券 PAUSED+旗標、商品下架+旗標，回報筆數', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await setExpiry('COUPON_SYSTEM', yesterday);
    await setExpiry('PRODUCT_SALES', yesterday);

    const res = await cronFetch({ Authorization: `Bearer ${cronSecret}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CronResult;
    // 此時整個 TEST DB 只有 SHOP_B 有到期訂閱列（seed 其餘皆 expires_at null，
    // 其他測試檔各自還原基線且 --no-file-parallelism 串行執行）
    expect(body.processedTenants).toBe(1);
    expect(body.pausedCoupons).toBe(1);
    expect(body.pausedProducts).toBe(1);

    const coupon = await couponState();
    expect(coupon.status).toBe('PAUSED');
    expect(coupon.auto_paused_by_feature).toBe(true);

    const product = await productState();
    expect(product.active).toBe(false);
    expect(product.auto_paused_by_feature).toBe(true);
  });

  it('冪等：再打一次 → pausedCoupons/pausedProducts 皆 0（已暫停的列不重複計）', async () => {
    const res = await cronFetch({ Authorization: `Bearer ${cronSecret}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CronResult;
    expect(body.processedTenants).toBe(1); // 訂閱列仍過期，店仍在處理範圍
    expect(body.pausedCoupons).toBe(0);
    expect(body.pausedProducts).toBe(0);

    // 資料狀態不變
    expect((await couponState()).status).toBe('PAUSED');
    expect((await productState()).active).toBe(false);
  });
});

describe('POST /api/feature-store/COUPON_SYSTEM/restore 的 §6 自動還原', () => {
  it('已過期時 restore → 409（請重新訂閱）；改回未來再 restore → 票券恢復 PUBLISHED、restoredCoupons=1', async () => {
    // 仍在過期狀態：restore 被 409 擋（09 §3「已過期 → 409 請重新訂閱」）
    const expired = await ownerB.post('/api/feature-store/COUPON_SYSTEM/restore');
    expect(expired.status).toBe(409);
    const expiredBody = (await expired.json()) as Envelope;
    expect(expiredBody.success).toBe(false);
    expect(expiredBody.code).toBe('REQ_003');
    expect((await couponState()).status).toBe('PAUSED'); // 未被還原

    // 把訂閱列改回未來（模擬「還在有效期內、只是被誤暫停/取消」的還原情境）
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await setExpiry('COUPON_SYSTEM', nextMonth);

    const res = await ownerB.post('/api/feature-store/COUPON_SYSTEM/restore');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ restoredCoupons: number; restoredProducts: number }>;
    expect(body.success).toBe(true);
    expect(body.data!.restoredCoupons).toBe(1);
    expect(body.data!.restoredProducts).toBe(0); // PRODUCT_SALES 另一碼，不在本次還原

    const coupon = await couponState();
    expect(coupon.status).toBe('PUBLISHED');
    expect(coupon.auto_paused_by_feature).toBe(false);

    // 商品（PRODUCT_SALES）不受 COUPON_SYSTEM restore 影響，仍下架
    expect((await productState()).active).toBe(false);
  });
});
