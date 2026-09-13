import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { insertProductWithPositions } from '@/server/product-position';
import { mapProduct } from '@/server/mappers';

/**
 * GET /api/products — products join product_categories(name) → category_name。
 * 全量不分頁，sort_order asc（同 services 模式）。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('products')
    .select('*, product_categories(name)')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(
    data.map((r: any) =>
      mapProduct({ ...r, category_name: r.product_categories?.name ?? null }),
    ),
  );
});

/**
 * POST /api/products — 新增商品 ⚙MANAGER（B-3：同 services 模式）。
 * sort_order = 目前最大值 +1；categoryId 空字串＝未分類（存 null）。
 * 初始 stock > 0 時寫一筆 inventory_logs（PURCHASE_IN），讓庫存帳自始完整。
 */
const createSchema = z.object({
  name: z.string().min(1, '請輸入商品名稱'),
  categoryId: z.string().optional(),
  description: z.string().optional(),
  price: z.coerce.number().min(0).default(0),
  stock: z.coerce.number().int().min(0).default(0),
  safetyStock: z.coerce.number().int().min(0).default(0),
  imageUrl: z.string().optional(),
  active: z.boolean().optional(),
  lineFeatured: z.boolean().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const b = createSchema.parse(await req.json());

  // issue #238：原本只算 sort_order = max+1，line_sort_order 完全沒給
  // （column default 0），於是每一筆新商品的 LINE 排序都是 0。canonical TEST
  // 有 products_tenant_line_sort_order_uq，第二個商品就 500；正式庫沒有該索引
  // 所以不會 500，但「LINE 商品排序」等於沒有作用——店家拖曳、存檔、沒報錯，
  // 顧客看到的順序卻不是他排的。改走 migration 的取號函式，兩個 lane 一起配，
  // 併發也安全（同 services，見 #128 / 0065）。
  const { data } = await insertProductWithPositions<{ id: string }>(t.supabase, t.tenantId, (positions) =>
    t.supabase
      .from('products')
      .insert({
        tenant_id: t.tenantId,
        category_id: b.categoryId ? b.categoryId : null,
        name: b.name,
        description: b.description ?? '',
        price: b.price,
        stock: b.stock,
        safety_stock: b.safetyStock,
        image_url: b.imageUrl ?? '',
        active: b.active ?? true,
        line_featured: b.lineFeatured ?? false,
        sort_order: positions.sortOrder,
        line_sort_order: positions.lineSortOrder,
      })
      .select('id')
      .single(),
  );

  if (b.stock > 0) {
    const { error: lErr } = await t.supabase.from('inventory_logs').insert({
      tenant_id: t.tenantId, product_id: data.id,
      delta: b.stock, reason: 'PURCHASE_IN:建立商品初始庫存', stock_after: b.stock,
    });
    if (lErr) console.error('[api] products POST: initial inventory log failed', data.id, lErr);
  }

  return ok({ id: data.id });
});
