import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 推播發送：LINE image message 只收 https；非 https 的 imageUrl 只送文字，不組圖片訊息。 */
const state = vi.hoisted(() => ({ imageUrl: '' as string, multicast: vi.fn() }));

vi.mock('@/server/tenant', () => ({
  requireTenant: vi.fn(async () => {
    const mk = (table: string): any => {
      const b: any = {};
      for (const m of ['select', 'update', 'eq', 'in', 'not', 'contains']) b[m] = () => b;
      const result = () => {
        if (table === 'marketing_pushes')
          return { data: { id: 'p1', status: 'DRAFT', content: { text: 'hi', imageUrl: state.imageUrl }, audience: { type: 'ALL' } }, error: null };
        return { data: null, error: null };
      };
      b.maybeSingle = async () => result();
      b.then = (res: any) =>
        res(table === 'line_users' ? { data: [{ line_user_id: 'U1' }], error: null } : { data: null, error: null });
      return b;
    };
    return { tenantId: 't1', role: 'MANAGER', supabase: { from: mk } };
  }),
}));

vi.mock('@/server/line', () => ({
  consumePushQuota: vi.fn(async () => true),
  getLineCredentials: vi.fn(async () => ({ token: 'tok' })),
  lineMulticast: (...a: unknown[]) => state.multicast(...a),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { POST } from '@/app/api/marketing/pushes/[id]/send/route';

const send = () =>
  POST(new Request('http://localhost/x', { method: 'POST' }) as never, { params: Promise.resolve({ id: 'p1' }) });

describe('POST /api/marketing/pushes/:id/send 圖片訊息', () => {
  beforeEach(() => state.multicast.mockReset().mockResolvedValue(undefined));

  it('https 圖片 → 文字 + 圖片兩則', async () => {
    state.imageUrl = 'https://cdn.test/a.png';
    const res = await send();
    expect(res.status).toBe(200);
    const messages = state.multicast.mock.calls[0][2];
    expect(messages.map((m: any) => m.type)).toEqual(['text', 'image']);
  });

  it.each(['http://cdn.test/a.png', 'blob:http://localhost/x', 'cover.png', 'https://cdn.test/a.webp', 'https://cdn.test/A.WEBP?v=1#x'])('%s → 只送文字', async (url) => {
    state.imageUrl = url;
    const res = await send();
    expect(res.status).toBe(200);
    const messages = state.multicast.mock.calls[0][2];
    expect(messages.map((m: any) => m.type)).toEqual(['text']);
  });
});
