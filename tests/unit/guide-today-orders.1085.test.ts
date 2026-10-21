// Issue #1085 — GUIDE 首頁「今日預約」表改列今日出發團次的非取消團體訂單；非 GUIDE 不變。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_PRESETS, buildTodayOrdersHref } from '@/config/modes';
import { dashboardPage } from '@/i18n/zh-TW/pages/dashboard';
import { listTodayTourDepartureOrders, listTourOrders, buildTourOrdersLink, parseTourOrdersDeepLink } from '@/services/tours';
import { mockTourOrderDepartsOn } from '@/mock/guide-report';
import { MOCK_TOUR_ORDERS } from '@/mock/tours';
import { tenantDateString } from '@/lib/bookings-query-range';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

/* ----------------------------------------------------------------- route */
const filters: { table: string; op: string; args: unknown[] }[] = [];
const selects: { table: string; cols: string }[] = [];
let tourOrderRows: Record<string, unknown>[] = [];
let departureRows: Record<string, unknown>[] = [];
let tenantIdForRequest = 't1';

function chain(table: string) {
  const data = table === 'tour_orders' ? tourOrderRows : table === 'trip_departures' ? departureRows : [];
  let range: [number, number] | null = null;
  let idIn: Set<string> | null = null;
  const q: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        const base = idIn ? data.filter((r) => idIn!.has(r.id as string)) : data;
        return (res: (v: unknown) => void) => res({
          data: range ? base.slice(range[0], range[1] + 1) : base, count: base.length, error: null,
        });
      }
      if (prop === 'maybeSingle') return async () => ({ data: null, error: null });
      return (...args: unknown[]) => {
        filters.push({ table, op: String(prop), args });
        if (prop === 'range') range = [args[0] as number, args[1] as number];
        if (prop === 'in' && table === 'tour_orders' && args[0] === 'id') idIn = new Set(args[1] as string[]);
        return q;
      };
    },
  });
  return q;
}
const fakeSupabase = {
  from: (table: string) => ({
    select: (cols: string) => { selects.push({ table, cols }); return chain(table); },
  }),
};
vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: fakeSupabase, tenantId: tenantIdForRequest, user: { id: 'u' }, role: 'OWNER', businessType: 'GUIDE' }),
}));

const orderRow = (id: string, depId: string, createdAt: string, startTime = '09:00:00') => ({
  trip_departures: { departs_on: '2026-10-21', status: 'OPEN', start_time: startTime },
  id, order_no: id, trip_id: 'tp', plan_id: null, departure_id: depId, payment_method_id: null,
  contact: { name: `旅客${id}`, phone: '0900' }, party_size: 2, status: 'CONFIRMED', source: 'MIDAO', created_at: createdAt,
});

beforeEach(() => {
  filters.length = 0; selects.length = 0; tenantIdForRequest = 't1';
  tourOrderRows = [
    orderRow('o_late', 'd_late', '2026-10-20T01:00:00Z', '16:30:00'),
    orderRow('o_early', 'd_early', '2026-10-20T02:00:00Z'),
  ];
  departureRows = [
    { id: 'd_late', departs_on: '2026-10-21', start_time: '16:30:00' },
    { id: 'd_early', departs_on: '2026-10-21', start_time: '09:00:00' },
  ];
});

