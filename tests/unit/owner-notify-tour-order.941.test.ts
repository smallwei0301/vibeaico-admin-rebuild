/**
 * Issue #941：公開頁建立團體訂單成功後，以 owner-notify 通道通知老闆。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, multicast: [] as any[], tenantErr: false }));

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
        select: () => q,
        eq: (f: string, v: any) => { filters.push([f, v]); return q; },
        in: (f: string, v: any[]) => { filters.push([f, v]); return q; },
        then: (res: any, rej: any) => {
          const rows = (state.tables[table] ?? []).filter((r) =>
            filters.every(([f, v]) => (Array.isArray(v) ? v.includes(r[f]) : r[f] === v)));
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
        maybeSingle: async () => {
          if (state.tenantErr && table === 'tenants') throw new Error('boom');
          const rows = (state.tables[table] ?? []).filter((r) => filters.every(([f, v]) => r[f] === v));
          return { data: rows[0] ?? null, error: null };
        },
      };
      return q;
    },
  }),
}));

import { notifyOwnerNewTourOrder } from '@/server/owner-notify';

function seed(salesMode: 'INSTANT' | 'REQUEST') {
  state.tables = {
    tenants: [{ id: 't1', name: '祕島小舖' }],
    owner_notify_recipients: [{ tenant_id: 't1', line_user_id: 'U1', notify_new_booking: true }],
    tour_orders: [{
      id: 'o1', tenant_id: 't1', order_no: 'TO-261201-001', trip_id: 'tr1', plan_id: 'p1', departure_id: 'd1',
      contact: { name: '王小明', phone: '0912' }, party_size: 4, status: 'PENDING', payment_status: 'UNPAID',
    }],
    trips: [{ id: 'tr1', tenant_id: 't1', title: '九份散步' }],
    trip_plans: [{ id: 'p1', tenant_id: 't1', name: '半日方案', sales_mode: salesMode }],
    trip_departures: [{ id: 'd1', tenant_id: 't1', departs_on: '2026-12-01', start_time: '09:30:00' }],
    tenant_payment_methods: [],
  };
}

describe('#941 notifyOwnerNewTourOrder', () => {
  beforeEach(() => { state.multicast = []; state.tenantErr = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });

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
    expect(state.multicast[0].msgs[0].text).toContain('【祕島小舖】新預約申請（待審）');
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
