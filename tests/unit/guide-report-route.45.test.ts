import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const state = vi.hoisted(() => ({
  denied: false,
  calls: [] as { table: string; filters: Record<string, unknown>; gte?: unknown; lt?: unknown; lte?: unknown; neq?: unknown }[],
  orders: [] as Record<string, unknown>[],
  timezone: undefined as string | undefined,
  pages: [] as { gt: unknown; limit: number }[],
  inCalls: [] as { table: string; size: number; tenant: unknown }[],
  nameError: '' as string,
  priorError: false,
  departures: [] as Record<string, unknown>[],
  depError: false as boolean | string,
  priorCalls: [] as { tenant: unknown; neq: unknown; lt: unknown; ids: string[] }[],
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
    const call: { table: string; filters: Record<string, unknown>; gte?: unknown; lt?: unknown; lte?: unknown; neq?: unknown } = { table, filters: {} };
    state.calls.push(call);
    let ids: string[] | undefined;
    let gtId: string | undefined;
    let lim = Infinity;
    const rowsFor = () => {
      if (table === 'tenant_settings') return [];
      if (table === 'tour_orders' && call.gte === undefined) { // 「本期之前」查詢：只回 customer_id
        state.priorCalls.push({ tenant: call.filters.tenant_id, neq: call.neq, lt: call.lt, ids: ids ?? [] });
        return state.orders.filter((r) => r.tenant_id === call.filters.tenant_id && r.status !== call.neq
          && (r.created_at as string) < (call.lt as string) && ids?.includes(r.customer_id as string))
          .map((r) => ({ id: r.id, customer_id: r.customer_id }));
      }
      if (table === 'tour_orders') {
        return state.orders.filter((r) => r.tenant_id === call.filters.tenant_id
          && (r.created_at as string) >= (call.gte as string) && (r.created_at as string) < (call.lt as string));
      }
      if (table === 'trip_departures') {
        return state.departures.filter((r) => r.tenant_id === call.filters.tenant_id
          && (r.departs_on as string) >= (call.gte as string) && (r.departs_on as string) <= (call.lte as string));
      }
      if (table === 'trips') return (ids ?? ['tA']).map((id) => ({ id, title: `行程${id}` }));
      if (table === 'trip_plans') return (ids ?? ['pA']).map((id) => ({ id, name: `方案${id}` }));
      return [];
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { call.filters[k] = v; return q; },
      in: (_k: string, v: string[]) => {
        ids = v;
        state.inCalls.push({ table, size: v.length, tenant: call.filters.tenant_id });
        return q;
      },
      gte: (_k: string, v: unknown) => { call.gte = v; return q; },
      lt: (_k: string, v: unknown) => { call.lt = v; return q; },
      lte: (_k: string, v: unknown) => { call.lte = v; return q; },
      neq: (_k: string, v: unknown) => { call.neq = v; return q; },
      order: () => q,
      gt: (_k: string, v: string) => { gtId = v; return q; },
      limit: (n: number) => {
        lim = n;
        if (table === 'tour_orders') state.pages.push({ gt: gtId, limit: n });
        return q;
      },
      maybeSingle: async () => ({
        data: table === 'tenant_settings' && state.timezone ? { basic: { timezone: state.timezone } } : null, error: null,
      }),
      then: (resolve: (v: unknown) => unknown) => resolve(
        (table === state.nameError || (state.depError && table === 'trip_departures') || (state.priorError && table === 'tour_orders' && call.gte === undefined))
          ? { data: null, error: Object.assign(new Error('failed'), typeof state.depError === 'string' && table === 'trip_departures' ? { code: state.depError } : {}) }
          : { data: rowsFor().filter((r) => !gtId || (r.id as string) > gtId).sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1)).slice(0, lim), error: null }),
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

// 固定「現在」晚於所有測試區間，讓讀取上界 = 本期終點（上界取 min 另有專屬測試）
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
  state.denied = false; state.calls = []; state.inCalls = []; state.pages = []; state.nameError = ''; state.priorError = false; state.priorCalls = []; state.departures = []; state.depError = false; state.timezone = undefined;
  state.orders = [
    order({ id: 'a1', tenant_id: TENANT, created_at: '2026-10-02T02:00:00Z' }),
    order({ id: 'b1', tenant_id: OTHER, created_at: '2026-10-02T02:00:00Z', paid_amount: 777777 }),
  ];
});

