import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { pageRange, toPaged, pageSizeSchema } from '@/server/paging';
import { mapInventoryLog } from '@/server/inventory-log';

/**
 * GET /api/inventory/logs — `?productId?&page&size` 分頁（Paged 信封），
 * join products 拿商品名稱，created_at desc。
 *
 * 回傳形狀對齊 /tenant/inventory 頁的 InventoryLog（該型別未收進
 * src/lib/types.ts，鐵則 3 只限「新增」）。
 *
 * mapper 已搬到 `src/server/inventory-log.ts`：匯出端點
 * （GET /api/export/inventory/:format，issue #28 ⑤）必須與本端點同一套口徑，
 * 各留一份會分岔（欄位說明見該檔）。
 */
const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: pageSizeSchema(20),
  productId: z.string().uuid().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'INVENTORY');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);

  let query = t.supabase
    .from('inventory_logs')
    .select('*, products(name)', { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (q.productId) query = query.eq('product_id', q.productId);

  const { data, count, error } = await query;
  if (error) throw error;

  return ok(toPaged(data.map(mapInventoryLog), count, page, size));
});
