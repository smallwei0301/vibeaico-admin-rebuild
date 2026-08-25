import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * /api/portfolios — 作品集 CRUD，同 services 模式（04 分冊 §B-5）。
 * 欄位以 0005 portfolios 表為準：title、image_url、description、active、
 * line_featured、sort_order，外加 0017 的 line_sort_order（LINE 作品瀏覽排序，
 * 與公開頁排序 sort_order 互不影響）。寫入端點 requireFeature('PORTFOLIO_SHOWCASE')
 * （09 分冊 §5）；讀取不擋。
 */

function mapPortfolio(r: any) {
  return {
    id: r.id as string,
    title: r.title as string,
    imageUrl: (r.image_url ?? '') as string,
    description: (r.description ?? '') as string,
    active: !!r.active,
    lineFeatured: !!r.line_featured,
    /** 公開頁排序（sort_order）；POST /api/portfolios/reorder 落地 */
    sortOrder: r.sort_order as number,
    /** LINE 作品瀏覽排序（line_sort_order，0017）；POST …/reorder-line 落地 */
    lineSortOrder: (r.line_sort_order ?? 0) as number,
    createdAt: r.created_at as string,
  };
}

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('portfolios')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  return ok((data ?? []).map(mapPortfolio));
});

const createSchema = z.object({
  title: z.string().min(1, '請輸入作品標題'),
  imageUrl: z.string().min(1, '請上傳作品圖片'),
  description: z.string().optional(),
  active: z.boolean().optional(),
  lineFeatured: z.boolean().optional(),
  /** 公開頁排序（作品表單的「排序」欄位）；未帶則排最後 */
  sortOrder: z.coerce.number().int().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const b = createSchema.parse(await req.json());

  const { data: last, error: e0 } = await t.supabase
    .from('portfolios')
    .select('sort_order, line_sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e0) throw e0;

  const { data, error } = await t.supabase
    .from('portfolios')
    .insert({
      tenant_id: t.tenantId,
      title: b.title,
      image_url: b.imageUrl,
      description: b.description ?? '',
      active: b.active ?? true,
      line_featured: b.lineFeatured ?? false,
      sort_order: b.sortOrder ?? (last?.sort_order ?? -1) + 1,
      // 新作品同時排在兩套順序的最後，避免 LINE 那側整批停在 0 變成無序
      line_sort_order: (last?.line_sort_order ?? -1) + 1,
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
