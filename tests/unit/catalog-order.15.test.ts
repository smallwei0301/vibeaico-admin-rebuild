import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { nextOrderValue } from '@/lib/catalog-order';
import {
  catalogReorderBodySchema,
  reorderCatalogItems,
} from '@/server/catalog-reorder';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Issue #15 catalog order contracts', () => {
  it('computes an independent tail from the maximum stored rank', () => {
    expect(nextOrderValue([])).toBe(0);
    expect(nextOrderValue([0, 4, 2])).toBe(5);
    expect(nextOrderValue([null, undefined, 0])).toBe(1);
  });

  it('rejects duplicate ids before the database seam', () => {
    expect(() => catalogReorderBodySchema.parse({ ids: [A, A] })).toThrow('不可包含重複');
    expect(catalogReorderBodySchema.parse({ ids: [A, B] }).ids).toEqual([A, B]);
  });

  it('uses one atomic RPC and maps collection validation failures', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;
    await reorderCatalogItems(client, 'tenant-1', 'products', 'line', [A, B]);
    expect(rpc).toHaveBeenCalledWith('reorder_catalog_items', {
      p_tenant_id: 'tenant-1', p_resource: 'products', p_lane: 'line', p_ids: [A, B],
    });

    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023' } });
    await expect(reorderCatalogItems(client, 'tenant-1', 'products', 'line', [A]))
      .rejects.toMatchObject({ status: 400, code: 'REQ_001' });
  });
});
