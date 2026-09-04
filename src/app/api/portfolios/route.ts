import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * /api/portfolios — 作品集 CRUD，同 services 模式（04 分冊 §B-5）。
 * 欄位以 0005 portfolios 表為準：title、image_url、description、active、
 * line_featured、sort_order、line_sort_order（0075 補齊 schema drift，
 * 對齊線上既有欄位）。寫入端點 requireFeature('PORTFOLIO_SHOWCASE')
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
    sortOrder: r.sort_order as number,
    lineSortOrder: (r.line_sort_order ?? 0) as number,
    createdAt: r.created_at as string,
  };
}

/**
 * GET /api/portfolios?orderBy=line — 預設依公開頁順序（sort_order）排序，
 * 兩個排序都在同一列回傳（見 mapPortfolio 的 sortOrder/lineSortOrder），
 * 前端切換排序模式時直接改在本地依對應欄位排序即可，不需要多打一次 API
 * ——`orderBy=line` 只是讓需要「後端就照 LINE 順序回傳」的呼叫端（例如
 * LINE 作品瀏覽選單）少一次前端排序，屬最小改動。
 */
const listQuerySchema = z.object({ orderBy: z.enum(['public', 'line']).optional() });

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const { orderBy } = listQuerySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );

  const { data, error } = await t.supabase
    .from('portfolios')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order(orderBy === 'line' ? 'line_sort_order' : 'sort_order', { ascending: true })
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
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const b = createSchema.parse(await req.json());

  const { data: last, error: e0 } = await t.supabase
    .from('portfolios')
    .select('sort_order')
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
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
