/**
 * #754 Codex P1 — 代登入期間 GET /api/auth/my-tenants 只回代入目標一筆，
 * 且絕不查 tenant_users（管理者自己的成員資格與代入目標無關）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ctx: null as any,
  fromTables: [] as string[],
}));

vi.mock('@/server/tenant', () => ({ requireTenant: async () => state.ctx }));

import { GET } from '@/app/api/auth/my-tenants/route';

const TARGET = '11111111-1111-4111-8111-111111111111';
const OWN = '22222222-2222-4222-8222-222222222222';

function supabaseWithMemberships(rows: any[]) {
  return {
    from: (table: string) => {
      state.fromTables.push(table);
      return { select: () => ({ eq: async () => ({ data: rows, error: null }) }) };
    },
  };
}

const call = async () => {
  const res = await GET(new Request('http://localhost/api/auth/my-tenants'), {});
  return res.json();
};

beforeEach(() => { state.fromTables = []; });

describe('my-tenants 代登入', () => {
  it('代入中：只回目標店一筆（含 business_type），不查 tenant_users', async () => {
    state.ctx = {
      supabase: supabaseWithMemberships([
        { tenant_id: OWN, role: 'OWNER', tenants: { shop_code: 'own', name: '管理者自己的店', business_type: 'CLINIC' } },
      ]),
      user: { id: 'admin-1' },
      tenantId: TARGET, role: 'OWNER', shopCode: 'target-shop', tenantName: '代入目標店', businessType: 'GUIDE',
      impersonation: { tenantId: TARGET },
    };
    const body = await call();
    expect(body.data).toEqual([
      { id: TARGET, shopCode: 'target-shop', name: '代入目標店', role: 'OWNER', current: true, businessType: 'GUIDE' },
    ]);
    expect(state.fromTables).toEqual([]);
  });

  it('非代入：沿用 tenant_users 查詢，行為不變', async () => {
    state.ctx = {
      supabase: supabaseWithMemberships([
        { tenant_id: OWN, role: 'MANAGER', tenants: { shop_code: 'own', name: '自己的店', business_type: 'CLINIC' } },
        { tenant_id: TARGET, role: 'STAFF', tenants: { shop_code: 't', name: '另一店', business_type: null } },
      ]),
      user: { id: 'u-1' },
      tenantId: OWN, role: 'MANAGER', shopCode: 'own', tenantName: '自己的店', businessType: 'CLINIC',
      impersonation: null,
    };
    const body = await call();
    expect(state.fromTables).toEqual(['tenant_users']);
    expect(body.data.map((x: any) => [x.id, x.current, x.businessType])).toEqual([
      [OWN, true, 'CLINIC'],
      [TARGET, false, undefined],
    ]);
  });
});
