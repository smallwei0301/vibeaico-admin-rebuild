import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const state = vi.hoisted(() => ({
  denied: false,
  calls: [] as { table: string; filters: Record<string, unknown>; gte?: unknown; lt?: unknown }[],
  orders: [] as Record<string, unknown>[],
  timezone: undefined as string | undefined,
}));

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireEntitlement: async () => undefined }));
vi.mock('@/server/tenant', () => ({
  requireTenantManager: async () => {
    if (state.denied) {
      const { ApiHttpError } = await import('@/server/http');
      throw new ApiHttpError(403, '權限不足', 'FORBIDDEN');
    }
    return { tenantId: TENANT, businessType: 'GUIDE', supabase: fakeDb };
  },
}));

const fakeDb = {
  from: (table: string) => {
    const call: { table: string; filters: Record<string, unknown>; gte?: unknown; lt?: unknown } = { table, filters: {} };
    state.calls.push(call);
    let from = 0;
    let to = 999;
    const rowsFor = () => {
      if (table === 'tenant_settings') return [];
      if (table === 'tour_orders') {
        return state.orders.filter((r) => r.tenant_id === call.filters.tenant_id
          && (r.created_at as string) >= (call.gte as string) && (r.created_at as string) < (call.lt as string));
      }
      if (table === 'trips') return [{ id: 'tA', title: '甲行程' }];
      if (table === 'trip_plans') return [{ id: 'pA', name: '甲方案' }];
      return [];
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { call.filters[k] = v; return q; },
      in: () => q,
      gte: (_k: string, v: unknown) => { call.gte = v; return q; },
      lt: (_k: string, v: unknown) => { call.lt = v; return q; },
      order: () => q,
      range: (a: number, b: number) => { from = a; to = b; return q; },
      maybeSingle: async () => ({
        data: table === 'tenant_settings' && state.timezone ? { basic: { timezone: state.timezone } } : null, error: null,
      }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rowsFor().slice(from, to + 1), error: null }),
    };
    return q;
  },
};

import { GET } from '@/app/api/reports/guide/route';
import { MAX_ROWS } from '@/server/guide-report';

const order = (o: Record<string, unknown>) => ({
  trip_id: 'tA', plan_id: 'pA', party_size: 2, status: 'COMPLETED', payment_status: 'PAID',
  paid_amount: 1000, refunded_amount: 0, ...o,
});

beforeEach(() => {
  state.denied = false; state.calls = []; state.timezone = undefined;
  state.orders = [
    order({ id: 'a1', tenant_id: TENANT, created_at: '2026-10-02T02:00:00Z' }),
    order({ id: 'b1', tenant_id: OTHER, created_at: '2026-10-02T02:00:00Z', paid_amount: 777777 }),
  ];
});

const get = (qs: string) => GET(new Request(`http://t/api/reports/guide${qs}`), {});

describe('GET /api/reports/guide', () => {
  it('每一個查詢都帶 tenant_id，且看不到其他租戶訂單', async () => {
    const res = await get('?from=2026-10-01&to=2026-10-10');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.summary.totalOrders).toBe(1);
    expect(body.data.summary.revenue).toBe(1000);
    expect(state.calls.length).toBeGreaterThanOrEqual(4);
    for (const c of state.calls) expect(c.filters.tenant_id).toBe(TENANT);
    expect(state.calls.map((c) => c.table)).toEqual(expect.arrayContaining(['tenant_settings', 'tour_orders', 'trips', 'trip_plans']));
  });

  it('查詢區間含上一等長期間：from 為台北 09/21 00:00（20:00Z）… to 為 10/11 00:00（16:00Z）', async () => {
    await get('?from=2026-10-01&to=2026-10-10');
    const oc = state.calls.find((c) => c.table === 'tour_orders')!;
    expect(oc.gte).toBe('2026-09-20T16:00:00.000Z');
    expect(oc.lt).toBe('2026-10-10T16:00:00.000Z');
  });

  it('正常筆數 truncated=false；筆數達上限仍有資料 → truncated=true（不假裝完整）', async () => {
    expect((await (await get('?from=2026-10-01&to=2026-10-10')).json()).data.truncated).toBe(false);
    state.orders = Array.from({ length: MAX_ROWS + 5 }, (_, i) =>
      order({ id: `x${i}`, tenant_id: TENANT, created_at: '2026-10-02T02:00:00Z' }));
    const body = await (await get('?from=2026-10-01&to=2026-10-10')).json();
    expect(body.data.truncated).toBe(true);
    expect(body.data.summary.totalOrders).toBe(MAX_ROWS);
  });

  it('非 manager 被拒（403），且不查任何表', async () => {
    state.denied = true;
    const res = await get('?from=2026-10-01&to=2026-10-10');
    expect(res.status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });

  it('日期格式錯誤與結束早於開始皆 400', async () => {
    expect((await get('?from=2026-1-1&to=2026-10-10')).status).toBe(400);
    expect((await get('?from=2026-10-10&to=2026-10-01')).status).toBe(400);
  });

  it('使用租戶時區（basic.timezone）決定日界線', async () => {
    state.timezone = 'America/New_York';
    await get('?from=2026-10-01&to=2026-10-10');
    const oc = state.calls.find((c) => c.table === 'tour_orders')!;
    expect(oc.lt).toBe('2026-10-11T04:00:00.000Z');
  });
});
