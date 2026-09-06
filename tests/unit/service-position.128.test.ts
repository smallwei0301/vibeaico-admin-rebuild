import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  insertServiceWithPositions,
  reserveServicePositions,
  reorderServices,
} from '@/server/service-position';

function queryResult(result: unknown) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function fakeSupabase(
  rpcResult: unknown,
  queryResults: unknown[] = [],
): SupabaseClient {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const from = vi.fn();
  for (const result of queryResults) from.mockReturnValueOnce(queryResult(result));
  return { rpc, from } as unknown as SupabaseClient;
}

describe('service position allocator (#128)', () => {
  it('prefers the existing atomic catalog RPC', async () => {
    const supabase = fakeSupabase({
      data: [{ sort_order: 4, line_sort_order: 9 }],
      error: null,
    });

    await expect(reserveServicePositions(supabase, 'tenant-a')).resolves.toEqual({
      sortOrder: 4,
      lineSortOrder: 9,
    });
    expect((supabase.rpc as any).mock.calls[0]).toEqual([
      'reserve_catalog_positions',
      { p_tenant_id: 'tenant-a', p_resource: 'services' },
    ]);
    expect((supabase.from as any).mock.calls).toHaveLength(0);
  });

  it('fails closed when the atomic allocator is absent', async () => {
    const supabase = fakeSupabase({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.reserve_catalog_positions',
      },
    });

    await expect(reserveServicePositions(supabase, 'tenant-a')).rejects.toMatchObject({
      code: 'PGRST202',
    });
  });

  it('retries only a unique-position race after atomic allocation', async () => {
    const supabase = fakeSupabase({
      data: [{ sort_order: 3, line_sort_order: 8 }],
      error: null,
    });
    (supabase.rpc as any)
      .mockResolvedValueOnce({ data: [{ sort_order: 2, line_sort_order: 7 }], error: null })
      .mockResolvedValueOnce({ data: [{ sort_order: 3, line_sort_order: 8 }], error: null });
    const insert = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "services_tenant_line_sort_order_uq"',
        },
      })
      .mockResolvedValueOnce({ data: { id: 'service-2' }, error: null });

    await expect(insertServiceWithPositions(supabase, 'tenant-a', insert)).resolves.toEqual({
      data: { id: 'service-2' },
      positions: { sortOrder: 3, lineSortOrder: 8 },
    });
    expect(insert.mock.calls.map(([positions]) => positions)).toEqual([
      { sortOrder: 2, lineSortOrder: 7 },
      { sortOrder: 3, lineSortOrder: 8 },
    ]);
  });

  it('expands a partial reorder while retaining untouched relative order', async () => {
    const supabase = fakeSupabase(
      { data: null, error: null },
      [{
        data: [
          { id: 'service-a', sort_order: 0 },
          { id: 'service-c', sort_order: 2 },
          { id: 'service-b', sort_order: 1 },
        ],
        error: null,
      }],
    );

    await expect(reorderServices(supabase, 'tenant-a', ['service-b'])).resolves.toBeUndefined();
    expect((supabase.rpc as any).mock.calls[0]).toEqual([
      'reorder_catalog_items',
      {
        p_tenant_id: 'tenant-a',
        p_resource: 'services',
        p_lane: 'public',
        p_ids: ['service-b', 'service-a', 'service-c'],
      },
    ]);
  });
});
