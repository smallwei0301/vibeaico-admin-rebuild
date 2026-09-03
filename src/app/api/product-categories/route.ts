import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * GET /api/product-categories — 全量不分頁，sort_order asc。
 *
 * 修改前：`active` 硬回 `true`（DB 沒這欄），所以店家在分類管理裡把分類停用、
 * 畫面顯示「分類已更新」，重新整理又全部變回啟用——本檔原本的註解自己寫了
 * 「已回報」。migration 0018 補了 description / active 兩欄（issue #28 第 ⑨ 筆），
 * 這裡改成照實回傳 DB 的值。
 */
function mapProductCategory(r: any) {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description ?? '') as string,
    active: (r.active ?? true) as boolean,
    sortOrder: r.sort_order as number,
  };
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
 * sort_order：body 有帶就照收（modal 有「排序」輸入框），沒帶才取目前最大值 +1。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入分類名稱'),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

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
    .insert({
      tenant_id: t.tenantId,
      name: b.name,
      description: b.description ?? '',
      active: b.active ?? true,
      sort_order: b.sortOrder ?? (last?.sort_order ?? 0) + 1,
    })
    .select('id, sort_order')
    .single();
  if (error) throw error;

  return ok({ id: data.id, sortOrder: data.sort_order as number });
});
