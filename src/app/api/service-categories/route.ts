import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * 服務分類（04 分冊 §B-2「同模式（CRUD+reorder）」）。
 * types.ts 沒有分類型別（鐵則 3 不得改），回應形狀依 mappers 慣例 camelCase：
 * { id, name, description, active, sortOrder }。
 *
 * description / active 是 migration 0018 補的欄位（issue #28 第 ⑨ 筆）：分類管理
 * modal 一直有「說明」輸入框，但 0004 的表沒有該欄、POST 也沒送，於是使用者填的
 * 說明重新整理就消失，而畫面顯示「分類已新增」並把說明列在表格裡。
 */
function mapServiceCategory(r: any) {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description ?? '') as string,
    active: (r.active ?? true) as boolean,
    sortOrder: r.sort_order as number,
  };
}

/** GET /api/service-categories — 全量不分頁，sort_order asc。 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('service_categories')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(data.map(mapServiceCategory));
});

/** POST /api/service-categories — 新增分類 ⚙M，sort_order 排最後。 */
const createSchema = z.object({
  name: z.string().min(1, '請輸入分類名稱'),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const { data: last, error: e0 } = await t.supabase
    .from('service_categories')
    .select('sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e0) throw e0;

  const { data, error } = await t.supabase
    .from('service_categories')
    .insert({
      tenant_id: t.tenantId,
      name: b.name,
      description: b.description ?? '',
      active: b.active ?? true,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select('id, sort_order')
    .single();
  if (error) throw error;

  return ok({ id: data.id, sortOrder: data.sort_order as number });
});
