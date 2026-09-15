/**
 * tests/unit/banner-video-confirm-route.22.test.ts
 * -----------------------------------------------------------------------------
 * 守 `POST /api/settings/shop-page/banner-video/confirm`（Issue #22 Part A）：
 * 重新驗證 Storage 真實 metadata（不是相信用戶端）、cross-tenant confirm 攻擊
 * 被擋（path 前綴不符／pending row 查無）、只有驗證通過才寫入
 * `branding.bannerVideoUrl`。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TENANT_ID = 'tenant-a';

let brandingRow: Record<string, unknown> = {};
let pendingRows: { id: string; tenant_id: string; storage_path: string }[] = [];
let storageEntries: { name: string; metadata?: { size: number; mimetype: string } }[] = [];

const upsertMock = vi.fn(async (_payload: Record<string, unknown>) => ({ error: null as { message: string } | null }));
const listMock = vi.fn(async (_dir: string, opts: { search?: string }) => ({
  data: storageEntries.filter((e) => !opts.search || e.name === opts.search),
  error: null as { message: string } | null,
}));
const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const updatePendingMock = vi.fn((_payload: Record<string, unknown>) => ({
  eq: async () => ({ error: null as { message: string } | null }),
}));

function fakeSessionSupabase() {
  return {
    from: (table: string) => {
      if (table !== 'tenant_settings') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { branding: brandingRow }, error: null }),
          }),
        }),
        upsert: upsertMock,
      };
    },
  };
}

const fakeAdminSupabase = {
  from: vi.fn((table: string) => {
    if (table !== 'banner_video_pending_uploads') throw new Error(`unexpected table: ${table}`);
    return {
      select: () => ({
        eq: (col: string, val: string) => ({
          eq: (col2: string, val2: string) => ({
            maybeSingle: async () => {
              const row = pendingRows.find(
                (r) =>
                  (col === 'tenant_id' ? r.tenant_id === val : r.storage_path === val) &&
                  (col2 === 'tenant_id' ? r.tenant_id === val2 : r.storage_path === val2),
              );
              return { data: row ?? null, error: null as { message: string } | null };
            },
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => updatePendingMock(payload),
    };
  }),
  storage: {
    from: () => ({
      list: listMock,
      remove: removeMock,
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://storage.example/storage/v1/object/public/banner-videos/${path}` },
      }),
    }),
  },
};

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => fakeAdminSupabase,
}));

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: fakeSessionSupabase(), tenantId: TENANT_ID, user: { id: 'u1' } }),
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

import { POST } from '@/app/api/settings/shop-page/banner-video/confirm/route';

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/settings/shop-page/banner-video/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/settings/shop-page/banner-video/confirm（issue #22）', () => {
  beforeEach(() => {
    brandingRow = {};
    pendingRows = [{ id: 'row-1', tenant_id: TENANT_ID, storage_path: `${TENANT_ID}/banner-video/a.mp4` }];
    storageEntries = [{ name: 'a.mp4', metadata: { size: 1024, mimetype: 'video/mp4' } }];
    upsertMock.mockClear();
    listMock.mockClear();
    removeMock.mockClear();
    updatePendingMock.mockClear();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it('合法上傳：驗證通過後把 bannerVideoUrl 寫入 branding 並回傳合併結果', async () => {
    const res = await POST(makeRequest({ path: `${TENANT_ID}/banner-video/a.mp4` }), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.bannerVideoUrl).toContain(`${TENANT_ID}/banner-video/a.mp4`);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const written = upsertMock.mock.calls[0][0] as { branding: { bannerVideoUrl: string } };
    expect(written.branding.bannerVideoUrl).toContain('a.mp4');
  });

  it('物件不存在於 Storage（尚未真的上傳完成）→ 404，不寫入 branding', async () => {
    storageEntries = [];
    const res = await POST(makeRequest({ path: `${TENANT_ID}/banner-video/a.mp4` }), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('真實 mimetype 與白名單不符（即使副檔名看起來對）→ 400，不寫入 branding', async () => {
    storageEntries = [{ name: 'a.mp4', metadata: { size: 1024, mimetype: 'application/octet-stream' } }];
    const res = await POST(makeRequest({ path: `${TENANT_ID}/banner-video/a.mp4` }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('真實 size 超過 50MiB → 400，不寫入 branding', async () => {
    storageEntries = [
      { name: 'a.mp4', metadata: { size: 50 * 1024 * 1024 + 1, mimetype: 'video/mp4' } },
    ];
    const res = await POST(makeRequest({ path: `${TENANT_ID}/banner-video/a.mp4` }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('cross-tenant：path 前綴不是自己租戶 → 403，完全不查 Storage／不寫入', async () => {
    const res = await POST(makeRequest({ path: 'tenant-b/banner-video/evil.mp4' }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('path 前綴正確但 pending upload 查無此列（例如猜到別人前綴後自己編一個路徑）→ 404', async () => {
    pendingRows = []; // 沒有任何 presign 記錄
    const res = await POST(makeRequest({ path: `${TENANT_ID}/banner-video/never-presigned.mp4` }), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('替換舊影片時 best-effort 清掉舊物件（清理失敗不影響本次確認結果）', async () => {
    brandingRow = {
      bannerVideoUrl: `https://storage.example/storage/v1/object/public/banner-videos/${TENANT_ID}/banner-video/old.mp4`,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example';
    removeMock.mockResolvedValueOnce({ error: { message: 'boom' } });
    const res = await POST(makeRequest({ path: `${TENANT_ID}/banner-video/a.mp4` }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith([`${TENANT_ID}/banner-video/old.mp4`]);
  });
});
