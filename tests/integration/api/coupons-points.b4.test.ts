/**
 * 票券 / 點數 API 整合測試 — 12 分冊 §4「Phase 5」矩陣「其餘 B 組端點：照 §3
 * 骨架，含各狀態機 409」。端點規格見 docs/integration/04-API-CONTRACTS.md §B-4：
 *   - POST /api/coupons/:id/publish‖pause‖resume：DRAFT→PUBLISHED→PAUSED→PUBLISHED
 *     （其他轉換 409）
 *   - POST /api/coupons/:id/batch-issue：{customerIds[]} 每人一張 instance，
 *     code = 8 碼大寫英數
 *   - POST /api/coupons/redeem-by-code：{code} → redeemed_at=now；已核銷 → 409
 *   - DELETE /api/coupons/:id：僅 DRAFT 可刪
 *   - GET /api/points/balance：{balance} = 最新 balance_after（無紀錄 = 0）
 *   - POST /api/points/transfer：餘額不足 → 409 POINTS_001（錯誤碼總表）
 *
 * 案例順序注意：「balance 初始 0」測試必須排在 transfer 之前（describe 由上而
 * 下執行）；本檔的 transfer 案例只打「餘額不足」分支，不會產生任何
 * tenant_point_transactions，SHOP_A/SHOP_B 的錢包保持種子狀態（無紀錄）。
 *
 * 清理紀律：coupons/coupon_instances 全部自建，try/finally 內以 service role
 * 刪除（instances 隨 coupon on delete cascade，仍逐一明確清）。發放對象用
 * seed 的 customerA1/A2 —— coupon_instances 不影響 reports.a5 的手算欄位
 * （點數/消費/預約數都不動），且測試內全數清掉。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

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

async function insertCoupon(status: 'DRAFT' | 'PUBLISHED' | 'PAUSED'): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('coupons').insert({
    id, tenant_id: SHOP_A.id, name: `B4 測試票券-${uniqueSuffix()}`,
    discount_type: 'AMOUNT', discount_value: 100, total_quantity: 0, status,
  });
  expect(error).toBeNull();
  return id;
}

async function couponStatus(id: string): Promise<string> {
  const { data, error } = await admin.from('coupons').select('status').eq('id', id).single();
  expect(error).toBeNull();
  return (data as any).status as string;
}

async function deleteCoupon(id: string): Promise<void> {
  await admin.from('coupon_instances').delete().eq('coupon_id', id);
  const { error } = await admin.from('coupons').delete().eq('id', id);
  expect(error).toBeNull();
}

describe('GET /api/points/balance（04 §B-4：無紀錄 = 0；必須先於 transfer 案例執行）', () => {
  it('種子狀態無任何交易 → {balance: 0}', async () => {
    const res = await ownerA.get('/api/points/balance');
    expect(res.status).toBe(200);
    const body = await readJson<{ balance: number }>(res);
    expect(body.success).toBe(true);
    expect(body.data!.balance).toBe(0);
  });
});

describe('票券狀態機 publish→pause→resume（04 §B-4）', () => {
  it('DRAFT→PUBLISHED→PAUSED→PUBLISHED 合法鏈全 200', async () => {
    const couponId = await insertCoupon('DRAFT');
    try {
      const publish = await ownerA.post(`/api/coupons/${couponId}/publish`);
      expect(publish.status).toBe(200);
      expect((await readJson(publish)).success).toBe(true);
      expect(await couponStatus(couponId)).toBe('PUBLISHED');

      const pause = await ownerA.post(`/api/coupons/${couponId}/pause`);
      expect(pause.status).toBe(200);
      expect(await couponStatus(couponId)).toBe('PAUSED');

      const resume = await ownerA.post(`/api/coupons/${couponId}/resume`);
      expect(resume.status).toBe(200);
      expect(await couponStatus(couponId)).toBe('PUBLISHED');
    } finally {
      await deleteCoupon(couponId);
    }
  });

  it('DRAFT 直接 pause → 409 REQ_003，狀態仍 DRAFT', async () => {
    const couponId = await insertCoupon('DRAFT');
    try {
      const res = await ownerA.post(`/api/coupons/${couponId}/pause`);
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
      expect(await couponStatus(couponId)).toBe('DRAFT');
    } finally {
      await deleteCoupon(couponId);
    }
  });
});

describe('POST /api/coupons/:id/batch-issue（04 §B-4：每人一張、code 8 碼大寫英數）', () => {
  it('對 2 位顧客發放 → 2 張 instances，code 符合 8 碼大寫英數且未核銷', async () => {
    const couponId = await insertCoupon('PUBLISHED');
    try {
      const res = await ownerA.post(`/api/coupons/${couponId}/batch-issue`, {
        customerIds: [SHOP_A.customerA1, SHOP_A.customerA2],
      });
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);

      const { data: instances, error } = await admin
        .from('coupon_instances')
        .select('customer_id, code, redeemed_at')
        .eq('coupon_id', couponId);
      expect(error).toBeNull();
      expect(instances).toHaveLength(2);
      const rows = instances as any[];
      expect(rows.map((r) => r.customer_id).sort()).toEqual(
        [SHOP_A.customerA1, SHOP_A.customerA2].sort(),
      );
      for (const r of rows) {
        expect(r.code).toMatch(/^[A-Z0-9]{8}$/); // 8 碼大寫英數
        expect(r.redeemed_at).toBeNull();
      }
      // 每人一張，code 不重複
      expect(new Set(rows.map((r) => r.code)).size).toBe(2);
    } finally {
      await deleteCoupon(couponId);
    }
  });
});

describe('POST /api/coupons/redeem-by-code（04 §B-4：已核銷 → 409）', () => {
  it('首次核銷 200 且 redeemed_at 落 DB；同 code 再核銷 → 409 REQ_003', async () => {
    const couponId = await insertCoupon('PUBLISHED');
    try {
      const issue = await ownerA.post(`/api/coupons/${couponId}/batch-issue`, {
        customerIds: [SHOP_A.customerA1],
      });
      expect(issue.status).toBe(200);
      const { data: inst } = await admin
        .from('coupon_instances').select('id, code').eq('coupon_id', couponId).single();
      const code = (inst as any).code as string;

      const first = await ownerA.post('/api/coupons/redeem-by-code', { code });
      expect(first.status).toBe(200);
      expect((await readJson(first)).success).toBe(true);
      const { data: redeemed } = await admin
        .from('coupon_instances').select('redeemed_at').eq('id', (inst as any).id).single();
      expect((redeemed as any).redeemed_at).not.toBeNull();

      const again = await ownerA.post('/api/coupons/redeem-by-code', { code });
      expect(again.status).toBe(409);
      const body = await readJson(again);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
    } finally {
      await deleteCoupon(couponId);
    }
  });
});

describe('DELETE /api/coupons/:id（04 §B-4：僅 DRAFT 可刪）', () => {
  it('非 DRAFT（PUBLISHED）→ 409 REQ_003 且票券仍在；DRAFT → 200 且真的刪掉', async () => {
    const publishedId = await insertCoupon('PUBLISHED');
    const draftId = await insertCoupon('DRAFT');
    try {
      const res = await ownerA.delete(`/api/coupons/${publishedId}`);
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
      expect(await couponStatus(publishedId)).toBe('PUBLISHED'); // 沒被刪

      const delDraft = await ownerA.delete(`/api/coupons/${draftId}`);
      expect(delDraft.status).toBe(200);
      expect((await readJson(delDraft)).success).toBe(true);
      const { data: gone } = await admin
        .from('coupons').select('id').eq('id', draftId).maybeSingle();
      expect(gone).toBeNull();
    } finally {
      await deleteCoupon(publishedId);
      // draftId 已被 API 刪除；保險再清一次（無列 = no-op）
      await admin.from('coupons').delete().eq('id', draftId);
    }
  });
});

describe('POST /api/points/transfer（04 §B-4；餘額不足 → 409 POINTS_001）', () => {
  it('SHOP_A 餘額 0 轉 100 給 SHOP_B → 409 POINTS_001，兩店都不產生交易', async () => {
    const res = await ownerA.post('/api/points/transfer', {
      toShopCode: SHOP_B.shopCode, // seed 的 shop_code = 'tenant-b'
      amount: 100,
    });
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('POINTS_001');

    // rpc 內 raise → 整筆 rollback：OUT/IN 都不得出現
    for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
      const { count, error } = await admin
        .from('tenant_point_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);
      expect(error).toBeNull();
      expect(count ?? 0).toBe(0);
    }

    // 餘額仍為 0
    const balance = await readJson<{ balance: number }>(await ownerA.get('/api/points/balance'));
    expect(balance.data!.balance).toBe(0);
  });
});
