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
  const q: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => void) => res({
          data: range ? data.slice(range[0], range[1] + 1) : data, count: data.length, error: null,
        });
      }
      if (prop === 'maybeSingle') return async () => ({ data: null, error: null });
      return (...args: unknown[]) => {
        filters.push({ table, op: String(prop), args });
        if (prop === 'range') range = [args[0] as number, args[1] as number];
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

const orderRow = (id: string, depId: string, createdAt: string) => ({
  id, order_no: id, trip_id: 'tp', plan_id: null, departure_id: depId, payment_method_id: null,
  contact: { name: `旅客${id}`, phone: '0900' }, party_size: 2, status: 'CONFIRMED', source: 'MIDAO', created_at: createdAt,
});

beforeEach(() => {
  filters.length = 0; selects.length = 0; tenantIdForRequest = 't1';
  tourOrderRows = [
    orderRow('o_late', 'd_late', '2026-10-20T01:00:00Z'),
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
    expect(selects.find((s) => s.table === 'tour_orders')!.cols).toContain('trip_departures!inner(departs_on, status)');
    // 後續關聯查詢（團次名稱等）同樣限定租戶
    for (const f of filters.filter((x) => x.table !== 'tour_orders' && x.op === 'eq')) {
      expect(f.args.join('=')).toBe('tenant_id=t1');
    }
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