afterEach(() => { vi.useRealTimers(); });

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

  const many = (n: number) => Array.from({ length: n }, (_, i) =>
    order({ id: `x${String(i).padStart(6, '0')}`, tenant_id: TENANT, created_at: '2026-10-02T02:00:00Z' }));

  it('少量資料 truncated=false', async () => {
    expect((await (await get('?from=2026-10-01&to=2026-10-10')).json()).data.truncated).toBe(false);
  });

  it('剛好 MAX_ROWS 筆 → truncated=false，全數計入', async () => {
    state.orders = many(MAX_ROWS);
    const body = await (await get('?from=2026-10-01&to=2026-10-10')).json();
    expect(body.data.truncated).toBe(false);
    expect(body.data.summary.totalOrders).toBe(MAX_ROWS);
  });

  it('MAX_ROWS+1 筆 → truncated=true，只計前 MAX_ROWS 筆', async () => {
    state.orders = many(MAX_ROWS + 1);
    const body = await (await get('?from=2026-10-01&to=2026-10-10')).json();
    expect(body.data.truncated).toBe(true);
    expect(body.data.summary.totalOrders).toBe(MAX_ROWS);
  });

  it('keyset 分頁：第一頁不帶 gt，之後 gt 為上一頁最後一筆 id，每頁 limit 1000', async () => {
    state.orders = many(2500);
    await get('?from=2026-10-01&to=2026-10-10');
    expect(state.pages).toEqual([
      { gt: undefined, limit: 1000 },
      { gt: 'x000999', limit: 1000 },
      { gt: 'x001999', limit: 1000 },
    ]);
  });

  it('剛好 MAX_ROWS 筆的探測使用 gt lastId 與 limit 1', async () => {
    state.orders = many(MAX_ROWS);
    await get('?from=2026-10-01&to=2026-10-10');
    expect(state.pages[state.pages.length - 1]).toEqual({ gt: `x${String(MAX_ROWS - 1).padStart(6, '0')}`, limit: 1 });
  });

  it('讀取上界取 min(本期終點, 請求開始時間)；asOf 回傳請求開始時間', async () => {
    try {
      vi.setSystemTime(new Date('2026-10-05T00:00:00Z')); // 台北 10/05 08:00，本期終點（10/05 24:00 台北）在其後
      const body = await (await get('?from=2026-10-01&to=2026-10-05')).json();
      const orders = state.calls.filter((c) => c.table === 'tour_orders');
      expect(orders.length).toBeGreaterThan(0);
      for (const c of orders) expect(c.lt).toBe('2026-10-05T00:00:00.000Z'); // 請求時間早於本期終點 → 取請求時間
      expect(body.data.asOf).toBe('2026-10-05T00:00:00.000Z');
      // 請求時間晚於本期終點時，上界仍是本期終點
      state.calls = [];
      vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
      await get('?from=2026-10-01&to=2026-10-10');
      for (const c of state.calls.filter((x) => x.table === 'tour_orders')) expect(c.lt).toBe('2026-10-10T16:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('名稱查詢分批：450 個行程／方案 id → 各 3 批（200/200/50），每批帶 tenant_id，名稱不退回 UUID', async () => {
    state.orders = Array.from({ length: 450 }, (_, i) =>
      order({ id: `n${i}`, tenant_id: TENANT, trip_id: `t${i}`, plan_id: `p${i}`, created_at: '2026-10-02T02:00:00Z' }));
    const body = await (await get('?from=2026-10-01&to=2026-10-10')).json();
    const sizes = (table: string) => state.inCalls.filter((c) => c.table === table).map((c) => c.size);
    expect(sizes('trips')).toEqual([200, 200, 50]);
    expect(sizes('trip_plans')).toEqual([200, 200, 50]);
    for (const c of state.inCalls) expect(c.tenant).toBe(TENANT);
    expect(body.data.ranking.plan.orders[0].name).toMatch(/^方案p/);
  });

  it('任一批名稱查詢失敗 → 500，不靜默', async () => {
    state.nameError = 'trip_plans';
    const res = await get('?from=2026-10-01&to=2026-10-10');
    expect(res.status).toBe(500);
  });

  it('非 manager 被拒（403），且不查任何表', async () => {
    state.denied = true;
    const res = await get('?from=2026-10-01&to=2026-10-10');
    expect(res.status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });

  it('to 或 from 晚於店家時區今天 → 400；to = 今天 → 正常（系統時間固定 2026-12-01 台北）', async () => {
    expect((await get('?from=2026-11-20&to=2026-12-02')).status).toBe(400);
    expect((await get('?from=2026-12-02&to=2026-12-02')).status).toBe(400);
    expect((await get('?from=2026-11-20&to=2026-12-01')).status).toBe(200);
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

  it('重複旅客先前訂單查詢：以 customer_id 分批 200、帶 tenant_id、排除取消、界線為本期開始（台北 10/01 00:00 = 09-30T16:00Z）', async () => {
    // 450 位本期旅客各 1 筆；其中 c0、c449 在本期前有非取消訂單，c1 只有取消的先前訂單
    state.orders = [
      ...Array.from({ length: 450 }, (_, i) => order({
        id: `n${i}`, tenant_id: TENANT, customer_id: `c${i}`, trip_id: 't', plan_id: 'p', created_at: '2026-10-02T02:00:00Z',
      })),
      order({ id: 'p0', tenant_id: TENANT, customer_id: 'c0', created_at: '2026-08-01T02:00:00Z' }),
      order({ id: 'p449', tenant_id: TENANT, customer_id: 'c449', created_at: '2026-09-30T15:59:59Z' }),
      order({ id: 'p1', tenant_id: TENANT, customer_id: 'c1', status: 'CANCELLED', created_at: '2026-08-01T02:00:00Z' }),
      order({ id: 'px', tenant_id: OTHER, customer_id: 'c2', created_at: '2026-08-01T02:00:00Z' }),
    ];
    const body = await (await get('?from=2026-10-01&to=2026-10-10')).json();
    expect(state.priorCalls.map((c) => c.ids.length)).toEqual([200, 200, 50]);
    for (const c of state.priorCalls) {
      expect(c.tenant).toBe(TENANT);
      expect(c.neq).toBe('CANCELLED');
      expect(c.lt).toBe('2026-09-30T16:00:00.000Z');
    }
    // p449 落在 09-30 23:59:59 台北時間 = 15:59:59Z，早於本期開始 → 算；c2 屬於其他租戶 → 不算；c1 先前只有取消 → 不算
    expect(body.data.repeat).toEqual({ customers: 450, repeatCustomers: 2, repeatOrders: 2, ratePercent: 0.4, unlinkedOrders: 0 });
  });

  it('先前訂單查詢失敗 → 500，不靜默當成沒有重複', async () => {
    state.orders = [order({ id: 'z1', tenant_id: TENANT, customer_id: 'c1', created_at: '2026-10-02T02:00:00Z' })];
    state.priorError = true;
    expect((await get('?from=2026-10-01&to=2026-10-10')).status).toBe(500);
  });

  it('本期沒有已綁定旅客 → 不發出先前訂單查詢', async () => {
    await get('?from=2026-10-01&to=2026-10-10');
    expect(state.priorCalls).toHaveLength(0);
  });

  it('成團表現：團次查詢帶 tenant_id、departs_on 區間含上一期、看不到其他租戶，數字手算', async () => {
    // 系統時間固定 2026-12-01；區間 10/01–10/10，上一期 09/21–09/30
    state.departures = [
      { id: 'd1', tenant_id: TENANT, departs_on: '2026-10-01', formation_status: 'FORMED' },
      { id: 'd2', tenant_id: TENANT, departs_on: '2026-10-10', formation_status: 'FAILED' },
      { id: 'd3', tenant_id: TENANT, departs_on: '2026-10-05', formation_status: 'COLLECTING' },
      { id: 'd4', tenant_id: TENANT, departs_on: '2026-09-21', formation_status: 'FORMED' },
      { id: 'd5', tenant_id: TENANT, departs_on: '2026-09-20', formation_status: 'FORMED' }, // 區間外
      { id: 'x1', tenant_id: OTHER, departs_on: '2026-10-02', formation_status: 'FORMED' }, // 其他租戶
    ];
    const body = await (await get('?from=2026-10-01&to=2026-10-10')).json();
    const dc = state.calls.filter((c) => c.table === 'trip_departures');
    expect(dc.length).toBeGreaterThan(0);
    for (const c of dc) {
      expect(c.filters.tenant_id).toBe(TENANT);
      expect(c.gte).toBe('2026-09-21');
      expect(c.lte).toBe('2026-10-10');
    }
    expect(body.data.formation.summary).toMatchObject({
      total: 3, concluded: 2, formed: 1, failed: 1, open: 1, successRatePercent: 50, failRatePercent: 50,
    });
    expect(body.data.formation.previous).toMatchObject({ total: 1, concluded: 1, successRatePercent: 100 });
    expect(body.data.formation.successRatePoints).toBe(-50);
    expect(body.data.formation.truncated).toBe(false);
  });

  it('團次查詢失敗 → 500；筆數剛好 MAX_ROWS 不標 truncated、MAX_ROWS+1 標 truncated', async () => {
    state.depError = true;
    expect((await get('?from=2026-10-01&to=2026-10-10')).status).toBe(500);
    state.depError = false;
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
      id: `d${String(i).padStart(6, '0')}`, tenant_id: TENANT, departs_on: '2026-10-02', formation_status: 'FORMED',
    }));
    state.departures = mk(MAX_ROWS);
    expect((await (await get('?from=2026-10-01&to=2026-10-10')).json()).data.formation.truncated).toBe(false);
    state.departures = mk(MAX_ROWS + 1);
    const b = (await (await get('?from=2026-10-01&to=2026-10-10')).json()).data;
    expect(b.formation.truncated).toBe(true);
    expect(b.formation.summary.total).toBe(MAX_ROWS);
  });

  it('欄位／資料表不存在類錯誤 → 成團表現降級（formation=null＋原因），報表其餘照常 200', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.orders = [order({ id: 'a1', tenant_id: TENANT, created_at: '2026-10-02T02:00:00Z' })];
    for (const code of ['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205']) {
      state.depError = code;
      const res = await get('?from=2026-10-01&to=2026-10-10');
      expect(res.status, code).toBe(200);
      const b = (await res.json()).data;
      expect(b.formation).toBeNull();
      expect(b.formationUnavailableReason).toBe('SCHEMA_MISSING');
      expect(b.summary.totalOrders).toBe(1);
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('formation unavailable'), code);
    }
    warn.mockRestore();
  });

  it('其他團次查詢錯誤（含沒有 code、其他 code）仍是 500，不靜默降級', async () => {
    for (const dep of [true, '57014', '42501']) {
      state.depError = dep;
      expect((await get('?from=2026-10-01&to=2026-10-10')).status, String(dep)).toBe(500);
    }
  });

  it('正常時 formationUnavailableReason 為 null；團次的 status 一併讀取並影響已取消分類', async () => {
    state.departures = [
      { id: 'c1', tenant_id: TENANT, departs_on: '2026-10-02', status: 'CANCELLED', formation_status: 'FORMED' },
      { id: 'c2', tenant_id: TENANT, departs_on: '2026-10-03', status: 'CANCELLED', formation_status: 'FAILED' },
    ];
    const b = (await (await get('?from=2026-10-01&to=2026-10-10')).json()).data;
    expect(b.formationUnavailableReason).toBeNull();
    expect(b.formation.summary).toMatchObject({ total: 2, cancelledUndecided: 1, concluded: 1, failed: 1, formed: 0 });
  });
});

