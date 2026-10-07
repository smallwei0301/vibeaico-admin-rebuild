/** 重複旅客候選掃描的防禦性上限：真正的「> MAX_ROWS」邊界（含不滿頁的最後一頁）。 */
import { describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const state = vi.hoisted(() => ({ n: 0 }));

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/tour-orders', () => ({ hydrateTourOrders: async (_s: unknown, _t: unknown, rows: unknown[]) => rows }));
// 重複旅客集合不是這個測試的重點：固定為「全部人都是」，只驗候選掃描本身的上限
vi.mock('@/server/guide-report-repeat', () => ({
  loadRepeatCustomerIds: async () => ({ has: () => true }),
}));
vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ tenantId: TENANT, businessType: 'GUIDE', supabase: fakeDb }),
}));

const fakeDb = {
  from: (table: string) => {
    let gt = '';
    let lim = 1e9;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'or', 'order', 'in', 'range']) q[m] = () => q;
    q.gt = (_k: string, v: string) => { gt = v; return q; };
    q.limit = (x: number) => { lim = x; return q; };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table !== 'tour_orders') return resolve({ data: [], error: null, count: 0 });
      const rows = Array.from({ length: state.n }, (_, i) => ({
        id: `r${String(i).padStart(6, '0')}`, customer_id: `c${i}`, created_at: '2026-10-03T02:00:00Z',
      })).filter((r) => !gt || r.id > gt).slice(0, lim);
      return resolve({ data: rows, error: null, count: rows.length });
    };
    return q;
  },
};

import { GET } from '@/app/api/tour-orders/route';
import { MAX_ROWS } from '@/server/guide-report';

const get = () => GET(new Request('http://t/api/tour-orders?repeatCustomers=1&createdFrom=2026-10-01&createdTo=2026-10-10&size=1'), {});

describe('候選掃描上限', () => {
  it('剛好 MAX_ROWS 列（整頁結尾）成功；MAX_ROWS+1 列（最後一頁不滿）→ 422', async () => {
    state.n = MAX_ROWS;
    expect((await get()).status).toBe(200);
    state.n = MAX_ROWS + 1; // 最後一頁只有 1 列：舊寫法只數整頁，會漏掉這個邊界
    const res = await get();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('REPORT_001');
  });
});
