import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { insertPortfolioWithPositions } from '@/server/product-position';

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

  // issue #238：原本只算 sort_order，line_sort_order 完全沒給（column default 0），
  // 於是每一筆新作品的 LINE 排序都是 0。canonical TEST 有
  // portfolios_tenant_line_sort_order_uq，第二筆就 500（已實測）；正式庫沒有該
  // 索引所以不會 500，但「LINE 作品排序」等於沒有作用。改走 migration 的取號
  // 函式，兩個 lane 一起配（同 services/products，見 #128 / 0065 / 0084）。
  const { data } = await insertPortfolioWithPositions<{ id: string }>(
    t.supabase, t.tenantId, (positions) =>
      t.supabase
        .from('portfolios')
        .insert({
          tenant_id: t.tenantId,
          title: b.title,
          image_url: b.imageUrl,
          description: b.description ?? '',
          active: b.active ?? true,
          line_featured: b.lineFeatured ?? false,
          sort_order: positions.sortOrder,
          line_sort_order: positions.lineSortOrder,
        })
        .select('id')
        .single(),
  );

  return ok({ id: data.id });
});
