/**
 * tests/unit/banner-video-presign-route.22.test.ts
 * -----------------------------------------------------------------------------
 * 守 `POST /api/settings/shop-page/banner-video/presign`（Issue #22 Part A）：
 * MIME／大小驗證、伺服器端組路徑（用戶端無法指定或影響）、寫入
 * `banner_video_pending_uploads` 追蹤列、MANAGER 權限。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';

type Role = 'STAFF' | 'MANAGER' | 'OWNER';
const TENANT_ID = 'tenant-a';
let currentRole: Role = 'MANAGER';

const createSignedUploadUrlMock = vi.fn(async (path: string) => ({
  data: { signedUrl: `https://storage.example/upload/sign/${path}?token=tok`, path, token: 'tok' },
  error: null as { message: string } | null,
}));
const insertMock = vi.fn(async (_payload: Record<string, unknown>) => ({ error: null as { message: string } | null }));

const fakeAdminSupabase = {
  storage: { from: () => ({ createSignedUploadUrl: createSignedUploadUrlMock }) },
  from: vi.fn((table: string) => {
    if (table !== 'banner_video_pending_uploads') throw new Error(`unexpected table: ${table}`);
    return { insert: insertMock };
  }),
};

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => fakeAdminSupabase,
}));

const requireTenantMock = vi.fn(async (minRole: Role = 'STAFF') => {
  const rank: Record<Role, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };
  if (rank[currentRole] < rank[minRole]) throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  return { supabase: {}, tenantId: TENANT_ID, user: { id: 'user-a' }, role: currentRole };
});

vi.mock('@/server/tenant', () => ({
  requireTenant: (minRole?: Role) => requireTenantMock(minRole),
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

import { POST } from '@/app/api/settings/shop-page/banner-video/presign/route';

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/settings/shop-page/banner-video/presign', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/settings/shop-page/banner-video/presign（issue #22）', () => {
  beforeEach(() => {
    currentRole = 'MANAGER';
    createSignedUploadUrlMock.mockClear();
    insertMock.mockClear();
  });

  it('合法請求：回傳伺服器組出的 tenant 前綴路徑，並記一列 pending upload', async () => {
    const res = await POST(makeRequest({ contentType: 'video/mp4', sizeBytes: 1024 }), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.path.startsWith(`${TENANT_ID}/banner-video/`)).toBe(true);
    expect(body.data.path.endsWith('.mp4')).toBe(true);
    expect(body.data.signedUrl).toContain('token=tok');
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ tenant_id: TENANT_ID });
  });

  it('拒絕不在白名單的 MIME（400 REQ_001），不呼叫 Storage／不寫追蹤列', async () => {
    const res = await POST(makeRequest({ contentType: 'video/quicktime', sizeBytes: 1024 }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('REQ_001');
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('拒絕超過 50MiB 的宣稱大小', async () => {
    const res = await POST(makeRequest({ contentType: 'video/mp4', sizeBytes: 50 * 1024 * 1024 + 1 }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
  });

  it('用戶端無法指定路徑——請求 body 沒有 path 欄位可傳，回傳的 path 永遠是伺服器產生的', async () => {
    const res1 = await POST(makeRequest({ contentType: 'video/mp4', sizeBytes: 100 }), { params: Promise.resolve({}) });
    const res2 = await POST(makeRequest({ contentType: 'video/mp4', sizeBytes: 100 }), { params: Promise.resolve({}) });
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.data.path).not.toBe(body2.data.path);
  });

  it('STAFF 角色不足以呼叫（需要 MANAGER）→ 403', async () => {
    currentRole = 'STAFF';
    const res = await POST(makeRequest({ contentType: 'video/mp4', sizeBytes: 100 }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });
});
