/**
 * 功能閘門整合測試 — 12 分冊 §4「Phase 5/5.5」矩陣 gating.09 列：
 *   「閘門對應表逐條：未訂閱打對應端點 403 FEAT_001；第 4 位員工被擋；…」
 * 契約出處：docs/integration/09-FEATURE-STORE.md §5 閘門對應表 +
 * src/server/features.ts（requireFeature → 403 FEAT_001）。
 *
 * 作法：seed 已給 SHOP_A 全部 18 個付費碼的 GRANTED 列（active、expires_at
 * null）。每條案例用 service role 刪掉該碼的訂閱列 → 打被閘端點斷言 403
 * FEAT_001 → try/finally 內 upsert 還原 GRANTED 基線（onConflict
 * 'tenant_id,code'），不留任何殘留給其他測試檔。
 *
 * ⚠️ 尚無法測的兩條（09 §5 對應表列名但端點屬 Phase 6，尚不存在）：
 *   - KEYWORD_REPLY：/api/settings/line/keyword-replies 寫入端點 + 第 21 組
 *     被擋（409「每店最多 20 組」）
 *   - EXTRA_PUSH：consumePushQuota 額度 200 ↔ 700（06 分冊留的 TODO）
 * 待 Phase 6 端點落地後補進本檔（src/server/features.ts 檔頭也記錄了同一份
 * 未落地清單）。
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

let admin: SupabaseClient;
let ownerA: AuthedApi;

/** 刪掉 SHOP_A 某功能碼的訂閱列（製造「未訂閱」狀態） */
async function deleteSub(code: string): Promise<void> {
  const { error } = await admin
    .from('feature_subscriptions')
    .delete()
    .eq('tenant_id', SHOP_A.id)
    .eq('code', code);
  expect(error).toBeNull();
}

/** 還原 seed 的 GRANTED 基線列（active、expires_at null、source='GRANTED'） */
async function restoreGranted(code: string): Promise<void> {
  const { error } = await admin.from('feature_subscriptions').upsert(
    {
      tenant_id: SHOP_A.id,
      code,
      active: true,
      expires_at: null,
      source: 'GRANTED',
      cancelled_at: null,
    },
    { onConflict: 'tenant_id,code' },
  );
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

describe('SHIFT_MANAGEMENT 閘門（09 §5：/api/shifts* 全部）', () => {
  it('刪訂閱列 → GET /api/shifts?from&to 403 FEAT_001；還原 GRANTED → 200', async () => {
    await deleteSub('SHIFT_MANAGEMENT');
    try {
      const blocked = await ownerA.get('/api/shifts?from=2026-08-01&to=2026-08-31');
      expect(blocked.status).toBe(403);
      const body = await readJson(blocked);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FEAT_001');
      expect(body.message).toBe('此功能尚未訂閱，請至功能商店開通');
    } finally {
      await restoreGranted('SHIFT_MANAGEMENT');
    }

    const ok = await ownerA.get('/api/shifts?from=2026-08-01&to=2026-08-31');
    expect(ok.status).toBe(200);
    expect((await readJson(ok)).success).toBe(true);
  });
});

describe('UNLIMITED_STAFF 閘門（09 §5：免費方案最多 3 位員工）', () => {
  it('未訂閱且 active 員工已達 3 → POST /api/staff 第 4 位 403；還原後成功', async () => {
    // seed 給 SHOP_A 2 位員工（皆 active 預設 true），先用 admin 補到 3 位
    const { count, error: eCnt } = await admin
      .from('staff')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id)
      .eq('active', true);
    expect(eCnt).toBeNull();
    const activeCount = count ?? 0;
    expect(activeCount).toBeLessThanOrEqual(3);

    const paddingIds: string[] = [];
    for (let i = activeCount; i < 3; i++) {
      const id = randomUUID();
      const { error } = await admin.from('staff').insert({
        id,
        tenant_id: SHOP_A.id,
        name: `閘門測試補位員工-${i + 1}`,
        sort_order: 100 + i,
      });
      expect(error).toBeNull();
      paddingIds.push(id);
    }

    let createdByApiId: string | undefined;
    await deleteSub('UNLIMITED_STAFF');
    try {
      // 第 4 位被擋：403 FEAT_001 + 指定文案（09 §5 對應表逐字）
      const blocked = await ownerA.post('/api/staff', { name: '閘門測試第四位員工' });
      expect(blocked.status).toBe(403);
      const body = await readJson(blocked);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FEAT_001');
      expect(body.message).toBe('免費方案最多 3 位員工');

      // 沒有真的被建立
      const { count: after } = await admin
        .from('staff')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', SHOP_A.id)
        .eq('active', true);
      expect(after ?? 0).toBe(3);

      // 還原訂閱 → 同一請求成功
      await restoreGranted('UNLIMITED_STAFF');
      const ok = await ownerA.post('/api/staff', { name: '閘門測試第四位員工' });
      expect(ok.status).toBe(200);
      const okBody = await readJson<{ id: string }>(ok);
      expect(okBody.success).toBe(true);
      createdByApiId = okBody.data!.id;
      expect(createdByApiId).toBeTruthy();
    } finally {
      await restoreGranted('UNLIMITED_STAFF'); // 冪等，保證 403 分支中途失敗也還原
      if (createdByApiId) await admin.from('staff').delete().eq('id', createdByApiId);
      if (paddingIds.length > 0) await admin.from('staff').delete().in('id', paddingIds);
    }
  });
});

