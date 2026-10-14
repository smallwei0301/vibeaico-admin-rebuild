import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingExportQuerySchema, buildBookingsCsvResponse } from '../../src/server/export-bookings';
import { ilikeAnyOf } from '../../src/server/postgrest-filter';
import { exportBookingsCsv } from '../../src/services/reports';

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
    const src = read('src/services/reports.ts');
    for (const k of ['status', 'statuses', 'excludeCancelled', 'paymentStatus', 'keyword', 'startBefore']) {
      expect(src).toContain(`params.set('${k}'`);
    }
  });

  it('頁面 runExport 傳入列表篩選', () => {
    const page = read('src/app/tenant/bookings/page.tsx');
    const fn = page.slice(page.indexOf('const runExport'), page.indexOf('批次操作'));
    for (const k of ['statuses:', 'status:', 'excludeCancelled:', 'paymentStatus: paymentStatusFilter', 'keyword:', 'startBefore:']) {
      expect(fn).toContain(k);
    }
  });
});
