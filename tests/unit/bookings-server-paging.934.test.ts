/** issue #934：預約列表改為 server-side 分頁與篩選。 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ sb: null as any }));
vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ tenantId: 't1', supabase: state.sb }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/email/notify', () => ({ notifyBookingEvent: vi.fn() }));
vi.mock('@/server/owner-notify', () => ({ notifyOwnerNewBooking: vi.fn() }));

import { GET as listRoute } from '../../src/app/api/bookings/route';
import { listBookings } from '../../src/services/bookings';
import { unprocessedEndBound } from '../../src/lib/bookings-query-range';
import { MOCK_BOOKINGS } from '../../src/mock';

function makeSb(total = 250) {
  const calls: [string, ...any[]][] = [];
  const q: any = new Proxy({}, {
    get(_t, name: string) {
      if (name === 'then') {
        return (res: any, rej: any) => Promise.resolve({ data: [], count: total, error: null }).then(res, rej);
      }
      return (...args: any[]) => { calls.push([name, ...args]); return q; };
    },
  });
  return { calls, from: (table: string) => { calls.push(['from', table]); return q; } };
}
const get = (qs: string) => listRoute(new Request(`http://x/api/bookings?${qs}`), { params: Promise.resolve({}) } as any);
beforeEach(() => { vi.restoreAllMocks(); });

describe('#934 API 新查詢參數', () => {
  it('statuses 多值走 .in()，與單值 status 並存', async () => {
    state.sb = makeSb();
    const res = await get('statuses=PENDING,CONFIRMED&status=PENDING&to=2026-10-13T00:00:00.000Z&page=2&size=20');
    expect(res.status).toBe(200);
    const c = state.sb.calls;
    expect(c).toContainEqual(['in', 'status', ['PENDING', 'CONFIRMED']]);
    expect(c).toContainEqual(['eq', 'status', 'PENDING']);
    expect(c).toContainEqual(['lte', 'start_at', '2026-10-13T00:00:00.000Z']);
    expect(c).toContainEqual(['range', 40, 59]);
    const body = await res.json();
    expect(body.data.totalElements).toBe(250);
    expect(body.data.number).toBe(2);
  });

  it('excludeCancelled=true 走 .neq(status, CANCELLED)；未帶則不加', async () => {
    state.sb = makeSb();
    await get('excludeCancelled=true');
    expect(state.sb.calls).toContainEqual(['neq', 'status', 'CANCELLED']);
    state.sb = makeSb();
    await get('page=0');
    expect(state.sb.calls.find((c: any[]) => c[0] === 'neq')).toBeUndefined();
    expect(state.sb.calls.find((c: any[]) => c[0] === 'in')).toBeUndefined();
  });

  it('非法 statuses 值回 400，且不查詢 bookings_view', async () => {
    state.sb = makeSb();
    const res = await get('statuses=PENDING,BOGUS');
    expect(res.status).toBe(400);
    expect(state.sb.calls.find((c: any[]) => c[0] === 'in')).toBeUndefined();
  });

  it('既有單值非法 status 仍為 400', async () => {
    state.sb = makeSb();
    expect((await get('status=BOGUS')).status).toBe(400);
  });
});

describe('#934 頁面不再前端截斷／過濾', () => {
  const src = readFileSync('src/app/tenant/bookings/page.tsx', 'utf8');
  it('不再固定 size: 100，也沒有前端 slice 分頁', () => {
    expect(src).not.toMatch(/size:\s*100/);
    expect(src).not.toMatch(/list\.slice\(/);
    expect(src).not.toMatch(/setTotal\(list\.length\)/);
    expect(src).toMatch(/size:\s*PAGE_SIZE/);
    expect(src).toMatch(/setTotal\(res\.totalElements\)/);
  });
  it('換頁／篩選時 load 依賴 page', () => {
    expect(src).toMatch(/\[page, keyword, status,/);
  });
});

describe('#934 mock 分支分頁與篩選', () => {
  it('分頁：totalElements 為全量、content 依 page/size 切片', async () => {
    const all = MOCK_BOOKINGS.length;
    const p0 = await listBookings({ page: 0, size: 2 });
    expect(p0.totalElements).toBe(all);
    expect(p0.content.length).toBe(Math.min(2, all));
    expect(p0.totalPages).toBe(Math.ceil(all / 2));
    const p1 = await listBookings({ page: 1, size: 2 });
    expect(p1.content[0]?.id).toBe(MOCK_BOOKINGS[2]?.id);
  });
  it('statuses 與 excludeCancelled', async () => {
    const r = await listBookings({ statuses: ['PENDING', 'CONFIRMED'], size: 100 });
    expect(r.content.every((b) => b.status === 'PENDING' || b.status === 'CONFIRMED')).toBe(true);
    expect(r.totalElements).toBe(MOCK_BOOKINGS.filter((b) => b.status === 'PENDING' || b.status === 'CONFIRMED').length);
    const nc = await listBookings({ excludeCancelled: true, size: 100 });
    expect(nc.content.some((b) => b.status === 'CANCELLED')).toBe(false);
  });
  it('to 上界（未處理）與日期篩選', async () => {
    const now = new Date().toISOString();
    const r = await listBookings({ statuses: ['PENDING', 'CONFIRMED'], to: now, size: 100 });
    expect(r.content.every((b) => Date.parse(b.startAt) <= Date.parse(now))).toBe(true);
    const d = MOCK_BOOKINGS[0].startAt.slice(0, 10);
    const day = await listBookings({ from: d, to: d, size: 100 });
    expect(day.totalElements).toBeLessThanOrEqual(MOCK_BOOKINGS.length);
  });
});

describe('#934 unprocessedEndBound', () => {
  it('未來的結束日改用現在；過去的結束日沿用日期', () => {
    const now = new Date('2026-10-13T05:00:00.000Z');
    expect(unprocessedEndBound('2026-10-20', now)).toBe(now.toISOString());
    expect(unprocessedEndBound('2026-10-01', now)).toBe('2026-10-01');
    expect(unprocessedEndBound('', now)).toBeUndefined();
  });
});
