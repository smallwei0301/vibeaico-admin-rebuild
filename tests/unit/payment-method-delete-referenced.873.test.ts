/**
 * #873 收款方式刪除保護：被訂單引用 → 409 不刪；未引用 → 刪除；查詢帶 tenant_id。頁面送出於載入中停用。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PM = '33333333-3333-4333-8333-333333333333';

let refCount = 0;
const eqCalls: Array<{ table: string; k: string; v: unknown }> = [];
const deleteCalls: string[] = [];

function chain(table: string) {
  let isDelete = false;
  const b: any = {
    select: () => b,
    delete: () => { isDelete = true; deleteCalls.push(table); return b; },
    eq: (k: string, v: unknown) => { eqCalls.push({ table, k, v }); return b; },
    maybeSingle: async () => ({ data: isDelete ? { id: PM } : null, error: null }),
    then: (res: any) => res({ count: refCount, data: null, error: null }),
  };
  return b;
}
vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ tenantId: TENANT, supabase: { from: (t: string) => chain(t) } }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { DELETE } from '@/app/api/payment-methods/[id]/route';

const call = () =>
  DELETE(new Request(`http://x/api/payment-methods/${PM}`, { method: 'DELETE' }) as any,
    { params: Promise.resolve({ id: PM }) } as any);

describe('DELETE /api/payment-methods/:id 被訂單引用（#873）', () => {
  beforeEach(() => { refCount = 0; eqCalls.length = 0; deleteCalls.length = 0; });

  it('被引用 → 409 且不呼叫 delete', async () => {
    refCount = 2;
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe('已有訂單使用此收款方式，請改為停用');
    expect(deleteCalls).toHaveLength(0);
  });

  it('未引用 → 刪除成功', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(deleteCalls).toEqual(['tenant_payment_methods']);
  });

  it('引用查詢帶 tenant_id 與 payment_method_id', async () => {
    await call();
    const q = eqCalls.filter((c) => c.table === 'tour_orders');
    expect(q).toContainEqual({ table: 'tour_orders', k: 'tenant_id', v: TENANT });
    expect(q).toContainEqual({ table: 'tour_orders', k: 'payment_method_id', v: PM });
  });
});

describe('tour-orders 頁面送出鈕（#873）', () => {
  const src = readFileSync(resolve(__dirname, '../../src/app/tenant/tour-orders/page.tsx'), 'utf8');
  it('收款方式載入中停用送出並在 handler 擋下', () => {
    expect(src).toMatch(/disabled=\{[^}]*payState === 'loading'\}/);
    expect(src).toContain("if (payState === 'loading') return;");
  });
});
