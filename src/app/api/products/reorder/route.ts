import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { reorderProducts } from '@/server/product-position';

/**
 * POST /api/products/reorder — `{ids:[]}` 依序寫 sort_order = index ⚙MANAGER
 * （B-3：同 services 模式）。不在 ids 裡或不屬於本租戶的 id 靜默跳過
 * （update 帶 tenant 過濾，匹配不到列即無效果）。
 */
const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1, '請提供排序清單'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const b = bodySchema.parse(await req.json());

  // issue #238：原本逐筆 update({sort_order: i})，在有
  // products_tenant_sort_order_uq 的資料庫上，第一次迭代把某筆設成 0 時，
  // 原本就是 0 的那筆還在 → 23505 → 500。改走 migration 提供的 atomic RPC，
  // 它先把整批搬到不衝突的高位區間再寫回（同 services，見 #128 / 0065）。
  await reorderProducts(t.supabase, t.tenantId, b.ids);

  return ok();
});
