/**
 * Issue #45：報表與訂單清單下鑽共用同一支「重複旅客」查詢（src/server/guide-report-repeat.ts）。
 * 同一份假資料下：報表的重複旅客 / 筆數 = 訂單清單 repeatCustomers=1 列出的訂單。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ orders: [] as Row[], priorQueries: [] as { tenant: unknown; ids: number; neq: unknown; lt: unknown }[], idQueries: [] as unknown[] }));

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireEntitlement: async () => undefined }));
vi.mock('@/server/tour-orders', () => ({ hydrateTourOrders: async (_s: unknown, _t: unknown, rows: unknown[]) => rows }));
const tenantCtx = () => ({ tenantId: TENANT, businessType: 'GUIDE', supabase: fakeDb });
vi.mock('@/server/tenant', () => ({ requireTenant: async () => tenantCtx(), requireTenantManager: async () => tenantCtx() }));

const fakeDb = {
  from: (table: string) => {
    const f: { eq: [string, unknown][]; neq: [string, unknown][]; gte?: string; lt?: string; ids?: string[]; inCol?: string; gt?: string; lim: number; cols: string } = { eq: [], neq: [], lim: 1e9, cols: '*' };
    const run = (): Row[] => {
      if (table === 'trips') return (f.ids ?? []).map((id) => ({ id, title: id }));
      if (table === 'trip_plans') return (f.ids ?? []).map((id) => ({ id, name: id }));
      if (table !== 'tour_orders') return [];
      if (f.inCol === 'id') state.idQueries.push(f.eq.find(([k]) => k === 'tenant_id')?.[1]);
      if (f.neq.length && f.ids && f.lt && f.gte === undefined) {
        state.priorQueries.push({ tenant: f.eq.find(([k]) => k === 'tenant_id')?.[1], ids: f.ids.length, neq: f.neq[0][1], lt: f.lt });
      }
      return state.orders
        .filter((r) => f.eq.every(([k, v]) => r[k] === v) && f.neq.every(([k, v]) => r[k] !== v))
        .filter((r) => (f.gte === undefined || (r.created_at as string) >= f.gte) && (f.lt === undefined || (r.created_at as string) < f.lt))
        .filter((r) => !f.ids || f.ids.includes(r[f.inCol as string] as string))
        .filter((r) => !f.gt || (r.id as string) > f.gt)
        .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1))
        .slice(0, f.lim);
    };
    const q: Record<string, unknown> = {
      select: (c: string) => { f.cols = c; return q; },
      eq: (k: string, v: unknown) => { f.eq.push([k, v]); return q; },
      neq: (k: string, v: unknown) => { f.neq.push([k, v]); return q; },
      gte: (_k: string, v: string) => { f.gte = v; return q; },
      lt: (_k: string, v: string) => { f.lt = v; return q; },
      gt: (_k: string, v: string) => { f.gt = v; return q; },
      in: (k: string, v: string[]) => { f.ids = v; f.inCol = k; return q; },
      order: () => q,
      limit: (n: number) => { f.lim = n; return q; },
      range: () => q,
      or: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        const rows = run();
        return resolve({ data: rows, error: null, count: rows.length });
      },
    };
    return q;
  },
};

import { GET as reportGET } from '@/app/api/reports/guide/route';
import { fetchPriorCustomers } from '@/server/guide-report-repeat';
import { GET as ordersGET } from '@/app/api/tour-orders/route';

const o = (id: string, customer: string | null, created: string, extra: Row = {}): Row => ({
  id, tenant_id: TENANT, customer_id: customer, created_at: created, status: 'CONFIRMED', trip_id: 't', plan_id: 'p',
  party_size: 1, payment_status: 'PAID', paid_amount: 100, refunded_amount: 0, source: 'LINE', ...extra,
});
const IN = '2026-10-03T02:00:00Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
  state.priorQueries = []; state.idQueries = [];
  state.orders = [
    o('a1', 'A', IN), o('a2', 'A', '2026-10-04T02:00:00Z'),                // A：本期 2 筆 → 重複
    o('b1', 'B', IN), o('b0', 'B', '2026-08-01T02:00:00Z'),               // B：本期 1 筆＋先前有 → 重複
    o('c1', 'C', IN), o('c0', 'C', '2026-08-01T02:00:00Z', { status: 'CANCELLED' }), // C：先前只有取消 → 否
    o('c2', 'C', IN, { tenant_id: OTHER }),                                // 其他租戶，不得影響
    o('d1', 'D', IN, { status: 'CANCELLED' }),                             // D：只有取消 → 不計
    o('n1', null, IN),                                                     // 未綁定
  ];
});

describe('報表與訂單清單下鑽共用重複旅客查詢', () => {
  it('同一份資料：報表 repeat 與 /api/tour-orders?repeatCustomers=1 列出的訂單一致', async () => {
    const rep = (await (await reportGET(new Request('http://t/api/reports/guide?from=2026-10-01&to=2026-10-10'), {})).json()).data;
    expect(rep.repeat).toEqual({ customers: 3, repeatCustomers: 2, repeatOrders: 3, ratePercent: 66.7, unlinkedOrders: 1 });

    const res = await ordersGET(new Request('http://t/api/tour-orders?repeatCustomers=1&createdFrom=2026-10-01&createdTo=2026-10-10'), {});
    const body = (await res.json()).data;
    expect(res.status).toBe(200);
    expect(body.totalElements).toBe(rep.repeat.repeatOrders);
    expect(body.content.map((r: Row) => r.id).sort()).toEqual(['a1', 'a2', 'b1']);
    // 先前查詢：帶 tenant_id、排除 CANCELLED、界線為本期起點（台北 10/01 00:00 = 09-30T16:00Z）、每批 ≤200
    expect(state.priorQueries.length).toBeGreaterThanOrEqual(2);
    for (const q of state.priorQueries) {
      expect(q).toMatchObject({ tenant: TENANT, neq: 'CANCELLED', lt: '2026-09-30T16:00:00.000Z' });
      expect(q.ids).toBeLessThanOrEqual(200);
    }
  });

  it('repeatCustomers 搭配其他篩選仍只列重複旅客的訂單（例如 source）', async () => {
    state.orders.find((r) => r.id === 'a2')!.source = 'MANUAL';
    const body = (await (await ordersGET(new Request('http://t/api/tour-orders?repeatCustomers=1&createdFrom=2026-10-01&createdTo=2026-10-10&source=MANUAL'), {})).json()).data;
    expect(body.content.map((r: Row) => r.id)).toEqual(['a2']);
  });

  it('參數驗證：缺日期、status=CANCELLED 矛盾、planId 非 uuid、activeOnly 非法 → 400', async () => {
    for (const qs of [
      '?repeatCustomers=1', '?repeatCustomers=1&createdFrom=2026-10-01',
      '?activeOnly=1&status=CANCELLED', '?repeatCustomers=1&createdFrom=2026-10-01&createdTo=2026-10-10&status=CANCELLED',
      '?planId=nope', '?activeOnly=yes', '?repeatCustomers=0',
    ]) {
      expect((await ordersGET(new Request(`http://t/api/tour-orders${qs}`), {})).status, qs).toBe(400);
    }
  });

  it('下鑽清單最後以 id 撈整列時一定帶 tenant_id（拿掉就會失敗）', async () => {
    await ordersGET(new Request('http://t/api/tour-orders?repeatCustomers=1&createdFrom=2026-10-01&createdTo=2026-10-10'), {});
    expect(state.idQueries.length).toBeGreaterThan(0);
    for (const t of state.idQueries) expect(t).toBe(TENANT);
  });

  it('分頁與穩定排序：created_at 新到舊，同時間依 id 由大到小；page=1 取第二頁', async () => {
    // a2(10-04) 最新；b1、a1 同為 IN 時間 → id 大者在前：a2, b1, a1
    const get = async (qs: string) => (await (await ordersGET(new Request(`http://t/api/tour-orders?repeatCustomers=1&createdFrom=2026-10-01&createdTo=2026-10-10${qs}`), {})).json()).data;
    expect((await get('&page=0&size=2')).content.map((r: Row) => r.id)).toEqual(['a2', 'b1']);
    const p1 = await get('&page=1&size=2');
    expect(p1.content.map((r: Row) => r.id)).toEqual(['a1']);
    expect(p1.totalElements).toBe(3);
    expect((await get('&page=2&size=2')).content).toEqual([]);
  });

  it('區間內訂單超過 MAX_ROWS → 422 與 REPORT_001（不回傳不完整集合）', async () => {
    state.orders = Array.from({ length: 20001 }, (_, i) => o(`z${String(i).padStart(6, '0')}`, `cust${i}`, IN));
    const res = await ordersGET(new Request('http://t/api/tour-orders?repeatCustomers=1&createdFrom=2026-10-01&createdTo=2026-10-10'), {});
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('REPORT_001');
  });
});

describe('fetchPriorCustomers 只確認存在，不翻完歷史訂單', () => {
  it('1 位旅客有 2500 筆先前訂單＋另一位 1 筆：只查 2 次（不是逐頁翻完 2500 筆），結果兩人都找到', async () => {
    state.orders = [
      ...Array.from({ length: 2500 }, (_, i) => o(`h${String(i).padStart(5, '0')}`, 'X', '2026-08-01T02:00:00Z')),
      o('y1', 'Y', '2026-08-01T02:00:00Z'),
    ];
    state.priorQueries = [];
    const got = await fetchPriorCustomers(fakeDb as never, TENANT, '2026-09-30T16:00:00.000Z', ['X', 'Y', 'Z']);
    expect([...got].sort()).toEqual(['X', 'Y']);
    expect(state.priorQueries.length).toBeLessThanOrEqual(2);
    for (const q of state.priorQueries) expect(q.tenant).toBe(TENANT);
  });
});
