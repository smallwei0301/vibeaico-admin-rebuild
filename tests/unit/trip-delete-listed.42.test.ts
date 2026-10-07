import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';
import { canDeleteTrip } from '@/lib/trip-deletion';

// Fake DB only：驗證 route 行為與 tenant／LISTED 條件，不是 live DB 驗收。
const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], deletes: 0, deleteFilters: [] as [string, string, unknown][],
  listAfterRead: false,
}));
vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tenant', () => {
  const tenant = { tenantId: 'tenant-a', supabase: { from: () => {
    const filters: [string, string, unknown][] = [];
    let isDelete = false;
    const match = () => db.rows.filter((r) => filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : r[k] !== v)));
    const query = {
      select: () => query,
      eq: (k: string, v: unknown) => { filters.push(['eq', k, v]); return query; },
      neq: (k: string, v: unknown) => { filters.push(['neq', k, v]); return query; },
      delete: () => { isDelete = true; return query; },
      maybeSingle: async () => {
        if (isDelete) {
          db.deletes++; db.deleteFilters = [...filters];
          const hit = match()[0] ?? null;
          if (hit) db.rows = db.rows.filter((r) => r !== hit);
          return { data: hit, error: null };
        }
        return { data: match()[0] ?? null, error: null };
      },
    };
    return query;
  } } };
  return { requireTenantManager: async () => tenant, requireTenant: async () => tenant };
});
import { DELETE } from '@/app/api/trips/[id]/route';

const del = (id: string) => DELETE(new Request('http://localhost/api/trips/x', { method: 'DELETE' }), { params: Promise.resolve({ id }) });
beforeEach(() => { db.deletes = 0; db.deleteFilters = []; });

describe('#42 DELETE /api/trips/[id] LISTED 擋閘', () => {
  it('LISTED 回 409 REQ_003 且完全不呼叫 delete', async () => {
    db.rows = [{ id: 't1', tenant_id: 'tenant-a', midao_listing: 'LISTED' }];
    const res = await del('t1');
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe('REQ_003');
    expect(body.message).toBe(tripsPage.actions.deleteListedBlocked);
    expect(db.deletes).toBe(0);
    expect(db.rows).toHaveLength(1);
  });

  it.each(['NONE', 'PENDING', 'REJECTED'])('%s 照常刪除，且帶 tenant_id 與 neq LISTED 條件', async (state) => {
    db.rows = [{ id: 't1', tenant_id: 'tenant-a', midao_listing: state }];
    const res = await del('t1');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: true });
    expect(db.deletes).toBe(1);
    expect(db.deleteFilters).toContainEqual(['eq', 'tenant_id', 'tenant-a']);
    expect(db.deleteFilters).toContainEqual(['neq', 'midao_listing', 'LISTED']);
    expect(db.rows).toHaveLength(0);
  });

  it('不存在或他租戶回 404，不刪', async () => {
    db.rows = [{ id: 't1', tenant_id: 'tenant-b', midao_listing: 'NONE' }];
    const res = await del('t1');
    expect(res.status).toBe(404);
    expect(db.deletes).toBe(0);
  });

  it('讀寫之間被上架：delete 回 0 列且列仍在，回 409 而非 404', async () => {
    const row: Record<string, unknown> = { id: 't1', tenant_id: 'tenant-a', midao_listing: 'NONE' };
    db.rows = [row];
    let reads = 0;
    Object.defineProperty(row, 'midao_listing', { configurable: true, get() { reads++; return reads <= 1 ? 'NONE' : 'LISTED'; } });
    const res = await del('t1');
    expect(res.status).toBe(409);
    expect(db.rows).toHaveLength(1);
  });
});

describe('#42 canDeleteTrip 與 UI／mock 接線', () => {
  it('只有 LISTED 不可刪', () => {
    expect(canDeleteTrip({ midaoListing: 'LISTED' })).toBe(false);
    for (const s of ['NONE', 'PENDING', 'REJECTED'] as const) expect(canDeleteTrip({ midaoListing: s })).toBe(true);
  });
  it('列表頁刪除按鈕 disabled 並用 i18n title；mock deleteTrip 同規則', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/tenant/trips/page.tsx'), 'utf8');
    expect(page).toContain('disabled={!canDeleteTrip(r)}');
    expect(page).toContain('t.actions.deleteListedBlocked');
    const svc = readFileSync(resolve(process.cwd(), 'src/services/tours.ts'), 'utf8');
    expect(svc).toMatch(/!canDeleteTrip\(MOCK_TRIPS\[idx\]\)\) \{\s*throw new ApiError\(tripsPage\.actions\.deleteListedBlocked, 'REQ_003', 409\)/);
  });
});
