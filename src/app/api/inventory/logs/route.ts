import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { pageRange, toPaged } from '@/server/paging';
import { mapInventoryLog } from '@/server/inventory-log';

/**
 * GET /api/inventory/logs — `?productId?&page&size` 分頁（Paged 信封），
 * join products 拿商品名稱，created_at desc。
 *
 * 回傳形狀對齊 /tenant/inventory 頁的 InventoryLog（該型別未收進
 * src/lib/types.ts，鐵則 3 只限「新增」，故 mapper 放本檔）：
 * DB inventory_logs 只有 delta / reason / stock_after ——
 *   quantity    = delta
 *   stockAfter  = stock_after
 *   stockBefore = stock_after - delta（推算）
 *   type/reason = reason 欄位存「TYPE:明細」複合格式（寫入端：adjust-stock、
 *                 product-orders manual/cancel、products POST），這裡拆回兩欄；
 *                 前綴不是已知 type 時整串當 reason、type 視為 MANUAL。
 *   operator    = DB 無此欄位 → 一律 null（已回報）。
 */
const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
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
