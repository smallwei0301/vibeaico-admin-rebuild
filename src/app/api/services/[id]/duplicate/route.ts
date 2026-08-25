import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/services/:id/duplicate — 複製一筆服務（04 分冊 §B-2）。
 * name 加「（複本）」，sort_order 排最後（租戶最大值 + 1）。⚙M（複製即新增，比照 CRUD）。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: src, error: e0 } = await t.supabase
    .from('services').select('*').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!src) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);

  const { data: last, error: e1 } = await t.supabase
    .from('services')
    .select('sort_order, line_sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) throw e1;

  const { data, error } = await t.supabase
    .from('services')
    .insert({
      tenant_id: t.tenantId,
      category_id: src.category_id,
      name: `${src.name}（複本）`,
      description: src.description,
      duration_minutes: src.duration_minutes,
      price: src.price,
      image_url: src.image_url,
      active: src.active,
      line_featured: src.line_featured,
      sort_order: (last?.sort_order ?? -1) + 1,
      // 0017：新列同時排在 LINE 精選順序的最後，避免整批停在 0 變成無序
      line_sort_order: (last?.line_sort_order ?? -1) + 1,
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
