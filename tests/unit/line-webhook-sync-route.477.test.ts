/**
 * tests/unit/line-webhook-sync-route.477.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/app/api/settings/line/webhook-sync/route.ts`（Issue #477 P1a）：把
 * verify 報告裡「Webhook 沒開啟」從一句提示文案變成一顆真的能修好的按鈕。
 *
 * 這裡守 route 自己加的邏輯（LINE provider 呼叫的真實往返已由既有的
 * `tests/integration/api/line-verify.06.test.ts` 走本地假 LINE server 驗證，
 * 兩者互補）：
 *   1. 必須要求 OWNER（`requireTenant('OWNER')`）。
 *   2. 沒有 Channel Access Token 時，直接回誠實 `synced:false`，完全不呼叫
 *      LINE（不會假裝呼叫過）。
 *   3. `PUT /v2/bot/channel/webhook/endpoint` 失敗 → `synced:false` 且不再往下
 *      呼叫 `setActive`。
 *   4. `PUT /v2/bot/channel/webhook/setActive` 失敗 → `synced:false`，但訊息要
 *      區分「endpoint 已更新、只是開關失敗」，不是整段都沒發生。
 *   5. 兩者皆成功 → `synced:true`，且 endpoint 用 `buildWebhookUrl(APP_URL, shopCode)`
 *      算出來的值，不是憑空字串。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';

type Role = 'STAFF' | 'MANAGER' | 'OWNER';

const TENANT_ID = 'tenant-a';
const SHOP_CODE = 'shop-a';
let currentRole: Role = 'OWNER';
let tokenEnc = 'enc:mock-token';

const fakeSupabase = {
  from(table: string) {
    if (table !== 'tenant_settings') throw new Error(`unexpected table in test: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { line_channel_access_token_enc: tokenEnc },
            error: null,
          }),
        }),
      }),
    };
  },
};

const requireTenantMock = vi.fn(async (minRole: Role = 'STAFF') => {
  const rank: Record<Role, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };
  if (rank[currentRole] < rank[minRole]) {
    throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  }
  return {
    supabase: fakeSupabase,
    tenantId: TENANT_ID,
    shopCode: SHOP_CODE,
    user: { id: 'user-a' },
    role: currentRole,
  };
});

vi.mock('@/server/tenant', () => ({
  requireTenant: (...a: [Role?]) => requireTenantMock(...a),
}));

// handle() 對寫入型請求先經過 withImpersonationAudit()（讀 next/headers 的
// cookies()）——同 traveler-risk-policy-route.44.test.ts 的作法，供一個沒有
// 代登入 cookie 的假實作即可直接放行到 handler。
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

vi.mock('@/server/crypto', () => ({
  decryptSecret: (v: string) => (v === 'enc:mock-token' ? 'plain-token' : ''),
}));

const linePutRawMock = vi.fn();
vi.mock('@/server/line', () => ({
  linePutRaw: (...a: [string, string, unknown?]) => linePutRawMock(...a),
}));

import { POST } from '@/app/api/settings/line/webhook-sync/route';

describe('POST /api/settings/line/webhook-sync（Issue #477 P1a）', () => {
  beforeEach(() => {
    currentRole = 'OWNER';
    tokenEnc = 'enc:mock-token';
    linePutRawMock.mockReset();
  });

  function callRoute() {
    return POST(
      new Request('http://localhost/api/settings/line/webhook-sync', { method: 'POST' }),
      { params: Promise.resolve({}) },
    );
  }

  it('MANAGER 呼叫回 403，不呼叫任何 LINE API', async () => {
    currentRole = 'MANAGER';
    const res = await callRoute();
    expect(res.status).toBe(403);
    expect(linePutRawMock).not.toHaveBeenCalled();
  });

  it('沒有 Channel Access Token → 誠實 synced:false，完全不呼叫 LINE', async () => {
    tokenEnc = '';
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.synced).toBe(false);
    expect(body.data.message).toContain('尚未設定');
    expect(linePutRawMock).not.toHaveBeenCalled();
  });

  it('PUT endpoint 失敗 → synced:false，且不再呼叫 setActive', async () => {
    linePutRawMock.mockResolvedValueOnce({ ok: false, status: 400, body: {} });
    const res = await callRoute();
    const body = await res.json();
    expect(body.data.synced).toBe(false);
    expect(body.data.message).toContain('400');
    expect(linePutRawMock).toHaveBeenCalledTimes(1);
    expect(linePutRawMock).toHaveBeenCalledWith(
      'plain-token',
      '/v2/bot/channel/webhook/endpoint',
      expect.objectContaining({ endpoint: expect.stringContaining(SHOP_CODE) }),
    );
  });

  it('PUT endpoint 成功但 setActive 失敗 → synced:false，訊息說明網址已更新只有開關失敗', async () => {
    linePutRawMock
      .mockResolvedValueOnce({ ok: true, status: 200, body: {} })
      .mockResolvedValueOnce({ ok: false, status: 500, body: {} });
    const res = await callRoute();
    const body = await res.json();
    expect(body.data.synced).toBe(false);
    expect(body.data.message).toContain('已更新');
    expect(body.data.message).toContain('開啟失敗');
    expect(linePutRawMock).toHaveBeenCalledTimes(2);
    expect(linePutRawMock).toHaveBeenNthCalledWith(
      2,
      'plain-token',
      '/v2/bot/channel/webhook/setActive',
      { active: true },
    );
  });

  it('兩個 PUT 都成功 → synced:true，回傳依 shopCode 算出的 endpoint', async () => {
    linePutRawMock
      .mockResolvedValueOnce({ ok: true, status: 200, body: {} })
      .mockResolvedValueOnce({ ok: true, status: 200, body: {} });
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.synced).toBe(true);
    expect(body.data.endpoint).toContain(SHOP_CODE);
    expect(body.data.endpoint).toMatch(/\/api\/line\/webhook\//);
  });
});
