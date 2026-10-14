import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingExportQuerySchema, buildBookingsCsvResponse } from '../../src/server/export-bookings';
import { ilikeAnyOf } from '../../src/server/postgrest-filter';
import { exportBookingsCsv } from '../../src/services/reports';

// 讓 adapt() 走真實分支（mock 分支不會發出請求）
vi.mock('@/config/env', async (orig) => ({ ...(await orig<object>()), USE_MOCK: false }));

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

function mockSupabase() {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'or', 'gte', 'lt', 'order']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, ...args]); return builder; };
  }
  builder.then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
  const supabase = { from: (t: string) => { calls.push(['from', t]); return builder; } };
  return { supabase: supabase as unknown as SupabaseClient, calls };
}

describe('issue #974: 預約匯出套用列表篩選', () => {
  it('schema 接受新參數並與列表同語意解析', () => {
    const q = bookingExportQuerySchema.parse({
      status: 'PENDING', statuses: 'PENDING,CONFIRMED', excludeCancelled: 'true',
      paymentStatus: 'UNPAID', keyword: 'a,b', startBefore: '2026-10-14T00:00:00Z',
    });
    expect(q.statuses).toEqual(['PENDING', 'CONFIRMED']);
    expect(q.excludeCancelled).toBe(true);
    expect(bookingExportQuerySchema.parse({}).excludeCancelled).toBe(false);
  });

  it('schema 拒絕不合法的狀態、付款狀態、statuses、startBefore', () => {
    expect(() => bookingExportQuerySchema.parse({ status: 'BOGUS' })).toThrow();
    expect(() => bookingExportQuerySchema.parse({ paymentStatus: 'NOPE' })).toThrow();
    expect(() => bookingExportQuerySchema.parse({ statuses: 'PENDING,BOGUS' })).toThrow();
    expect(() => bookingExportQuerySchema.parse({ startBefore: 'tomorrow' })).toThrow();
    expect(() => bookingExportQuerySchema.parse({ excludeCancelled: 'yes' })).toThrow();
  });

  it('query 依篩選呼叫 eq／neq／in／or，且仍以 tenant_id 範圍查詢', async () => {
    const { supabase, calls } = mockSupabase();
    const q = bookingExportQuerySchema.parse({
      status: 'CONFIRMED', statuses: 'PENDING,CONFIRMED', excludeCancelled: 'true',
      paymentStatus: 'PAID_ONLINE', keyword: '50%,(x)', startBefore: '2026-10-14T00:00:00Z',
    });
    await buildBookingsCsvResponse(supabase, 't1', q);
    expect(calls).toContainEqual(['from', 'bookings_view']);
    expect(calls).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(calls).toContainEqual(['eq', 'status', 'CONFIRMED']);
    expect(calls).toContainEqual(['in', 'status', ['PENDING', 'CONFIRMED']]);
    expect(calls).toContainEqual(['neq', 'status', 'CANCELLED']);
    expect(calls).toContainEqual(['eq', 'payment_status', 'PAID_ONLINE']);
    expect(calls).toContainEqual(['lt', 'start_at', '2026-10-14T00:00:00Z']);
    // 與列表同一個跳脫 helper
    expect(calls).toContainEqual(['or', ilikeAnyOf(['customer_name', 'customer_phone', 'booking_no'], '50%,(x)')]);
  });

  it('沒有篩選時不加任何額外條件', async () => {
    const { supabase, calls } = mockSupabase();
    await buildBookingsCsvResponse(supabase, 't1', bookingExportQuerySchema.parse({}));
    expect(calls.filter(([m]) => ['neq', 'in', 'or', 'lt'].includes(m))).toEqual([]);
    expect(calls.filter(([m, c]) => m === 'eq' && c !== 'tenant_id')).toEqual([]);
  });

  it('列表與匯出共用同一份篩選實作；兩條路由共用 schema', () => {
    const list = read('src/app/api/bookings/route.ts');
    const shared = read('src/server/export-bookings.ts');
    expect(list).toContain("from '@/server/bookings-filter'");
    expect(shared).toContain("from '@/server/bookings-filter'");
    expect(shared).not.toContain('ilike');
    for (const r of ['src/app/api/export/bookings/route.ts', 'src/app/api/export/bookings/[format]/route.ts']) {
      expect(read(r)).toContain('bookingExportQuerySchema.parse');
    }
  });

  it('service URL 帶上篩選參數', async () => {
    const urls: string[] = [];
    const g = globalThis as unknown as { fetch: unknown };
    const orig = g.fetch;
    g.fetch = async (u: string) => { urls.push(String(u)); return new Response('x', { status: 500 }); };
    try {
      await exportBookingsCsv({
        status: 'PENDING', statuses: ['PENDING', 'CONFIRMED'], excludeCancelled: true,
        paymentStatus: 'UNPAID', keyword: ' 王 ', startBefore: '2026-10-14T00:00:00Z',
      }).catch(() => undefined);
    } finally { g.fetch = orig; }
    expect(urls).toHaveLength(1);
    const u = new URL(urls[0], 'http://x');
    expect(u.pathname).toMatch(/\/api\/export\/bookings\/csv$/);
    expect(u.searchParams.get('status')).toBe('PENDING');
    expect(u.searchParams.get('statuses')).toBe('PENDING,CONFIRMED');
    expect(u.searchParams.get('excludeCancelled')).toBe('true');
    expect(u.searchParams.get('paymentStatus')).toBe('UNPAID');
    // 與列表一致：關鍵字原樣（含前後空白）送出，不 trim
    expect(u.searchParams.get('keyword')).toBe(' 王 ');
    expect(urls[0]).toContain('keyword=+%E7%8E%8B+');
    expect(u.searchParams.get('startBefore')).toBe('2026-10-14T00:00:00Z');
  });

  it('頁面 runExport 沿用 load 儲存的篩選，且不再自行取時間', () => {
    const page = read('src/app/tenant/bookings/page.tsx');
    const fn = page.slice(page.indexOf('const runExport'), page.indexOf('批次操作'));
    // load 在成功取得列表後，把實際送出的篩選存進 ref
    expect(page).toContain('lastListFiltersRef.current = filterParams');
    expect(page).toContain('satisfies ExportBookingsQuery');
    const assign = page.indexOf('lastListFiltersRef.current = filterParams');
    // ref 寫入在 bookingId 補查 await 之後，且緊鄰 setRows（同一個同步區段）
    expect(assign).toBeGreaterThan(page.indexOf('bookingId: requestedBookingId'));
    expect(assign).toBeGreaterThan(page.indexOf('await listBookings({ ...filterParams, page, size: PAGE_SIZE })'));
    expect(page.indexOf('setRows(list)', assign) - assign).toBeLessThan(120);
    expect(page.slice(assign, page.indexOf('setRows(list)', assign))).not.toContain('await');
    // 頁碼超出範圍的重載分支不寫入 ref
    const reload = page.slice(page.indexOf('setPage(Math.max(0, res.totalPages - 1))'), assign);
    expect(reload.indexOf('return;')).toBeGreaterThan(-1);
    // catch 清空列表時同步把 ref 設為 null，匯出改顯示 exportNotReady
    const catchBlock = page.slice(page.indexOf('} catch (e) {', assign), page.indexOf('} finally {', assign));
    expect(catchBlock).toContain('setRows([])');
    expect(catchBlock).toContain('lastListFiltersRef.current = null');
    // runExport 直接使用該 ref，不重組篩選、不呼叫 new Date()
    expect(fn).toContain('lastListFiltersRef.current');
    expect(fn).toContain('download(filters)');
    expect(fn).not.toContain('new Date');
    for (const k of ['statuses:', 'excludeCancelled:', 'paymentStatus:', 'keyword:', 'startBefore:']) {
      expect(fn).not.toContain(k);
    }
  });
});
