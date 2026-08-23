import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * GET /api/product-categories — 全量不分頁，sort_order asc。
 * 前端（products/page.tsx 的 ProductCategory）另有 active 欄位，但 DB
 * product_categories（migration 0004）只有 id/tenant_id/name/sort_order ——
 * 以 DB 為準，active 一律回 true（已回報）。
 */
function mapProductCategory(r: any) {
  return { id: r.id, name: r.name, active: true, sortOrder: r.sort_order };
}

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('product_categories')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(data.map(mapProductCategory));
});

/**
 * POST /api/product-categories — 新增分類 ⚙MANAGER（同 service-categories 模式）。
 * sort_order = 目前最大值 +1。
 */
const bodySchema = z.object({ name: z.string().min(1, '請輸入分類名稱') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  const { data: last, error: e0 } = await t.supabase
    .from('product_categories')
    .select('sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e0) throw e0;

  const { data, error } = await t.supabase
    .from('product_categories')
    .insert({ tenant_id: t.tenantId, name: b.name, sort_order: (last?.sort_order ?? 0) + 1 })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
