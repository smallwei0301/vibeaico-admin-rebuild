import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from '@/server/http';

export type CatalogResource = 'services' | 'products' | 'portfolios';
export type CatalogOrderLane = 'public' | 'line';

/**
 * Reorder is a replacement of one complete tenant collection, not a patch of the
 * currently visible filtered rows.  Duplicate IDs are rejected before the RPC.
 */
export const catalogReorderBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1, '請提供排序清單').max(500, '排序清單過長'),
}).strict().superRefine(({ ids }, ctx) => {
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '排序清單不可包含重複項目' });
  }
});

/**
 * One RPC validates tenant ownership and the complete collection, then updates
 * all rows in one database statement.  No client-side filtered subset can leave
 * stale rows behind or partially apply an order.
 */
export async function reorderCatalogItems(
  supabase: Pick<SupabaseClient, 'rpc'>,
  tenantId: string,
  resource: CatalogResource,
  lane: CatalogOrderLane,
  ids: string[],
): Promise<void> {
  const { error } = await supabase.rpc('reorder_catalog_items', {
    p_tenant_id: tenantId,
    p_resource: resource,
    p_lane: lane,
    p_ids: ids,
  });

  if (!error) return;
  if (error.code === '22023') {
    throw new ApiHttpError(400, '排序清單必須包含本租戶全部項目且不可重複', ERR.VALIDATION);
  }
  if (error.code === '42501') {
    throw new ApiHttpError(403, '沒有重新排序的權限', ERR.FORBIDDEN);
  }
  throw error;
}
