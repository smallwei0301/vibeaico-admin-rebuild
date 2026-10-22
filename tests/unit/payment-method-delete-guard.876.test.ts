/**
 * DELETE /api/payment-methods/:id 的引用守門（Issue #876）
 * -----------------------------------------------------------------------------
 * `tour_orders.payment_method_id` 無 FK、無名稱快照：實體刪除會讓歷史訂單的收款方式
 * 變空白。route 必須先查 tour_orders，有引用就 409（改為停用）、查詢錯誤就拋錯，
 * 且兩種情況都不得呼叫 delete。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { table: string; op: string; eqs: Array<[string, unknown]> }[] = [];
let refResult: { count: number | null; error: { message: string } | null };
let deleteResult: { data: { id: string } | null; error: { message: string } | null };

function makeSupabase() {
  return {
    from: (table: string) => {
      const rec = { table, op: 'init', eqs: [] as Array<[string, unknown]> };
      calls.push(rec);
      const chain: any = {
        select: (_cols: string, opts?: unknown) => {
          if (rec.op === 'init') rec.op = opts ? 'count' : 'select';
          return chain;
        },
        delete: () => {
          rec.op = 'delete';
          return chain;
        },
        eq: (col: string, val: unknown) => {
          rec.eqs.push([col, val]);
          return chain;
        },
        maybeSingle: async () => deleteResult,
        then: (resolve: (v: unknown) => unknown) => resolve(refResult),
      };
      return chain;
    },
  };
}

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({ supabase: makeSupabase(), tenantId: 'tenant-A' }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { DELETE } from '@/app/api/payment-methods/[id]/route';

const run = () =>
  DELETE(new Request('http://t/api/payment-methods/pm-1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'pm-1' }),
  });

beforeEach(() => {
  calls.length = 0;
  refResult = { count: 0, error: null };
  deleteResult = { data: { id: 'pm-1' }, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('DELETE /api/payment-methods/:id 引用守門（#876）', () => {
  it('有訂單引用 → 409 CONFLICT，且沒有呼叫 delete', async () => {
    refResult = { count: 3, error: null };
    const res = await run();
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_003');
    expect(body.message).toContain('停用');
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('無引用 → 正常刪除', async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: true });
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual([
      'tour_orders:count',
      'tenant_payment_methods:delete',
    ]);
  });

  it('引用查詢出錯 → 拋錯（500），不得當作沒引用而刪除', async () => {
    refResult = { count: null, error: { message: 'boom' } };
    const res = await run();
    expect(res.status).toBe(500);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('引用查詢與刪除都帶 tenant_id 與 payment_method_id / id 篩選', async () => {
    await run();
    const ref = calls.find((c) => c.table === 'tour_orders')!;
    expect(ref.eqs).toContainEqual(['tenant_id', 'tenant-A']);
    expect(ref.eqs).toContainEqual(['payment_method_id', 'pm-1']);
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.eqs).toContainEqual(['tenant_id', 'tenant-A']);
    expect(del.eqs).toContainEqual(['id', 'pm-1']);
  });
});