describe('#1085 GET /api/tour-orders?departsOn=', () => {
  it('以出發日篩選、排除已取消訂單與已取消團次、每個查詢帶 tenant_id，結果依出發時間排序', async () => {
    const { GET } = await import('@/app/api/tour-orders/route');
    const res = await GET(new Request('http://x/api/tour-orders?departsOn=2026-10-21&activeOnly=1&size=100'), {} as never);
    const body = await res.json();
    expect(body.data.content.map((o: { id: string }) => o.id)).toEqual(['o_early', 'o_late']); // 09:00 在 16:30 前
    expect(body.data.totalElements).toBe(2);
    const key = (f: { op: string; args: unknown[] }) => `${f.op}:${f.args.join('=')}`;
    const keys = filters.filter((f) => f.table === 'tour_orders').map(key);
    expect(keys).toContain('eq:tenant_id=t1');
    expect(keys).toContain('eq:trip_departures.departs_on=2026-10-21');
    expect(keys).toContain('neq:trip_departures.status=CANCELLED');
    expect(keys).toContain('neq:status=CANCELLED');
    expect(selects.find((s) => s.table === 'tour_orders')!.cols).toContain('trip_departures!inner(departs_on, status, start_time)');
    // 後續關聯查詢（團次名稱等）同樣限定租戶
    for (const f of filters.filter((x) => x.table !== 'tour_orders' && x.op === 'eq')) {
      expect(f.args.join('=')).toBe('tenant_id=t1');
    }
  });

  it('超過一頁：第一階段只撈輕量欄位，hydrate 只收到本頁 id，排序與分頁與原行為一致，第二階段帶 tenant', async () => {
    const N = 45;
    const rows = Array.from({ length: N }, (_, i) => orderRow(
      `o_${String(i).padStart(2, '0')}`, `d_${i}`,
      `2026-10-20T${String(i % 5).padStart(2, '0')}:00:00Z`, `${String(8 + (i * 7) % 12).padStart(2, '0')}:00:00`,
    ));
    tourOrderRows = rows;
    departureRows = rows.map((r) => ({ id: r.departure_id, departs_on: '2026-10-21', start_time: (r.trip_departures as { start_time: string }).start_time }));
    const expected = [...rows].sort((a, b) => {
      const sa = (a.trip_departures as { start_time: string }).start_time.slice(0, 5), sb = (b.trip_departures as { start_time: string }).start_time.slice(0, 5);
      return sa < sb ? -1 : sa > sb ? 1 : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.id < b.id ? -1 : 1);
    }).map((r) => r.id);
    const { GET } = await import('@/app/api/tour-orders/route');
    const get = async (page: number) => (await (await GET(new Request(`http://x/api/tour-orders?departsOn=2026-10-21&size=20&page=${page}`), {} as never)).json()).data;
    filters.length = 0; selects.length = 0;
    const p1 = await get(1);
    expect(p1.totalElements).toBe(N);
    expect(p1.totalPages).toBe(3);
    expect(p1.content.map((o: { id: string }) => o.id)).toEqual(expected.slice(20, 40));
    expect((await get(2)).content.map((o: { id: string }) => o.id)).toEqual(expected.slice(40));
    // 第一階段只撈輕量欄位
    expect(selects.find((s) => s.table === 'tour_orders')!.cols.startsWith('id, created_at')).toBe(true);
    // 所有 .in(...) 的 id 數 ≤ size
    const ins = filters.filter((f) => f.op === 'in');
    expect(ins.length).toBeGreaterThan(0);
    for (const f of ins) expect((f.args[1] as unknown[]).length).toBeLessThanOrEqual(20);
    // 第二階段（按 id 撈完整列）同時帶 tenant 篩選
    const stage2 = filters.findIndex((f) => f.table === 'tour_orders' && f.op === 'in');
    expect(stage2).toBeGreaterThan(-1);
    const after = filters.slice(stage2 - 3, stage2 + 1).filter((f) => f.table === 'tour_orders').map((f) => `${f.op}:${f.args[0]}=${f.args[1]}`);
    expect(after).toContain('eq:tenant_id=t1');
  });

  it('跨租戶隔離：換一個租戶就換 tenant_id 過濾值', async () => {
    tenantIdForRequest = 't2';
    const { GET } = await import('@/app/api/tour-orders/route');
    await GET(new Request('http://x/api/tour-orders?departsOn=2026-10-21'), {} as never);
    const eqs = filters.filter((f) => f.table === 'tour_orders' && f.op === 'eq').map((f) => f.args.join('='));
    expect(eqs).toContain('tenant_id=t2');
    expect(eqs).not.toContain('tenant_id=t1');
  });

  it('未帶 departsOn 時不多 join trip_departures，行為維持原狀', async () => {
    const { GET } = await import('@/app/api/tour-orders/route');
    await GET(new Request('http://x/api/tour-orders'), {} as never);
    expect(selects.find((s) => s.table === 'tour_orders')!.cols).not.toContain('trip_departures');
    expect(filters.some((f) => f.args.join('=') === 'trip_departures.status=CANCELLED')).toBe(false);
  });

  it('日期格式不合法或與 status=CANCELLED 矛盾 → 400', async () => {
    const { GET } = await import('@/app/api/tour-orders/route');
    expect((await GET(new Request('http://x/api/tour-orders?departsOn=bad'), {} as never)).status).toBe(400);
    expect((await GET(new Request('http://x/api/tour-orders?departsOn=2026-10-21&status=CANCELLED'), {} as never)).status).toBe(400);
  });
});

