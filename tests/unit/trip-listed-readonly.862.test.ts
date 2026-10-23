import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';

// Fake DB only：驗證 route 行為與 LISTED 條件，不是 live DB 驗收。
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], updates: 0 }));
vi.mock('@/config/env', () => ({ USE_MOCK: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tenant', () => {
  const tenant = { tenantId: 'tenant-a', supabase: { from: () => {
    const filters: [string, string, unknown][] = [];
    let patch: Record<string, unknown> | null = null;
    const match = () => db.rows.filter((r) => filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : r[k] !== v)));
    const query = {
      select: () => query,
      eq: (k: string, v: unknown) => { filters.push(['eq', k, v]); return query; },
      neq: (k: string, v: unknown) => { filters.push(['neq', k, v]); return query; },
      update: (p: Record<string, unknown>) => { patch = p; return query; },
      maybeSingle: async () => {
        const hit = match()[0] ?? null;
        if (patch && hit) { db.updates++; Object.assign(hit, patch); }
        return { data: hit, error: null };
      },
    };
    return query;
  } } };
  return { requireTenantManager: async () => tenant, requireTenant: async () => tenant };
});
import { PUT } from '@/app/api/trips/[id]/route';

const put = (id: string, body: unknown) => PUT(
  new Request('http://localhost/api/trips/x', { method: 'PUT', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);
beforeEach(() => { db.updates = 0; });

describe('#862 已上架 Midao 行程基本欄位唯讀', () => {
  it.each([{ title: '新標題' }, { summary: 'x' }, { meetingPoint: 'y' }, { refundPolicyType: 'FLEXIBLE' }])(
    'LISTED 行程 PUT %j 回 409 REQ_003 且未寫入', async (body) => {
      db.rows = [{ id: 't1', tenant_id: 'tenant-a', midao_listing: 'LISTED', title: '舊' }];
      const res = await put('t1', body);
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('REQ_003');
      expect(json.message).toBe(tripsPage.actions.basicListedBlocked);
      expect(db.updates).toBe(0);
      expect(db.rows[0].title).toBe('舊');
    });

  it('LISTED 行程 PUT 封面仍回封面專用 409 訊息', async () => {
    db.rows = [{ id: 't1', tenant_id: 'tenant-a', midao_listing: 'LISTED' }];
    const res = await put('t1', { coverImageUrl: 'https://x.test/a.jpg' });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe(tripsPage.actions.coverListedBlocked);
    expect(db.updates).toBe(0);
  });

  it.each(['NONE', 'PENDING', 'REJECTED'])('%s 行程照常更新', async (state) => {
    db.rows = [{ id: 't1', tenant_id: 'tenant-a', midao_listing: state, title: '舊' }];
    const res = await put('t1', { title: '新標題' });
    expect(res.status).toBe(200);
    expect(db.updates).toBe(1);
    expect(db.rows[0].title).toBe('新標題');
  });

  it('不存在回 404；他租戶的行程也回 404', async () => {
    db.rows = [{ id: 't1', tenant_id: 'tenant-b', midao_listing: 'LISTED' }];
    expect((await put('nope', { title: 'x' })).status).toBe(404);
    expect((await put('t1', { title: 'x' })).status).toBe(404);
    expect(db.updates).toBe(0);
  });

  it('頁面：LISTED 時基本資料 fieldset disabled、儲存早退且停用、有說明文案', () => {
    const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
    expect(src).toContain("const listedBasicBlocked = trip?.midaoListing === 'LISTED';");
    expect(src).toContain('<fieldset disabled={listedBasicBlocked}');
    expect(src).toMatch(/const saveBasic = async \(\) => \{\s*if \(!form\) return;[\s\S]*?if \(listedBasicBlocked\) \{[\s\S]*?return;/);
    expect(src).toContain('disabled={coverBusy || listedBasicBlocked}');
    expect(src).toContain('t.form.basicListedReadonly');
    expect(tripsPage.form.basicListedReadonly).toBeTruthy();
  });

  it('route 無新增中文字面量（訊息走 i18n）', () => {
    const src = readFileSync('src/app/api/trips/[id]/route.ts', 'utf8');
    const put = src.slice(src.indexOf('export const PUT'), src.indexOf('export const DELETE'));
    expect(put).toContain("neq('midao_listing', 'LISTED')");
    expect(put).toContain('tripsPage.actions.basicListedBlocked');
  });
});
