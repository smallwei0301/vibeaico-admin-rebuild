import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { pageRange, toPaged, pageSizeSchema } from '@/server/paging';

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
const KNOWN_TYPES = new Set([
  'PURCHASE_IN', 'SALE_OUT', 'STOCKTAKE', 'MANUAL', 'DAMAGE', 'RETURN_IN', 'ORDER_CANCELLED',
]);

function mapInventoryLog(r: any) {
  const raw: string = r.reason ?? '';
  const idx = raw.indexOf(':');
  const prefix = idx > 0 ? raw.slice(0, idx) : raw;
  const known = KNOWN_TYPES.has(prefix);
  return {
    id: r.id,
    createdAt: r.created_at,
    productId: r.product_id,
    productName: r.products?.name ?? '',
    type: known ? prefix : 'MANUAL',
    quantity: r.delta,
    stockBefore: r.stock_after - r.delta,
    stockAfter: r.stock_after,
    reason: known ? (idx > 0 ? raw.slice(idx + 1) : '') : raw,
    operator: null as string | null,
  };
}

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
