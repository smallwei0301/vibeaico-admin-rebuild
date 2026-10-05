/**
 * #748 route 層：超量 description／notes／清單在 POST /api/trips 與 PUT /api/trips/:id 被擋成
 * 400 REQ_001，且完全沒有呼叫 DB 寫入；只改標題的 PUT 打到歷史超量資料時回 200，
 * 且送進 DB 的 patch 不含五個文字欄位。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TRIP = '33333333-3333-4333-8333-333333333333';

const db = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  reads: 0,
  legacyRow: {} as Record<string, unknown>,
}));

vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tenant', () => ({
  requireTenantManager: async () => ({ tenantId: TENANT, supabase: fakeDb }),
  requireTenant: async () => ({ tenantId: TENANT, supabase: fakeDb }),
}));

const fakeDb = {
  from: (_table: string) => {
    let written: Record<string, unknown> | undefined;
    const query = {
      select: () => query,
      eq: () => query,
      update: (patch: Record<string, unknown>) => { db.updates.push(patch); written = patch; return query; },
      insert: (row: Record<string, unknown>) => { db.inserts.push(row); written = row; return query; },
      maybeSingle: async () => { db.reads++; return { data: { ...db.legacyRow, ...written }, error: null }; },
      single: async () => ({ data: { ...db.legacyRow, ...written }, error: null }),
    };
    return query;
  },
};

import { POST as createRoute } from '@/app/api/trips/route';
import { PUT as updateRoute } from '@/app/api/trips/[id]/route';

const json = (method: string, url: string, body: unknown) => new Request(url, {
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const put = (body: unknown) =>
  updateRoute(json('PUT', `http://localhost/api/trips/${TRIP}`, body), { params: Promise.resolve({ id: TRIP }) });
const post = (body: unknown) =>
  createRoute(json('POST', 'http://localhost/api/trips', body), { params: Promise.resolve({}) });

const items = (n: number) => Array.from({ length: n }, () => 'item');

const OVERSIZED = [
  ['description 5001', { description: 'a'.repeat(5001) }],
  ['notes 2001', { notes: 'a'.repeat(2001) }],
  ['exclusions 21 項', { exclusions: items(21) }],
  ['notices 單項 301 字', { notices: ['a'.repeat(301)] }],
  ['includes 21 項', { includes: items(21).join('\n') }],
] as const;

beforeEach(() => {
  db.updates = [];
  db.inserts = [];
  db.reads = 0;
  db.legacyRow = {
    id: TRIP, tenant_id: TENANT, slug: 'legacy', title: '舊標題', status: 'DRAFT',
    description: 'd'.repeat(6000), notes: 's'.repeat(2500), includes: items(25).join('\n'),
    exclusions: items(30), notices: ['n'.repeat(400)], gallery: [],
  };
});

describe('PUT /api/trips/:id', () => {
  it.each(OVERSIZED)('%s → 400 REQ_001，且沒有任何 DB 寫入', async (_label, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('REQ_001');
    expect(db.updates).toEqual([]);
    expect(db.inserts).toEqual([]);
  });

  it('只改標題打到歷史超量資料 → 200，patch 只有 title，不含五個文字欄位', async () => {
    const res = await put({ title: '新標題' });
    expect(res.status).toBe(200);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toEqual({ title: '新標題' });
    for (const key of ['description', 'notes', 'includes', 'exclusions', 'notices']) {
      expect(key in db.updates[0]).toBe(false);
    }
  });

  it('合規的明確清空（空字串、空陣列）照常寫入', async () => {
    const res = await put({ description: '', notes: '', includes: '', exclusions: [], notices: [] });
    expect(res.status).toBe(200);
    expect(db.updates[0]).toEqual({ description: '', notes: '', includes: '', exclusions: [], notices: [] });
  });
});

describe('POST /api/trips', () => {
  it.each(OVERSIZED)('%s → 400 REQ_001，且沒有任何 DB 寫入', async (_label, body) => {
    const res = await post({ title: '新行程', ...body });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('REQ_001');
    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it('剛好在上限內的內容照常寫入且原樣保存', async () => {
    const description = 'a'.repeat(5000);
    const res = await post({ title: '新行程', description, exclusions: items(20) });
    expect(res.status).toBe(200);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({ description, exclusions: items(20) });
  });
});