describe('BASIC_REPORT 閘門（09 §5：/api/reports/* 除 dashboard 與 dashboard-alerts 外）', () => {
  it('刪訂閱列 → GET /api/reports/summary 403 FEAT_001；dashboard 不受影響 200；還原後 summary 200', async () => {
    await deleteSub('BASIC_REPORT');
    try {
      const blocked = await ownerA.get('/api/reports/summary');
      expect(blocked.status).toBe(403);
      const body = await readJson(blocked);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FEAT_001');

      // dashboard 在例外清單，不掛閘門
      const dashboard = await ownerA.get('/api/reports/dashboard');
      expect(dashboard.status).toBe(200);
      expect((await readJson(dashboard)).success).toBe(true);
    } finally {
      await restoreGranted('BASIC_REPORT');
    }

    const ok = await ownerA.get('/api/reports/summary');
    expect(ok.status).toBe(200);
    expect((await readJson(ok)).success).toBe(true);
  });
});

describe('COUPON_SYSTEM 閘門（09 §5：/api/coupons* 寫入端點；讀取不擋）', () => {
  it('刪訂閱列 → POST /api/coupons 403 FEAT_001；GET /api/coupons 仍 200', async () => {
    await deleteSub('COUPON_SYSTEM');
    try {
      const blocked = await ownerA.post('/api/coupons', {
        name: '閘門測試票券',
        discountType: 'AMOUNT',
        discountValue: 100,
      });
      expect(blocked.status).toBe(403);
      const body = await readJson(blocked);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FEAT_001');

      // 沒有票券被建立
      const { count } = await admin
        .from('coupons')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', SHOP_A.id)
        .eq('name', '閘門測試票券');
      expect(count ?? 0).toBe(0);

      // 讀取端點不在閘門清單（資料保留、對外功能暫停的原站原則）
      const list = await ownerA.get('/api/coupons');
      expect(list.status).toBe(200);
      expect((await readJson(list)).success).toBe(true);
    } finally {
      await restoreGranted('COUPON_SYSTEM');
    }
  });
});

describe('POINT_SYSTEM 閘門（09 §5：apply-points 折抵端點）', () => {
  it('刪訂閱列 → POST /api/bookings/:id/apply-points 403 FEAT_001', async () => {
    await deleteSub('POINT_SYSTEM');
    try {
      const blocked = await ownerA.post(`/api/bookings/${SHOP_A.bookingConfirmed}/apply-points`, {
        points: 1,
      });
      expect(blocked.status).toBe(403);
      const body = await readJson(blocked);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FEAT_001');
    } finally {
      await restoreGranted('POINT_SYSTEM');
    }
  });
});
