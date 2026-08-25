import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
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
 * sort_order = body 帶的公開頁排序，未帶則取目前最大值 +1；categoryId 空字串＝
 * 未分類（存 null）。
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
  /** 公開頁排序；商品表單有這個欄位（未帶＝排最後），見 products/page.tsx */
  sortOrder: z.coerce.number().int().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const b = createSchema.parse(await req.json());

  const { data: last, error: e0 } = await t.supabase
    .from('products')
    .select('sort_order, line_sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e0) throw e0;

  const { data, error } = await t.supabase
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
      sort_order: b.sortOrder ?? (last?.sort_order ?? 0) + 1,
      // 0017：新列同時排在 LINE 精選順序的最後，避免整批停在 0 變成無序
      line_sort_order: (last?.line_sort_order ?? 0) + 1,
    })
    .select('id')
    .single();
  if (error) throw error;

  if (b.stock > 0) {
    const { error: lErr } = await t.supabase.from('inventory_logs').insert({
      tenant_id: t.tenantId, product_id: data.id,
      delta: b.stock, reason: 'PURCHASE_IN:建立商品初始庫存', stock_after: b.stock,
    });
    if (lErr) console.error('[api] products POST: initial inventory log failed', data.id, lErr);
  }

  return ok({ id: data.id });
});
