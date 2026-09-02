import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  insertServiceWithPositions,
  reserveServicePositions,
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

  it('retries only a unique-position race when the local RPC is unavailable', async () => {
    const supabase = fakeSupabase(
      {
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.reserve_catalog_positions',
        },
      },
      [
        { data: [{ sort_order: 2, line_sort_order: 7 }], error: null },
        { data: [{ sort_order: 2, line_sort_order: 7 }, { sort_order: 3, line_sort_order: 8 }], error: null },
      ],
    );
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
      positions: { sortOrder: 4, lineSortOrder: 9 },
    });
    expect(insert.mock.calls.map(([positions]) => positions)).toEqual([
      { sortOrder: 3, lineSortOrder: 8 },
      { sortOrder: 4, lineSortOrder: 9 },
    ]);
  });
});
