/**
 * #873 手動建單的收款方式：route 驗證、列表／詳情標籤對映、頁面不再用 mock 常數。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TENANT = '11111111-1111-4111-8111-111111111111';
const DEP = '22222222-2222-4222-8222-222222222222';
const OWN = '33333333-3333-4333-8333-333333333333';
const OFF = '44444444-4444-4444-8444-444444444444';
const FOREIGN = '55555555-5555-4555-8555-555555555555';

const methodRows: Record<string, { id: string; active: boolean; tenant: string; display_name: string }> = {
  [OWN]: { id: OWN, active: true, tenant: TENANT, display_name: '現金' },
  [OFF]: { id: OFF, active: false, tenant: TENANT, display_name: '停用' },
  [FOREIGN]: { id: FOREIGN, active: true, tenant: 'other', display_name: '別家' },
};
const rpcCalls: any[] = [];

function chain(table: string) {
  const f: Record<string, any> = {};
  const q = { table, eq: {} as Record<string, any> };
  const b: any = {
    select: () => b,
    eq: (k: string, v: any) => { q.eq[k] = v; return b; },
    in: () => b,
    maybeSingle: async () => {
      if (table === 'trip_departures') return { data: { id: DEP, status: 'OPEN' }, error: null };
      if (table === 'tenant_payment_methods') {
        const r = methodRows[q.eq.id];
        return { data: r && r.tenant === q.eq.tenant_id ? { id: r.id, active: r.active } : null, error: null };
      }
      if (table === 'tour_orders') return { data: { id: 'o1', payment_method_id: rpcCalls.at(-1)?.p_payment_method ?? null }, error: null };
      return { data: null, error: null };
    },
    then: (res: any) => res({ data: [], error: null }),
  };
  void f;
  return b;
}
const supabase = {
  from: (t: string) => chain(t),
  rpc: async (_n: string, args: any) => { rpcCalls.push(args); return { data: 'o1', error: null }; },
};

vi.mock('@/server/tenant', () => ({
  requireTenantManager: async () => ({ tenantId: TENANT, supabase }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock('@/server/features', () => ({ requireFeature: async () => undefined }));
vi.mock('@/server/tour-order-no', () => ({ nextTourOrderNo: async () => 'TO2610130001' }));
vi.mock('@/server/tour-orders', () => ({ hydrateTourOrders: async () => [{ id: 'o1' }] }));

import { POST } from '@/app/api/tour-orders/manual/route';

const call = (paymentMethodId: unknown) =>
  POST(new Request('http://x/api/tour-orders/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      departureId: DEP, customerName: 'A', customerPhone: '0900', partySize: 2, paymentMethodId,
    }),
  }) as any, {} as any);

describe('POST /api/tour-orders/manual 收款方式驗證（#873）', () => {
  beforeEach(() => { rpcCalls.length = 0; });

  for (const [name, id] of [['非 uuid', 'pm_1'], ['不存在', '66666666-6666-4666-8666-666666666666'],
    ['他店', FOREIGN], ['已停用', OFF]] as const) {
    it(`${name} → 400 且不建單`, async () => {
      const res = await call(id);
      expect(res.status).toBe(400);
      expect(rpcCalls).toHaveLength(0);
    });
  }

  it('本店啟用中的 id → 成功並傳進 rpc', async () => {
    const res = await call(OWN);
    expect(res.status).toBe(200);
    expect(rpcCalls[0].p_payment_method).toBe(OWN);
  });

  it('未提供／空字串 → 成功且 p_payment_method=null', async () => {
    expect((await call('')).status).toBe(200);
    expect((await call(null)).status).toBe(200);
    expect(rpcCalls.map((c) => c.p_payment_method)).toEqual([null, null]);
  });
});

describe('hydrateTourOrders 收款方式標籤（#873）', () => {
  it('以租戶範圍查詢並對映 display_name；查不到為空字串', async () => {
    vi.resetModules();
    vi.doUnmock('@/server/tour-orders');
    const { hydrateTourOrders } = await import('@/server/tour-orders');
    const seen: any[] = [];
    const sb: any = {
      from: (table: string) => {
        const eqs: Record<string, any> = {};
        const b: any = {
          select: () => b,
          eq: (k: string, v: any) => { eqs[k] = v; return b; },
          in: (_k: string, vals: string[]) => { seen.push({ table, eqs: { ...eqs }, vals }); return b; },
          then: (res: any) => res({
            data: table === 'tenant_payment_methods' ? [{ id: OWN, display_name: '現金' }] : [],
            error: null,
          }),
        };
        return b;
      },
    };
    const base = { trip_id: 't', plan_id: 'p', departure_id: 'd', status: 'PENDING' };
    const out = await hydrateTourOrders(sb, TENANT, [
      { ...base, id: 'a', payment_method_id: OWN },
      { ...base, id: 'b', payment_method_id: FOREIGN },
      { ...base, id: 'c', payment_method_id: null },
    ]);
    expect(out.map((o) => o.paymentMethodLabel)).toEqual(['現金', '', '']);
    const q = seen.find((s) => s.table === 'tenant_payment_methods');
    expect(q.eqs.tenant_id).toBe(TENANT);
    expect([...q.vals].sort()).toEqual([FOREIGN, OWN].sort());
  });
});

describe('tour-orders 頁面（#873）', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/app/tenant/tour-orders/page.tsx'), 'utf8');
  it('不再含 MOCK_PAYMENT_METHODS，改呼叫 listPaymentMethods', () => {
    expect(page).not.toContain('MOCK_PAYMENT_METHODS');
    expect(page).toContain('listPaymentMethods');
    expect(page).toContain('/tenant/payment-methods');
  });
  it('收款方式載入中停用送出並在 handler 擋下', () => {
    expect(page).toMatch(/disabled=\{[^}]*payState === 'loading'\}/);
    expect(page).toContain("if (payState === 'loading') return;");
  });
});
