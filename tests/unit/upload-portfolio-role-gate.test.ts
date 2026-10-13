import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';

/**
 * /api/upload 的 bucket 最低角色：portfolio-images 要求 MANAGER（與 /api/portfolios 寫入一致），
 * STAFF 直接 POST 必須在任何 storage 寫入之前得到 403；其他 bucket 維持 STAFF 可上傳。
 */
const state = vi.hoisted(() => ({
  role: 'STAFF' as 'STAFF' | 'MANAGER' | 'OWNER' | null,
  upload: vi.fn(),
}));

vi.mock('@/server/tenant', () => ({
  requireTenant: vi.fn(async (minRole: 'STAFF' | 'MANAGER' | 'OWNER' = 'STAFF') => {
    const rank = { STAFF: 0, MANAGER: 1, OWNER: 2 } as const;
    if (!state.role) throw new ApiHttpError(401, '請先登入', ERR.UNAUTHORIZED);
    if (rank[state.role] < rank[minRole]) throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
    return { tenantId: 'tenant-1', role: state.role };
  }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    storage: {
      from: () => ({
        upload: state.upload,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  }),
}));

import { POST } from '@/app/api/upload/route';

const post = (bucket: string) => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
  form.set('bucket', bucket);
  return POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }) as never, { params: Promise.resolve({}) });
};

describe('POST /api/upload bucket minimum role', () => {
  beforeEach(() => {
    state.role = 'STAFF';
    state.upload.mockReset().mockResolvedValue({ error: null });
  });

  it('STAFF + portfolio-images → 403 and no storage write', async () => {
    const res = await post('portfolio-images');
    expect(res.status).toBe(403);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it.each(['MANAGER', 'OWNER'] as const)('%s + portfolio-images → ok', async (role) => {
    state.role = role;
    const res = await post('portfolio-images');
    expect(res.status).toBe(200);
    expect(state.upload).toHaveBeenCalledTimes(1);
  });

  it('STAFF + product-images stays allowed', async () => {
    const res = await post('product-images');
    expect(res.status).toBe(200);
    expect(state.upload).toHaveBeenCalledTimes(1);
  });

  it('unauthenticated → 401 (before any bucket handling)', async () => {
    state.role = null;
    const res = await post('portfolio-images');
    expect(res.status).toBe(401);
    expect(state.upload).not.toHaveBeenCalled();
  });
});
