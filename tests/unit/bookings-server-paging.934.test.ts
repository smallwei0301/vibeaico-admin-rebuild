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

describe('#934 startBefore（未處理）', () => {
  it('route 帶 startBefore 走 .lt(start_at)，與 to 日界線並存', async () => {
    state.sb = makeSb();
    const sbv = '2026-10-13T05:00:00.000Z';
    const res = await get(`statuses=PENDING,CONFIRMED&startBefore=${encodeURIComponent(sbv)}&to=2026-10-20`);
    expect(res.status).toBe(200);
    expect(state.sb.calls).toContainEqual(['lt', 'start_at', sbv]);
    expect(state.sb.calls.find((c: any[]) => c[0] === 'lte' && c[1] === 'start_at')).toBeDefined();
  });
  it('未帶 startBefore 不加 .lt', async () => {
    state.sb = makeSb();
    await get('page=0');
    expect(state.sb.calls.find((c: any[]) => c[0] === 'lt')).toBeUndefined();
  });
  it('非法 startBefore 回 400 且不查詢', async () => {
    for (const bad of ['abc', '2026-13-45T00:00:00Z', '2026-10-13', '2026-02-30T00:00:00Z', '2026-10-13T10:00:00']) {
      state.sb = makeSb();
      const res = await get(`startBefore=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
      expect(state.sb.calls.find((c: any[]) => c[0] === 'lt')).toBeUndefined();
    }
  });
  it('帶時區偏移、毫秒／微秒與頁面 toISOString 格式皆通過並原樣傳給 .lt', async () => {
    for (const ok of ['2026-10-13T10:00:00+08:00', '2026-10-13T10:00:00.123Z', '2026-10-13T10:00:00.123456Z', '2026-10-13T10:00:00Z', new Date().toISOString()]) {
      state.sb = makeSb();
      const res = await get(`startBefore=${encodeURIComponent(ok)}`);
      expect(res.status).toBe(200);
      expect(state.sb.calls).toContainEqual(['lt', 'start_at', ok]);
    }
  });
  it('mock 分支以 startAt < startBefore 過濾（嚴格小於）', async () => {
    const pivot = MOCK_BOOKINGS[0].startAt;
    const r = await listBookings({ startBefore: pivot, size: 100 });
    expect(r.content.every((b) => Date.parse(b.startAt) < Date.parse(pivot))).toBe(true);
    expect(r.content.some((b) => b.startAt === pivot)).toBe(false);
  });
  const src = readFileSync('src/app/tenant/bookings/page.tsx', 'utf8');
  it('頁面未處理查詢組成：statuses＋startBefore＋原樣 to；不再使用 unprocessedEndBound', () => {
    expect(src).toMatch(/statuses: status === 'UNPROCESSED' \? \(\['PENDING', 'CONFIRMED'\]/);
    expect(src).toMatch(/to: endDate \|\| undefined,/);
    expect(src).toMatch(/startBefore: status === 'UNPROCESSED' \? new Date\(\)\.toISOString\(\)/);
    expect(src).not.toContain('unprocessedEndBound');
  });
  it('keyword 變更時重置頁碼', () => {
    expect(src).toMatch(/setKeyword\(e\.target\.value\); setPage\(0\);/);
  });
});

describe('#934 穩定排序（id 次排序鍵）', () => {
  it('GET 依序 .order(start_at desc) 再 .order(id desc)，且在 range 之前', async () => {
    state.sb = makeSb();
    await get('page=1&size=20');
    const c: any[][] = state.sb.calls;
    const orders = c.filter((x) => x[0] === 'order');
    expect(orders).toEqual([
      ['order', 'start_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
    ]);
    const idx = (n: string) => c.findIndex((x) => x[0] === n);
    expect(c.findIndex((x) => x[0] === 'order' && x[1] === 'id')).toBeLessThan(idx('range'));
  });
  it('mock 分支固定順序下，相鄰兩頁不重複不遺漏（含同時段資料）', async () => {
    const size = 3;
    const total = (await listBookings({ page: 0, size: 1000 })).content.map((b) => b.id);
    const seen: string[] = [];
    for (let p = 0; p * size < total.length; p++) {
      seen.push(...(await listBookings({ page: p, size })).content.map((b) => b.id));
    }
    expect(seen).toEqual(total);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
