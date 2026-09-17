/**
 * tests/unit/promotion-stats-route.23.test.ts
 * -----------------------------------------------------------------------------
 * 守 `GET /api/promotion/stats`（Issue #23）：query-time aggregation 的計數
 * 邏輯（PV=N、同 hash 只算一次 UV、bySource/byDay 分組）、7/30/90 天邊界、
 * 零資料 contract、以及 A 店看不到 B 店事件（tenant 隔離）。用
 * `vi.mock('@/server/tenant', …)`（同 tests/unit/line-disconnect-route.47.test.ts
 * 的手法）餵一組固定 rows 給假 supabase client，不碰真 DB。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = { tenant_id: string; source: string; visitor_hash: string; created_at: string };

const TEST_NOW = new Date('2026-09-15T12:00:00Z');
let currentTenantId = 'tenant-a';
let seededRows: Row[] = [];

function makeFakeSupabase() {
  return {
    from: (table: string) => {
      if (table !== 'page_view_events') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            if (col !== 'tenant_id') throw new Error(`unexpected eq col: ${col}`);
            return {
              gte: async (dateCol: string, fromIso: string) => {
                if (dateCol !== 'created_at') throw new Error(`unexpected gte col: ${dateCol}`);
                const rows = seededRows.filter(
                  (r) => r.tenant_id === val && r.created_at >= fromIso,
                );
                return { data: rows, error: null as { message: string } | null };
              },
            };
          },
        }),
      };
    },
  };
}

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: makeFakeSupabase(), tenantId: currentTenantId }),
}));

import { GET } from '@/app/api/promotion/stats/route';

async function callRoute(range?: string) {
  const url = range
    ? `http://localhost/api/promotion/stats?range=${range}`
    : 'http://localhost/api/promotion/stats';
  const res = await GET(new Request(url), { params: Promise.resolve({}) });
  const body = await res.json();
  return { status: res.status, body };
}

/** N 小時前的 ISO；基準時鐘由測試固定，避免 fixture 隨真實日期老化。 */
function hoursAgoIso(hours: number, from = TEST_NOW): string {
  return new Date(from.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe('GET /api/promotion/stats（issue #23）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW);
    currentTenantId = 'tenant-a';
    seededRows = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('零資料：回傳 issue #23 的零資料 contract 逐字', async () => {
    const { status, body } = await callRoute('7');
    expect(status).toBe(200);
    expect(body.data).toEqual({
      pv: 0,
      uv: 0,
      bySource: [],
      byDay: [],
      approximate: true,
      hasData: false,
    });
  });

  it('N 筆事件 → PV=N；同一 visitor_hash 只算一次 UV', async () => {
    seededRows = [
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'h1', created_at: hoursAgoIso(1) },
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'h1', created_at: hoursAgoIso(2) },
      { tenant_id: 'tenant-a', source: 'LINE', visitor_hash: 'h2', created_at: hoursAgoIso(3) },
    ];
    const { body } = await callRoute('7');
    expect(body.data.pv).toBe(3);
    expect(body.data.uv).toBe(2);
    expect(body.data.hasData).toBe(true);
    expect(body.data.approximate).toBe(true);
  });

  it('bySource 依來源分組各自算 pv/uv', async () => {
    seededRows = [
      { tenant_id: 'tenant-a', source: 'QR', visitor_hash: 'h1', created_at: hoursAgoIso(1) },
      { tenant_id: 'tenant-a', source: 'QR', visitor_hash: 'h2', created_at: hoursAgoIso(2) },
      { tenant_id: 'tenant-a', source: 'LINE', visitor_hash: 'h3', created_at: hoursAgoIso(3) },
    ];
    const { body } = await callRoute('7');
    const bySource: { source: string; pv: number; uv: number }[] = body.data.bySource;
    const qr = bySource.find((s) => s.source === 'QR');
    const line = bySource.find((s) => s.source === 'LINE');
    expect(qr).toEqual({ source: 'QR', pv: 2, uv: 2 });
    expect(line).toEqual({ source: 'LINE', pv: 1, uv: 1 });
  });

  it('7 天邊界：8 天前的事件不應計入 range=7', async () => {
    seededRows = [
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'in', created_at: hoursAgoIso(24 * 3) },
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'out', created_at: hoursAgoIso(24 * 8) },
    ];
    // 假 supabase 的 gte 已經照 fromIso 過濾，等同真實查詢的邊界行為；這裡驗證
    // route 傳給 gte() 的 fromIso 確實把「8 天前」排除在外。
    const { body } = await callRoute('7');
    expect(body.data.pv).toBe(1);
  });

  it('30 天與 90 天：同一批資料在較長 range 應涵蓋更多事件', async () => {
    seededRows = [
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'a', created_at: hoursAgoIso(24 * 5) },
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'b', created_at: hoursAgoIso(24 * 20) },
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'c', created_at: hoursAgoIso(24 * 60) },
    ];
    expect((await callRoute('7')).body.data.pv).toBe(1);
    expect((await callRoute('30')).body.data.pv).toBe(2);
    expect((await callRoute('90')).body.data.pv).toBe(3);
  });

  it('不合法 range 退回 7 天預設，不 500', async () => {
    seededRows = [
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'a', created_at: hoursAgoIso(1) },
    ];
    const { status, body } = await callRoute('not-a-number');
    expect(status).toBe(200);
    expect(body.data.pv).toBe(1);
  });

  it('tenant 隔離：A 店的統計看不到 B 店事件', async () => {
    seededRows = [
      { tenant_id: 'tenant-a', source: 'DIRECT', visitor_hash: 'a1', created_at: hoursAgoIso(1) },
      { tenant_id: 'tenant-b', source: 'DIRECT', visitor_hash: 'b1', created_at: hoursAgoIso(1) },
      { tenant_id: 'tenant-b', source: 'DIRECT', visitor_hash: 'b2', created_at: hoursAgoIso(1) },
    ];
    const a = await callRoute('7');
    expect(a.body.data.pv).toBe(1);
    expect(a.body.data.uv).toBe(1);

    currentTenantId = 'tenant-b';
    const b = await callRoute('7');
    expect(b.body.data.pv).toBe(2);
    expect(b.body.data.uv).toBe(2);
  });
});