/* ------------------------------------------------------------------ mock */
describe('#1085 mock：listTodayTourDepartureOrders', () => {
  const today = tenantDateString();
  it('精確集合：今日出團的非取消訂單，依出發時間排序；其他日、已取消訂單不列；筆數與統計卡一致', async () => {
    const res = await listTodayTourDepartureOrders(today);
    expect(res.content.map((o) => o.id)).toEqual(['to_2', 'to_3']); // 09:00、16:30
    expect(res.content.every((o) => o.departsOn === today && o.status !== 'CANCELLED')).toBe(true);
    expect(res.totalElements).toBe(2);
    expect(res.totalElements).toBe(MODE_DASHBOARD_GUIDE_TODAY());
  });
  it('不是今天的日期 → 空；已取消訂單（to_7）與已取消團次不會因指定其出發日而出現', async () => {
    expect((await listTodayTourDepartureOrders('2000-01-01')).content).toEqual([]);
    expect((await listTourOrders({ departsOn: '2026-08-15', activeOnly: '1' })).content).toEqual([]); // to_7 已取消
    expect((await listTourOrders({ departsOn: '2026-08-28' })).content).toEqual([]); // dp_6 已取消團次
    // 已取消團次上的訂單（合成一筆掛在 dp_6）一律不算出發日
    expect(mockTourOrderDepartsOn({ ...MOCK_TOUR_ORDERS[0], tripId: 'tp_1', departsOn: '2026-08-28', startTime: '09:00' })).toBeNull();
  });
});
// GUIDE 的 mock 統計卡數字（mock 資料集切換由 AppShell 負責；這裡直接取 GUIDE 資料集定義）
function MODE_DASHBOARD_GUIDE_TODAY(): number {
  const src = read('src/mock/index.ts');
  const guide = src.slice(src.indexOf('const GUIDE: ModeDataset'));
  return Number(/todayBookings:\s*(\d+)/.exec(guide)![1]);
}

/* ---------------------------------------------------------------- preset */
describe('#1085 MODE_PRESETS 與連結', () => {
  it('GUIDE 查看全部／統計卡導向 ordersHref 並帶今日出發日；非 GUIDE 維持 /tenant/bookings（精確集合）', () => {
    expect(buildTodayOrdersHref(MODE_PRESETS.GUIDE, '2026-10-21'))
      .toBe('/tenant/tour-orders?departsOn=2026-10-21&activeOnly=1');
    expect({
      LOCAL_SHOP: buildTodayOrdersHref(MODE_PRESETS.LOCAL_SHOP, '2026-10-21'),
      CLINIC: buildTodayOrdersHref(MODE_PRESETS.CLINIC, '2026-10-21'),
    }).toEqual({ LOCAL_SHOP: '/tenant/bookings', CLINIC: '/tenant/bookings' });
    expect({
      LOCAL_SHOP: MODE_PRESETS.LOCAL_SHOP.dashboardLinks.todayTable,
      GUIDE: MODE_PRESETS.GUIDE.dashboardLinks.todayTable,
      CLINIC: MODE_PRESETS.CLINIC.dashboardLinks.todayTable,
    }).toEqual({ LOCAL_SHOP: 'BOOKINGS', GUIDE: 'TOUR_DEPARTURES', CLINIC: 'BOOKINGS' });
  });

  it('卡片標題筆數使用回應的 totalElements（總數 150、本頁 100 時顯示 150）', () => {
    const page = read('src/app/tenant/dashboard/page.tsx');
    expect(page).toContain('setTodayTourTotal(res.totalElements)');
    expect(page).toContain('todayTourTotal : todayRows.length');
    expect(page).not.toContain('todayTourRows.length');
    expect(dashboardPage.todayBookings.count(150)).toContain('150');
  });

  it('頁面依 preset 切換表格、欄位文案走 i18n、不寫業態 if', () => {
    const page = read('src/app/tenant/dashboard/page.tsx');
    expect(page).toContain("todayTable === 'TOUR_DEPARTURES'");
    expect(page).toContain('buildTodayOrdersHref(modePreset');
    expect(page).not.toMatch(/businessType\s*===\s*'/);
    expect(Object.values(dashboardPage.todayTourOrders.columns)).toEqual(['出發時間', '旅客', '行程／方案', '人數', '訂單狀態']);
    expect(page).toContain('t.todayTourOrders.columns.time');
  });

  it('團體訂單頁 deep link 能解析／組出 departsOn', () => {
    expect(parseTourOrdersDeepLink('?departsOn=2026-10-21&activeOnly=1')).toMatchObject({ departsOn: '2026-10-21', activeOnly: true });
    expect(parseTourOrdersDeepLink('?departsOn=nope').departsOn).toBe('');
    expect(buildTourOrdersLink({ departsOn: '2026-10-21', activeOnly: true }))
      .toBe('/tenant/tour-orders?departsOn=2026-10-21&activeOnly=1');
  });
});
