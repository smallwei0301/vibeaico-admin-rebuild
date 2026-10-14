/**
 * Issue #941：公開頁建立團體訂單成功後，以 owner-notify 通道通知老闆。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, multicast: [] as any[], tenantErr: false, tenantDataErr: false, countErr: false, countCalls: 0 }));

vi.mock('@/server/line', () => ({
  getLineCredentials: vi.fn(async () => ({ token: 'tok' })),
  lineBotInfo: vi.fn(),
  lineMulticast: vi.fn(async (_t: string, ids: string[], msgs: any[]) => { state.multicast.push({ ids, msgs }); }),
  consumePushQuota: vi.fn(async () => true),
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const q: any = {
        select: (_c?: string, opts?: any) => { if (opts?.head) { q._count = true; } return q; },
        gte: (f: string, v: any) => { filters.push([`gte:${f}`, v]); return q; },
        eq: (f: string, v: any) => { filters.push([f, v]); return q; },
        in: (f: string, v: any[]) => { filters.push([f, v]); return q; },
        then: (res: any, rej: any) => {
          const matches = (r: Row) => filters.every(([f, v]) =>
            f.startsWith('gte:') ? String(r[f.slice(4)] ?? '') >= v : (Array.isArray(v) ? v.includes(r[f]) : r[f] === v));
          if (q._count) {
            state.countCalls += 1;
            if (state.countErr) return Promise.resolve({ data: null, count: null, error: { message: 'db down' } }).then(res, rej);
            return Promise.resolve({ data: null, count: (state.tables[table] ?? []).filter(matches).length, error: null }).then(res, rej);
          }
          const rows = (state.tables[table] ?? []).filter(matches);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
        maybeSingle: async () => {
          if (state.tenantErr && table === 'tenants') throw new Error('boom');
          const rows = (state.tables[table] ?? []).filter((r) => filters.every(([f, v]) => r[f] === v));
          if (state.tenantDataErr && table === 'tenants') return { data: null, error: { message: 'db down' } };
          return { data: rows[0] ?? null, error: null };
        },
      };
      return q;
    },
  }),
}));

import { notifyOwnerNewTourOrder, OWNER_NOTIFY_TOUR_ORDER_HOURLY_CAP } from '@/server/owner-notify';

function seed(salesMode: 'INSTANT' | 'REQUEST') {
  state.tables = {
    tenants: [{ id: 't1', name: '祕島小舖' }],
    owner_notify_recipients: [{ tenant_id: 't1', line_user_id: 'U1', notify_new_booking: true }],
    tour_orders: [{
      id: 'o1', tenant_id: 't1', order_no: 'TO-261201-001', trip_id: 'tr1', plan_id: 'p1', departure_id: 'd1',
      contact: { name: '王小明', phone: '0912' }, party_size: 4, created_at: new Date().toISOString(), status: 'PENDING', payment_status: 'UNPAID',
    }],
    trips: [{ id: 'tr1', tenant_id: 't1', title: '九份散步' }],
    trip_plans: [{ id: 'p1', tenant_id: 't1', name: '半日方案', sales_mode: salesMode }],
    trip_departures: [{ id: 'd1', tenant_id: 't1', departs_on: '2026-12-01', start_time: '09:30:00' }],
    tenant_payment_methods: [],
  };
}

describe('#941 notifyOwnerNewTourOrder', () => {
  beforeEach(() => { state.multicast = []; state.countErr = false; state.countCalls = 0; state.tenantErr = false; state.tenantDataErr = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('即時預約：推「新團體預約」並含訂單編號／行程方案／日期／人數／旅客', async () => {
    seed('INSTANT');
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast).toHaveLength(1);
    const text = state.multicast[0].msgs[0].text as string;
    expect(state.multicast[0].ids).toEqual(['U1']);
    expect(text).toContain('【祕島小舖】新團體預約');
    expect(text).toContain('TO-261201-001');
    expect(text).toContain('九份散步／半日方案');
    expect(text).toContain('2026-12-01 09:30');
    expect(text).toContain('人數：4');
    expect(text).toContain('王小明');
  });

  it('REQUEST 申請：推「新預約申請（待審）」', async () => {
    seed('REQUEST');
    await notifyOwnerNewTourOrder('t1', 'o1');
    const text = state.multicast[0].msgs[0].text as string;
    expect(text).toContain('【祕島小舖】新預約申請（待審）');
    expect(text).toContain('請到後台「團體訂單」接受或婉拒此申請。');
    expect(text).toContain('/tenant/tour-orders?orderId=o1');
    expect(text).not.toContain('處理期限');
  });

  it('REQUEST 訂單帶 hold_expires_at 時顯示處理期限（台北時間）', async () => {
    seed('REQUEST');
    state.tables.tour_orders[0].hold_expires_at = '2026-11-30T04:00:00.000Z';
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast[0].msgs[0].text).toContain('處理期限：2026/11/30 12:00');
  });

  it('即時預約不含接受／婉拒指示', async () => {
    seed('INSTANT');
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast[0].msgs[0].text).not.toContain('接受或婉拒');
  });

  it('旅客姓名含換行／控制字元：壓成單行，不產生偽造的額外行', async () => {
    seed('INSTANT');
    state.tables.tour_orders[0].contact = { name: '王\r\n付款狀態：已付款\u2028\t假', phone: '0912' };
    await notifyOwnerNewTourOrder('t1', 'o1');
    const text = state.multicast[0].msgs[0].text as string;
    const lines = text.split('\n');
    expect(lines.some((l) => l.startsWith('付款狀態'))).toBe(false);
    expect(lines.find((l) => l.startsWith('旅客：'))).toBe('旅客：王 付款狀態：已付款 假');
    expect(text).not.toMatch(/[\r\t\u2028]/);
  });

  it('過長的行程名稱被截斷，整則訊息長度有上限', async () => {
    seed('REQUEST');
    state.tables.trips[0].title = '長'.repeat(5000);
    state.tables.tour_orders[0].contact = { name: '名'.repeat(5000), phone: '0912' };
    await notifyOwnerNewTourOrder('t1', 'o1');
    const text = state.multicast[0].msgs[0].text as string;
    expect(text).toContain('長'.repeat(60) + '…');
    expect(text).not.toContain('長'.repeat(61));
    expect(text.length).toBeLessThanOrEqual(1000);
  });

  it('tenants 查詢回 error：不發送', async () => {
    seed('INSTANT');
    state.tenantDataErr = true;
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast).toHaveLength(0);
  });

  it('店家名稱為空：不出現空的【】前綴', async () => {
    seed('INSTANT');
    state.tables.tenants[0].name = '  ';
    await notifyOwnerNewTourOrder('t1', 'o1');
    const text = state.multicast[0].msgs[0].text as string;
    expect(text).not.toContain('【');
    expect(text.startsWith('新團體預約')).toBe(true);
  });

  it('找不到訂單：不推', async () => {
    seed('INSTANT');
    await notifyOwnerNewTourOrder('t1', 'nope');
    expect(state.multicast).toHaveLength(0);
  });

  it('查詢拋錯：不外洩例外、不推', async () => {
    seed('INSTANT');
    state.tenantErr = true;
    await expect(notifyOwnerNewTourOrder('t1', 'o1')).resolves.toBeUndefined();
    expect(state.multicast).toHaveLength(0);
  });

  it('通知連結帶 tenantId', async () => {
    seed('INSTANT');
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast[0].msgs[0].text).toContain('/tenant/tour-orders?orderId=o1&tenantId=t1');
  });

  function addOrders(n: number, createdAt: string) {
    for (let i = 0; i < n; i++) state.tables.tour_orders.push({ id: `x${i}`, tenant_id: 't1', created_at: createdAt });
  }

  it('近一小時建單數恰為上限：仍推播', async () => {
    seed('INSTANT');
    addOrders(OWNER_NOTIFY_TOUR_ORDER_HOURLY_CAP - 1, new Date().toISOString());
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast).toHaveLength(1);
  });

  it('近一小時建單數為上限+1：改送一則彙總提醒（額度只消耗一次）', async () => {
    seed('REQUEST');
    addOrders(OWNER_NOTIFY_TOUR_ORDER_HOURLY_CAP, new Date().toISOString());
    const { consumePushQuota } = await import('@/server/line');
    vi.mocked(consumePushQuota).mockClear();
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast).toHaveLength(1);
    const text = state.multicast[0].msgs[0].text as string;
    expect(text).toContain(`【祕島小舖】本小時新訂單已超過 ${OWNER_NOTIFY_TOUR_ORDER_HOURLY_CAP} 筆`);
    expect(text).toContain('/tenant/tour-orders?tenantId=t1');
    expect(text).not.toContain('orderId=');
    expect(text).not.toContain('TO-261201-001');
    expect(consumePushQuota).toHaveBeenCalledTimes(1);
  });

  it('近一小時建單數為上限+2：不推播、不消耗額度', async () => {
    seed('REQUEST');
    addOrders(OWNER_NOTIFY_TOUR_ORDER_HOURLY_CAP + 1, new Date().toISOString());
    const { consumePushQuota } = await import('@/server/line');
    vi.mocked(consumePushQuota).mockClear();
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast).toHaveLength(0);
    expect(consumePushQuota).not.toHaveBeenCalled();
  });

  it('超過一小時的舊訂單不計入', async () => {
    seed('INSTANT');
    addOrders(50, new Date(Date.now() - 2 * 3600 * 1000).toISOString());
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast).toHaveLength(1);
  });

  it('計數查詢失敗：fail closed 不推播', async () => {
    seed('INSTANT');
    state.countErr = true;
    await notifyOwnerNewTourOrder('t1', 'o1');
    expect(state.multicast).toHaveLength(0);
  });
});

describe('#941 公開建單 route 呼叫點', () => {
  for (const name of ['tour-bookings', 'tour-requests']) {
    it(`${name}：成功路徑呼叫一次，catch 失敗分支不呼叫`, () => {
      const src = readFileSync(resolve(__dirname, `../../src/app/api/public/${name}/route.ts`), 'utf8');
      expect(src.match(/notifyOwnerNewTourOrder\(/g)).toHaveLength(1);
      const submitAt = src.search(/await submitPublicTour/);
      expect(src).not.toContain('void notifyOwnerNewTourOrder');
      expect(src).toContain("import { after } from 'next/server'");
      const notifyAt = src.indexOf('after(() => notifyOwnerNewTourOrder(');
      expect(notifyAt).toBeGreaterThan(-1);
      const catchAt = src.indexOf('} catch');
      expect(notifyAt).toBeGreaterThan(submitAt);
      expect(notifyAt).toBeLessThan(catchAt);
    });
  }
});
