import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapService } from '@/server/mappers';
import { insertCatalogWithPositions } from '@/server/catalog-position';

/**
 * GET /api/services — services join service_categories(name) → category_name。
 * 全量不分頁，sort_order asc；回傳 line_sort_order 供 LINE 精選排序。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('services')
    .select('*, service_categories(name)')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(
    data.map((r: any) =>
      mapService({ ...r, category_name: r.service_categories?.name ?? null }),
    ),
  );
});

/**
 * POST /api/services — 新增服務 ⚙M（04 分冊 §B-2）。
 * categoryId 空字串或未帶 → 存 null（外鍵欄位不接受 ''，同 customers 慣例）。
 * sort_order / line_sort_order 各自取該欄位最大值 + 1（兩套排序互不影響）。
 */
const createSchema = z.object({
  name: z.string().min(1, '請輸入服務名稱'),
  categoryId: z.string().optional(),
  description: z.string().optional(),
  durationMinutes: z.number().int().min(1).optional(),
  price: z.number().min(0).optional(),
  imageUrl: z.string().optional(),
  active: z.boolean().optional(),
  lineFeatured: z.boolean().optional(),
}).strict();

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const { data, positions } = await insertCatalogWithPositions<{ id: string }>(
    t.supabase,
    t.tenantId,
    'services',
    (position) => t.supabase
      .from('services')
      .insert({
        tenant_id: t.tenantId,
        category_id: b.categoryId ? b.categoryId : null,
        name: b.name,
        description: b.description ?? '',
        duration_minutes: b.durationMinutes ?? 60,
        price: b.price ?? 0,
        image_url: b.imageUrl ?? '',
        active: b.active ?? true,
        line_featured: b.lineFeatured ?? false,
        sort_order: position.sortOrder,
        line_sort_order: position.lineSortOrder,
      })
      .select('id')
      .single(),
  );

  return ok({ id: data.id, ...positions });
});
