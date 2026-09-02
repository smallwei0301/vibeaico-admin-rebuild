import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { z } from 'zod';
import { reorderServices } from '@/server/service-position';

/**
 * POST /api/services/reorder — `{ids:[]}` 依序寫 sort_order=index。
 * 既有 remote TEST 與 fresh local runners 都使用 migration-provided
 * reorder_catalog_items；未提交的本租戶服務維持原相對順序。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  await reorderServices(t.supabase, t.tenantId, b.ids);

  return ok();
});
