/**
 * 多店帳號切換 API 整合測試 — 12 分冊 §4「Phase 2（登入）」矩陣：
 *   「my-tenants current 正確；switch-tenant 後 me 變更；非成員 switch 403」
 * 端點行為規格見 docs/integration/03-AUTH.md §5。
 *
 * ⚠️ TDD 紅燈說明：`/api/auth/my-tenants`、`/api/auth/switch-tenant` 尚未實作前，
 * 全部紅燈——誠實的「先寫測試」狀態，不得為轉綠放寬斷言（12 §2.4）。
 *
 * 本檔會暫時把 owner-a 加進 SHOP_B（service role 直接 insert tenant_users），
 * 驗證「切店後 me 改變」；afterAll 還原，不留副作用給其他測試檔（本檔不跑
 * 全域 reset-db，globalSetup 只在整個測試流程開始時跑一次）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs } from '../../helpers/auth';
import type { TenantSummary } from '@/lib/types';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

/** 分頁掃 admin.auth.admin.listUsers 找 email 對應的 user id（同 scripts/test/seed.mjs 手法）。 */
async function findUserIdByEmail(client: SupabaseClient, email: string): Promise<string> {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    expect(error).toBeNull();
    const found = data!.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data!.users.length < perPage) break;
    page += 1;
  }
  throw new Error(`找不到 auth user：${email}（檢查 reset-db/seed 是否已成功執行 §1.3 種子）`);
}

let admin: SupabaseClient;
let ownerAUserId: string;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerAUserId = await findUserIdByEmail(admin, SHOP_A.owner.email);
});

describe('GET /api/auth/my-tenants（03 §5）', () => {
  it('owner-a 只有 A 店 → 長度 1、tenant-a、current true', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.get('/api/auth/my-tenants');
    expect(res.status).toBe(200);
    const body = await readJson<TenantSummary[]>(res);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data![0].id).toBe(SHOP_A.id);
    expect(body.data![0].shopCode).toBe(SHOP_A.shopCode);
    expect(body.data![0].current).toBe(true);
  });
});

describe('POST /api/auth/switch-tenant 後 me 變更（03 §5）', () => {
  beforeAll(async () => {
    const { error } = await admin
      .from('tenant_users')
      .insert({ tenant_id: SHOP_B.id, user_id: ownerAUserId, role: 'STAFF' });
    expect(error).toBeNull();
  });

  afterAll(async () => {
    // 還原：把測試期間額外加的 membership 刪掉，不留副作用給其他測試檔。
    const { error } = await admin
      .from('tenant_users')
      .delete()
      .eq('tenant_id', SHOP_B.id)
      .eq('user_id', ownerAUserId);
    expect(error).toBeNull();
  });

  it('加入 SHOP_B 後 my-tenants 長度變 2；switch 到 SHOP_B 後 me 回 SHOP_B 的 tenantId/shopCode', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

    const listRes = await api.get('/api/auth/my-tenants');
    expect(listRes.status).toBe(200);
    const listBody = await readJson<TenantSummary[]>(listRes);
    expect(listBody.success).toBe(true);
    expect(listBody.data).toHaveLength(2);
    const ids = listBody.data!.map((t) => t.id);
    expect(ids).toContain(SHOP_A.id);
    expect(ids).toContain(SHOP_B.id);

    const switchRes = await api.post('/api/auth/switch-tenant', { tenantId: SHOP_B.id });
    expect(switchRes.status).toBe(200);
    expect((await readJson(switchRes)).success).toBe(true);

    const meRes = await api.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    const meBody = await readJson<{ tenantId: string; shopCode: string }>(meRes);
    expect(meBody.success).toBe(true);
    expect(meBody.data!.tenantId).toBe(SHOP_B.id);
    expect(meBody.data!.shopCode).toBe(SHOP_B.shopCode);
  });
});

describe('POST /api/auth/switch-tenant 非成員（03 §5）', () => {
  it('owner-b 嘗試切到 A 店（非成員）→ 403 AUTH_005', async () => {
    const api = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await api.post('/api/auth/switch-tenant', { tenantId: SHOP_A.id });
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_005');
  });
});
