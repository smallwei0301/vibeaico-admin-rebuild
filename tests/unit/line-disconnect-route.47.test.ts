/**
 * tests/unit/line-disconnect-route.47.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/app/api/settings/line/disconnect/route.ts`（Issue #47）：這支路由存在
 * 且邏輯正確（requireTenant('OWNER')、清空 line_channel_secret_enc／
 * line_channel_access_token_enc／line jsonb 的 channelId），但在本次修正前**沒有
 * 任何前端呼叫端、也沒有任何測試**——`src/app/tenant/line-settings/page.tsx` 的
 * 「解除連線」按鈕改呼叫 `saveLineSettings({ channelSecret: '', ... })`，而
 * `PUT /api/settings/line`（06 分冊鐵則 6）把空字串定義成「不動舊值」：
 * 呼叫端以為秘密被清空了，`line_channel_secret_enc`／`line_channel_access_token_enc`
 * 在資料庫裡其實原封不動。這裡守 route 本身的行為，避免下一次改動再次讓「解除
 * 連線」變成一個安靜的謊言；前端接線改由
 * `tests/unit/line-settings-disconnect-wiring.47.test.ts` 靜態守住。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';

type Role = 'STAFF' | 'MANAGER' | 'OWNER';

const TENANT_ID = 'tenant-a';
let currentRole: Role = 'OWNER';
let currentLineJsonb: Record<string, unknown> = {
  channelId: 'old-channel-id',
  richMenuTheme: 'LINE_GREEN',
};

const upsertMock = vi.fn(async (_payload: Record<string, any>) => ({ error: null }));

const fakeSupabase = {
  from(table: string) {
    if (table !== 'tenant_settings') throw new Error(`unexpected table in test: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { line: currentLineJsonb }, error: null }),
        }),
      }),
      upsert: upsertMock,
    };
  },
};

const requireTenantMock = vi.fn(async (minRole: Role = 'STAFF') => {
  const rank: Record<Role, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };
  if (rank[currentRole] < rank[minRole]) {
    throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  }
  return { supabase: fakeSupabase, tenantId: TENANT_ID, user: { id: 'user-a' }, role: currentRole };
});

vi.mock('@/server/tenant', () => ({
  requireTenant: (...a: [Role?]) => requireTenantMock(...a),
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

import { POST } from '@/app/api/settings/line/disconnect/route';

describe('POST /api/settings/line/disconnect（Issue #47）', () => {
  beforeEach(() => {
    currentRole = 'OWNER';
    currentLineJsonb = {
      channelId: 'old-channel-id',
      richMenuTheme: 'LINE_GREEN',
    };
    upsertMock.mockClear();
  });

  function callRoute() {
    return POST(
      new Request('http://localhost/api/settings/line/disconnect', { method: 'POST' }),
      { params: Promise.resolve({}) },
    );
  }

  it('MANAGER 呼叫回 403，不寫入任何 upsert', async () => {
    currentRole = 'MANAGER';
    const res = await callRoute();
    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('OWNER 呼叫 → 清空兩個 *_enc 欄位為空字串，line jsonb 的 channelId 清空但保留其他外觀設定', async () => {
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const payload = upsertMock.mock.calls[0][0];
    expect(payload.line_channel_secret_enc).toBe('');
    expect(payload.line_channel_access_token_enc).toBe('');
    expect(payload.line.channelId).toBe('');
    // 其餘外觀設定（Rich Menu 主題等）不因解除連線被清掉。
    expect(payload.line.richMenuTheme).toBe('LINE_GREEN');
  });

  it('即使 line jsonb 歷史誤存過 secret 欄位，也一併清掉', async () => {
    currentLineJsonb = { channelId: 'x', channelSecret: 'leaked', channelAccessToken: 'leaked' };
    await callRoute();
    const payload = upsertMock.mock.calls[0][0];
    expect(payload.line.channelSecret).toBeUndefined();
    expect(payload.line.channelAccessToken).toBeUndefined();
  });
});
