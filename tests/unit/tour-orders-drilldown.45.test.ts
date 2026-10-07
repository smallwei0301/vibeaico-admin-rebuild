/**
 * Issue #45 第二切片：報表數字下鑽到訂單清單。
 * 涵蓋：深連結解析、報表連結組裝（純函式）、/api/tour-orders 新篩選（.eq/.gte/.lt 帶入、400）、mock 篩選。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TRIP = '33333333-3333-4333-8333-333333333333';
const state = vi.hoisted(() => ({
  ops: [] as [string, ...unknown[]][],
  timezone: undefined as string | undefined,
}));

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/tour-orders', () => ({ hydrateTourOrders: async (_s: unknown, _t: unknown, rows: unknown[]) => rows }));
vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ tenantId: TENANT, businessType: 'GUIDE', supabase: fakeDb }),
}));

const fakeDb = {
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'gt', 'in', 'or', 'order', 'range', 'limit']) {
      q[m] = (...a: unknown[]) => { state.ops.push([`${table}.${m}`, ...a]); return q; };
    }
    q.maybeSingle = async () => ({
      data: table === 'tenant_settings' && state.timezone ? { basic: { timezone: state.timezone } } : null, error: null,
    });
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count: 0 });
    return q;
  },
};

import { GET } from '@/app/api/tour-orders/route';
import { buildTourOrdersLink, parseTourOrdersDeepLink } from '@/services/tours';

const get = (qs: string) => GET(new Request(`http://t/api/tour-orders${qs}`), {});
const ops = (name: string) => state.ops.filter((o) => o[0] === name);

beforeEach(() => { state.ops = []; state.timezone = undefined; });

describe('parseTourOrdersDeepLink 新參數', () => {
  it('讀出 status／tripId／createdFrom／createdTo，非法值忽略', () => {
    expect(parseTourOrdersDeepLink(`?status=CANCELLED&tripId=${TRIP}&createdFrom=2026-10-01&createdTo=2026-10-10`))
      .toMatchObject({ status: 'CANCELLED', tripId: TRIP, createdFrom: '2026-10-01', createdTo: '2026-10-10' });
    expect(parseTourOrdersDeepLink('?status=BOGUS&createdFrom=10/01&createdTo=x'))
      .toMatchObject({ status: '', createdFrom: '', createdTo: '' });
    expect(parseTourOrdersDeepLink('')).toEqual({
      paymentStatus: '', orderId: '', status: '', tripId: '', createdFrom: '', createdTo: '', source: '', planId: '', activeOnly: false, repeatCustomers: false,
    });
  });
});

describe('退款處理中下鑽連結', () => {
  it('paymentStatus＋本期區間組裝，且 parse 還原；兩頁來源名稱同一份文案', async () => {
    const href = buildTourOrdersLink({ paymentStatus: 'REFUND_PENDING', createdFrom: '2026-10-01', createdTo: '2026-10-10' });
    expect(href).toBe('/tenant/tour-orders?paymentStatus=REFUND_PENDING&createdFrom=2026-10-01&createdTo=2026-10-10');
    expect(parseTourOrdersDeepLink(href.split('?')[1])).toMatchObject({
      paymentStatus: 'REFUND_PENDING', createdFrom: '2026-10-01', createdTo: '2026-10-10',
    });
    const { reportsPage } = await import('@/i18n/zh-TW/pages/reports');
    expect(reportsPage.guideReport.sourceCard.names).toEqual({
      MIDAO: 'Midao 前台', VIBEAI_SHOP: '商店頁', LINE: 'LINE', MANUAL: '手動建立', OTHER: '其他',
    });
  });
});

describe('來源下鑽參數', () => {
  it('parse 只接受四個合法來源；build 帶出 source 且與 parse 互逆', () => {
    expect(parseTourOrdersDeepLink('?source=LINE').source).toBe('LINE');
    expect(parseTourOrdersDeepLink('?source=OTHER').source).toBe('');
    const href = buildTourOrdersLink({ source: 'MIDAO', createdFrom: '2026-10-01', createdTo: '2026-10-10' });
    expect(href).toBe('/tenant/tour-orders?createdFrom=2026-10-01&createdTo=2026-10-10&source=MIDAO');
    expect(parseTourOrdersDeepLink(href.split('?')[1]).source).toBe('MIDAO');
  });
  it('GET 帶 source → .eq(source)；非法來源 → 400', async () => {
    expect((await get('?source=LINE')).status).toBe(200);
    expect(ops('tour_orders.eq')).toEqual(expect.arrayContaining([['tour_orders.eq', 'source', 'LINE']]));
    expect((await get('?source=BOGUS')).status).toBe(400);
  });
});

const PLAN = '44444444-4444-4444-8444-444444444444';
describe('planId／activeOnly 下鑽', () => {
  it('parse 與 build 互逆；status=CANCELLED 時忽略 activeOnly／repeatCustomers', () => {
    const href = buildTourOrdersLink({ planId: PLAN, activeOnly: true, createdFrom: '2026-10-01', createdTo: '2026-10-10' });
    expect(href).toBe(`/tenant/tour-orders?createdFrom=2026-10-01&createdTo=2026-10-10&planId=${PLAN}&activeOnly=1`);
    expect(parseTourOrdersDeepLink(href.split('?')[1])).toMatchObject({ planId: PLAN, activeOnly: true, repeatCustomers: false });
    const rp = buildTourOrdersLink({ repeatCustomers: true, createdFrom: '2026-10-01', createdTo: '2026-10-10' });
    expect(rp).toBe('/tenant/tour-orders?createdFrom=2026-10-01&createdTo=2026-10-10&repeatCustomers=1');
    expect(parseTourOrdersDeepLink(rp.split('?')[1]).repeatCustomers).toBe(true);
    expect(parseTourOrdersDeepLink('?repeatCustomers=1').repeatCustomers).toBe(false); // 缺日期不啟用
    expect(parseTourOrdersDeepLink('?status=CANCELLED&activeOnly=1')).toMatchObject({ status: 'CANCELLED', activeOnly: false });
  });
  it('GET：planId 帶 .eq(plan_id)（在 tenant_id 之後）、activeOnly 帶 .neq(status, CANCELLED)', async () => {
    const res = await get(`?planId=${PLAN}&activeOnly=1`);
    expect(res.status).toBe(200);
    const eqs = ops('tour_orders.eq');
    expect(eqs[0]).toEqual(['tour_orders.eq', 'tenant_id', TENANT]);
    expect(eqs).toEqual(expect.arrayContaining([['tour_orders.eq', 'plan_id', PLAN]]));
    expect(ops('tour_orders.neq')).toEqual([['tour_orders.neq', 'status', 'CANCELLED']]);
  });
  it('沒帶 activeOnly 就不加 neq', async () => {
    await get('?status=PENDING');
    expect(ops('tour_orders.neq')).toHaveLength(0);
  });
});

describe('buildTourOrdersLink（報表連結組裝）', () => {
  it('帶狀態與日期區間；空值不進 query；與 parse 互逆', () => {
    const href = buildTourOrdersLink({ status: 'CANCELLED', createdFrom: '2026-10-01', createdTo: '2026-10-10' });
    expect(href).toBe('/tenant/tour-orders?status=CANCELLED&createdFrom=2026-10-01&createdTo=2026-10-10');
    expect(parseTourOrdersDeepLink(href.split('?')[1])).toMatchObject({
      status: 'CANCELLED', createdFrom: '2026-10-01', createdTo: '2026-10-10',
    });
    expect(buildTourOrdersLink({ tripId: TRIP, createdFrom: '', createdTo: undefined })).toBe(`/tenant/tour-orders?tripId=${TRIP}`);
    expect(buildTourOrdersLink({})).toBe('/tenant/tour-orders');
  });
});

describe('GET /api/tour-orders 下鑽篩選', () => {
  it('status／tripId 帶入 .eq，日期以店家時區半開區間帶入 .gte/.lt（預設 Asia/Taipei）', async () => {
    const res = await get(`?status=CANCELLED&tripId=${TRIP}&createdFrom=2026-10-01&createdTo=2026-10-10`);
    expect(res.status).toBe(200);
    expect(ops('tour_orders.eq')).toEqual(expect.arrayContaining([
      ['tour_orders.eq', 'tenant_id', TENANT], ['tour_orders.eq', 'status', 'CANCELLED'], ['tour_orders.eq', 'trip_id', TRIP],
    ]));
    expect(ops('tour_orders.gte')).toEqual([['tour_orders.gte', 'created_at', '2026-09-30T16:00:00.000Z']]);
    expect(ops('tour_orders.lt')).toEqual([['tour_orders.lt', 'created_at', '2026-10-10T16:00:00.000Z']]);
  });

  it('租戶時區非預設時界線隨之改變（與報表同一套）', async () => {
    state.timezone = 'America/New_York';
    await get('?createdFrom=2026-10-01&createdTo=2026-10-01');
    expect(ops('tour_orders.gte')[0][2]).toBe('2026-10-01T04:00:00.000Z');
    expect(ops('tour_orders.lt')[0][2]).toBe('2026-10-02T04:00:00.000Z');
  });

  it('沒帶日期就不查 tenant_settings、不加 gte/lt', async () => {
    await get('?status=PENDING');
    expect(ops('tenant_settings.select')).toHaveLength(0);
    expect(ops('tour_orders.gte')).toHaveLength(0);
  });

  it.each([
    '?status=BOGUS', '?tripId=not-a-uuid', '?createdFrom=2026/10/01', '?createdTo=2026-13-45',
    '?createdFrom=2026-10-10&createdTo=2026-10-01',
  ])('非法參數 %s → 400，且不查 tour_orders 資料', async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(ops('tour_orders.range')).toHaveLength(0);
  });
});
