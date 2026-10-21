/**
 * #890：導遊訂單管理頁四張統計卡改由 GET /api/tour-orders/summary 提供（整個店家），
 * 不再由「目前這一頁的列」推算。
 *
 * 邊界說明：本專案 vitest 為 node 環境、無 React testing library，不掛載頁面；
 * 頁面端只能以原始碼斷言（不再由 rows 推算、改用 summary），路由與 mock 服務則真的執行。
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Call = [string, unknown[]];

const requireTenantMock = vi.fn();
vi.mock('@/server/tenant', () => ({ requireTenant: (...a: unknown[]) => requireTenantMock(...a) }));

const queries: { table: string; calls: Call[] }[] = [];

function applyOps(rows: Row[], calls: Call[], tables: Record<string, Row[]> = {}): Row[] {
  let out = rows;
  // 內嵌 inner 篩選 `trip_departures.<col>`：以 departure_id 對應 trip_departures，找不到即排除（inner join）
  const val = (r: Row, f: string): unknown => {
    if (!f.startsWith('trip_departures.')) return r[f];
    const dep = (tables.trip_departures ?? []).find((d) => d.id === r.departure_id);
    return dep ? dep[f.slice('trip_departures.'.length)] : undefined;
  };
  for (const [m, a] of calls) {
    const f = a[0] as string;
    if (m === 'eq') out = out.filter((r) => val(r, f) === a[1]);
    else if (m === 'neq') out = out.filter((r) => val(r, f) !== a[1]);
    else if (m === 'in') out = out.filter((r) => (a[1] as unknown[]).includes(val(r, f)));
    else if (m === 'gte') out = out.filter((r) => (val(r, f) as string) >= (a[1] as string));
    else if (m === 'lte') out = out.filter((r) => (val(r, f) as string) <= (a[1] as string));
    else if (m === 'lt') out = out.filter((r) => (val(r, f) as string) < (a[1] as string));
  }
  return out;
}

function fakeSupabase(tables: Record<string, Row[]>, maxRows = Infinity) {
  return {
    from(table: string) {
      const calls: Call[] = [];
      queries.push({ table, calls });
      let head = false;
      let rng: [number, number] | null = null;
      const b: any = {
        select: (cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; calls.push(['select', [cols]]); return b; },
        order: () => b,
        maybeSingle: () => { calls.push(['maybeSingle', []]); return b; },
        range: (x: number, y: number) => { rng = [x, y]; return b; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const all = applyOps(tables[table] ?? [], calls, tables);
          const data = (rng ? all.slice(rng[0], Math.min(rng[1] + 1, rng[0] + maxRows)) : all);
          const isSingle = calls.some(([m]) => m === 'maybeSingle');
          return Promise.resolve({ data: head ? null : isSingle ? (data[0] ?? null) : data, error: null, count: all.length }).then(resolve, reject);
        },
      };
      for (const m of ['eq', 'neq', 'in', 'gte', 'lte', 'lt']) b[m] = (...a: unknown[]) => { calls.push([m, a]); return b; };
      return b;
    },
  };
}

const NOW = new Date('2026-10-13T04:00:00.000Z'); // 台北 2026-10-13 12:00
const A = 'tenant-a';
const B = 'tenant-b';

const order = (o: Row): Row => ({ tenant_id: A, status: 'PENDING', payment_status: 'UNPAID', total_amount: 100, paid_amount: 0, refunded_amount: 0, departure_id: null, created_at: '2026-10-05T00:00:00.000Z', ...o });

const TABLES: Record<string, Row[]> = {
  tour_orders: [
    order({ id: 'p1', status: 'PENDING' }),
    order({ id: 'p2', status: 'PENDING', payment_status: 'PARTIAL' }),
    order({ id: 'p-other', tenant_id: B, status: 'PENDING' }),
    order({ id: 'c1', status: 'CONFIRMED', payment_status: 'PAID', total_amount: 500, paid_amount: 500, departure_id: 'd-soon' }),
    order({ id: 'c2', status: 'CONFIRMED', payment_status: 'PAID', total_amount: 300, paid_amount: 300, departure_id: 'd-late' }),
    order({ id: 'c3', status: 'CONFIRMED', payment_status: 'UNPAID', departure_id: 'd-soon' }),
    order({ id: 'x1', status: 'CANCELLED', payment_status: 'UNPAID' }),
    order({ id: 'old', status: 'COMPLETED', payment_status: 'PAID', total_amount: 9999, paid_amount: 9999, created_at: '2026-09-30T15:59:59.000Z' }), // 台北 9/30 23:59
    order({ id: 'edge', status: 'COMPLETED', payment_status: 'PAID', total_amount: 7, paid_amount: 7, created_at: '2026-09-30T16:00:00.000Z' }), // 台北 10/1 00:00
    order({ id: 'other-rev', tenant_id: B, status: 'COMPLETED', payment_status: 'PAID', total_amount: 123456, paid_amount: 123456 }),
  ],
  trip_departures: [
    { id: 'd-soon', tenant_id: A, departs_on: '2026-10-18' },
    { id: 'd-late', tenant_id: A, departs_on: '2026-10-21' },
    { id: 'd-other', tenant_id: B, departs_on: '2026-10-14' },
  ],
};

describe('GET /api/tour-orders/summary（#890）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    queries.length = 0;
    requireTenantMock.mockReset();
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase(TABLES), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
  });
  afterEach(() => vi.useRealTimers());

  async function call() {
    const { GET } = await import('@/app/api/tour-orders/summary/route');
    const res = await GET(new Request('https://app.test/api/tour-orders/summary'), {});
    return { status: res.status, body: await res.json() };
  }

  it('四個定義：待處理／待收款／7 天內出團／台北本月已收營收', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data).toEqual({
      pending: 2, // p1, p2（別的租戶的 p-other 不算）
      awaitingPayment: 3, // p1, p2(PARTIAL), c3；已取消 x1 不算
      upcoming7d: 2, // c1、c3 為 CONFIRMED 且掛在 d-soon（10/18）；c2 的 d-late（10/21）超過 7 天
      monthRevenue: 500 + 300 + 7, // 台北本月實收：c1、c2、edge；old(9/30 台北)與他租戶不算
    });
  });

  it('每一個查詢都帶 tenant_id 過濾', async () => {
    await call();
    expect(queries.length).toBe(6); // tenant_settings + 3 count + 2 營收分頁（資料頁＋空頁）
    expect(queries.every((q) => q.table === 'tour_orders' || q.table === 'tenant_settings')).toBe(true);
    for (const q of queries) {
      expect(q.calls.some(([m, a]) => m === 'eq' && a[0] === 'tenant_id' && a[1] === A), `${q.table} 缺 tenant_id`).toBe(true);
    }
  });

  it('近 7 天出團為單一 tour_orders 關聯查詢：tenant 與嵌入日期窗都在同一個 count 上', async () => {
    await call();
    const q = queries.find((x) => x.calls.some(([m, a]) => m === 'select' && String(a[0]).includes('trip_departures!inner')))!;
    expect(q.table).toBe('tour_orders');
    expect(q.calls).toContainEqual(['eq', ['tenant_id', A]]);
    expect(q.calls).toContainEqual(['eq', ['status', 'CONFIRMED']]);
    expect(q.calls).toContainEqual(['gte', ['trip_departures.departs_on', '2026-10-13']]);
    expect(q.calls).toContainEqual(['lte', ['trip_departures.departs_on', '2026-10-20']]);
    expect(queries.some((x) => x.table === 'trip_departures')).toBe(false);
  });

  const bigRows = (n: number) => Array.from({ length: n }, (_, i) => order({ id: `r${String(i).padStart(5, '0')}`, status: 'COMPLETED', payment_status: 'PAID', total_amount: 1, paid_amount: 1 }));

  it('本月已付款訂單剛好 50,000 筆：200 並回完整加總', async () => {
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase({ tour_orders: bigRows(50_000), trip_departures: [] }), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data.monthRevenue).toBe(50_000);
    const probe = queries.filter((q) => q.table === 'tour_orders').at(-1)!;
    expect(probe.calls).toContainEqual(['eq', ['tenant_id', A]]);
  });

  it('本月已付款訂單 50,001 筆（超過上限）：回 422 REPORT_001，不回少算的 200', async () => {
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase({ tour_orders: bigRows(50_001), trip_departures: [] }), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
    const { status, body } = await call();
    expect(status).toBe(422);
    expect(body.code).toBe('REPORT_001');
    expect(body.data).toBeUndefined();
  });

  it('遠端 max_rows(600) 不整除上限：50,001 筆時分頁跨越 50,000 仍回 422', async () => {
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase({ tour_orders: bigRows(50_001), trip_departures: [] }, 600), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
    const { status, body } = await call();
    expect(status).toBe(422);
    expect(body.code).toBe('REPORT_001');
    expect(body.data).toBeUndefined();
  });

  it('遠端 max_rows(600) 不整除上限：剛好 50,000 筆（末頁較短）仍回 200 並完整加總', async () => {
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase({ tour_orders: bigRows(50_000), trip_departures: [] }, 600), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data.monthRevenue).toBe(50_000);
  });

  it('日期界線用店家時區：LA 10/31 晚上（台北已是 11/1）仍算十月，7 天窗用 LA 日期', async () => {
    vi.setSystemTime(new Date('2026-11-01T03:00:00.000Z')); // 台北 11/1 11:00；LA(PDT) 10/31 20:00
    const tables: Record<string, Row[]> = {
      tenant_settings: [{ tenant_id: A, basic: { timezone: 'America/Los_Angeles' } }],
      tour_orders: [
        order({ id: 'oct', status: 'COMPLETED', payment_status: 'PAID', total_amount: 40, paid_amount: 40, created_at: '2026-10-31T20:00:00.000Z' }), // LA 10/31 13:00
        order({ id: 'oct-start', status: 'COMPLETED', payment_status: 'PAID', total_amount: 2, paid_amount: 2, created_at: '2026-10-01T07:00:00.000Z' }), // LA 10/1 00:00
        order({ id: 'sep', status: 'COMPLETED', payment_status: 'PAID', total_amount: 900, paid_amount: 900, created_at: '2026-10-01T06:59:59.000Z' }), // LA 9/30 23:59
        order({ id: 'nov', status: 'COMPLETED', payment_status: 'PAID', total_amount: 800, paid_amount: 800, created_at: '2026-11-01T07:00:00.000Z' }), // LA 11/1 00:00，屬十一月不計入
        order({ id: 'u1', status: 'CONFIRMED', departure_id: 'd1' }),
        order({ id: 'u2', status: 'CONFIRMED', departure_id: 'd2' }),
        order({ id: 'u3', status: 'CONFIRMED', departure_id: 'd3' }),
      ],
      trip_departures: [
        { id: 'd1', tenant_id: A, departs_on: '2026-10-31' }, // LA 今天（台北基準會被當成過去）
        { id: 'd2', tenant_id: A, departs_on: '2026-11-07' }, // LA 今天+7
        { id: 'd3', tenant_id: A, departs_on: '2026-11-08' }, // 超出
      ],
    };
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase(tables), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
    const { body } = await call();
    expect(body.data.monthRevenue).toBe(42);
    expect(body.data.upcoming7d).toBe(2);
    const ts = queries.find((q) => q.table === 'tenant_settings')!;
    expect(ts.calls).toContainEqual(['eq', ['tenant_id', A]]);
  });

  it('遠端 max_rows(500) 小於 PAGE：以實際回傳筆數推進，800 筆全數加總不提早停', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => order({ id: `m${String(i).padStart(4, '0')}`, status: 'COMPLETED', payment_status: 'PAID', total_amount: 2, paid_amount: 2 }));
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase({ tour_orders: rows, trip_departures: [] }, 500), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data.monthRevenue).toBe(1600);
  });

  it('本月營收＝實收扣退款（#1083）：PARTIAL 計已收部分、退款扣除、負值夾 0、不篩 payment_status／status，與 sumNetReceived 一致', async () => {
    const { sumNetReceived } = await import('@/server/dashboard-tour');
    const rows = [
      order({ id: 'n1', status: 'CONFIRMED', payment_status: 'PARTIAL', total_amount: 1000, paid_amount: 400 }),
      order({ id: 'n2', status: 'COMPLETED', payment_status: 'PAID', total_amount: 800, paid_amount: 800, refunded_amount: 300 }),
      order({ id: 'n3', status: 'CANCELLED', payment_status: 'REFUNDED', total_amount: 500, paid_amount: 500, refunded_amount: 500 }),
      order({ id: 'n4', status: 'CANCELLED', payment_status: 'PAID', total_amount: 200, paid_amount: 100, refunded_amount: 250 }), // 負值夾 0
      order({ id: 'n5', status: 'PENDING', payment_status: 'UNPAID', total_amount: 600 }), // 未收款 0
      order({ id: 'n6', status: 'CONFIRMED', payment_status: 'PAID', total_amount: 50, paid_amount: 50, created_at: '2026-09-30T15:59:59.000Z' }), // 上月不計
    ];
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase({ tour_orders: rows, trip_departures: [] }), tenantId: A, user: { id: 'u' }, role: 'OWNER' });
    const { body } = await call();
    expect(body.data.monthRevenue).toBe(400 + 500);
    expect(body.data.monthRevenue).toBe(sumNetReceived(rows.slice(0, 5) as { paid_amount: unknown; refunded_amount: unknown }[]));
    const q = queries.filter((x) => x.table === 'tour_orders' && x.calls.some(([m, a]) => m === 'select' && a[0] === 'paid_amount, refunded_amount'))[0];
    expect(q.calls.some(([m, a]) => m === 'eq' && a[0] === 'payment_status')).toBe(false);
  });

  it('別的租戶的資料完全不計入', async () => {
    requireTenantMock.mockResolvedValue({ supabase: fakeSupabase(TABLES), tenantId: B, user: { id: 'u' }, role: 'OWNER' });
    const { body } = await call();
    expect(body.data).toEqual({ pending: 1, awaitingPayment: 1, upcoming7d: 0, monthRevenue: 123456 });
  });

  it('頁面不再由目前這一頁的 rows 推算統計，改讀 summary', () => {
    const src = readFileSync('src/app/tenant/tour-orders/page.tsx', 'utf8');
    expect(src).not.toMatch(/const stats\s*=/);
    expect(src).not.toMatch(/rows\s*\.filter\(/);
    expect(src).not.toMatch(/isAwaitingPayment/);
    expect(src).toContain('getTourOrderSummary');
    expect(src).toContain('summary.awaitingPayment');
    expect(src).toContain('t.stats.placeholder');
  });
});

describe('getTourOrderSummary（mock 服務）', () => {
  it('以 mock 訂單於呼叫當下算出同樣四個定義，且與列表頁大小無關', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK', 'true');
    const { getTourOrderSummary, listTourOrders } = await import('@/services/tours');
    const s = await getTourOrderSummary();
    const all = (await listTourOrders({ page: 0, size: 1000 })).content;
    expect(Object.keys(s).sort()).toEqual(['awaitingPayment', 'monthRevenue', 'pending', 'upcoming7d']);
    expect(s.pending).toBe(all.filter((o) => o.status === 'PENDING').length);
    expect(s.awaitingPayment).toBe(all.filter((o) => o.status !== 'CANCELLED' && (o.paymentStatus === 'UNPAID' || o.paymentStatus === 'PARTIAL')).length);
    // 只取第一頁 1 筆時，summary 仍是整體數字
    const one = (await listTourOrders({ page: 0, size: 1 })).content;
    expect(one.length).toBe(1);
    expect(s.pending).toBeGreaterThanOrEqual(one.filter((o) => o.status === 'PENDING').length);
    vi.unstubAllEnvs();
  });
});
