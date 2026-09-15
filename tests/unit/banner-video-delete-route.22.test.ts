/**
 * tests/unit/banner-video-delete-route.22.test.ts
 * -----------------------------------------------------------------------------
 * 守 `DELETE /api/settings/shop-page/banner-video`（Issue #22 Part A）：honest
 * failure——Storage 刪除失敗時**不得**回傳 success:true；cross-tenant 隔離
 * （URL 不屬於自己租戶不會被誤刪）；沒有影片時是安全的 no-op。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const TENANT_ID = 'tenant-a';
const SUPABASE_ORIGIN = 'https://storage.example';

let brandingRow: Record<string, unknown> = {};
const upsertMock = vi.fn(async (_payload: Record<string, unknown>) => ({ error: null as { message: string } | null }));
const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const updatePendingChain = { eq: () => ({ eq: async () => ({ error: null }) }) };

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
  storage: { from: () => ({ remove: removeMock }) },
  from: vi.fn((table: string) => {
    if (table !== 'banner_video_pending_uploads') throw new Error(`unexpected table: ${table}`);
    return { update: () => updatePendingChain };
  }),
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

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

import { DELETE } from '@/app/api/settings/shop-page/banner-video/route';

function makeDeleteRequest() {
  return new Request('http://localhost/api/settings/shop-page/banner-video', { method: 'DELETE' });
}

describe('DELETE /api/settings/shop-page/banner-video（issue #22）', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
    brandingRow = {};
    upsertMock.mockClear();
    removeMock.mockClear();
  });

  afterAll(() => {
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  });

  it('沒有 bannerVideoUrl 時是安全的 no-op：{removed:false}，不呼叫 Storage', async () => {
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ removed: false });
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('成功刪除：先清 DB 參照，Storage 也刪除成功 → {removed:true}', async () => {
    brandingRow = {
      bannerVideoUrl: `${SUPABASE_ORIGIN}/storage/v1/object/public/banner-videos/${TENANT_ID}/banner-video/a.mp4`,
    };
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ removed: true });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const written = upsertMock.mock.calls[0][0] as { branding: { bannerVideoUrl: string } };
    expect(written.branding.bannerVideoUrl).toBe('');
    expect(removeMock).toHaveBeenCalledWith([`${TENANT_ID}/banner-video/a.mp4`]);
  });

  it('honest failure：Storage 刪除失敗時整個請求回 success:false，絕不假裝乾淨', async () => {
    brandingRow = {
      bannerVideoUrl: `${SUPABASE_ORIGIN}/storage/v1/object/public/banner-videos/${TENANT_ID}/banner-video/a.mp4`,
    };
    removeMock.mockResolvedValueOnce({ error: { message: 'storage unavailable' } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status).not.toBe(200);
    expect(body.success).toBe(false);
    // DB 參照仍已經清空（本輪設計選擇：見 route 檔頭），但回應絕不能是 success:true。
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it('cross-tenant：URL 不屬於自己租戶（別的 tenantId 前綴）不會嘗試刪除該物件', async () => {
    brandingRow = {
      bannerVideoUrl: `${SUPABASE_ORIGIN}/storage/v1/object/public/banner-videos/tenant-b/banner-video/evil.mp4`,
    };
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ removed: false });
    expect(removeMock).not.toHaveBeenCalled();
  });
});
