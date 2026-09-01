import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapService } from '@/server/mappers';

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
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const [{ data: lastPublic, error: publicError }, { data: lastLine, error: lineError }] = await Promise.all([
    t.supabase.from('services').select('sort_order')
      .eq('tenant_id', t.tenantId).order('sort_order', { ascending: false }).limit(1).maybeSingle(),
    t.supabase.from('services').select('line_sort_order')
      .eq('tenant_id', t.tenantId).order('line_sort_order', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (publicError) throw publicError;
  if (lineError) throw lineError;

  const { data, error } = await t.supabase
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
      sort_order: (lastPublic?.sort_order ?? -1) + 1,
      line_sort_order: (lastLine?.line_sort_order ?? -1) + 1,
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
