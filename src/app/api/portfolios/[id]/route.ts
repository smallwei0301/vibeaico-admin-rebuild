import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * PUT/DELETE /api/portfolios/:id — 同 services 模式 ⚙M（04 分冊 §B-5）。
 * 寫入端點 requireFeature('PORTFOLIO_SHOWCASE')（09 分冊 §5）。
 * portfolios 無外鍵引用 → DELETE 直接硬刪。
 */
const bodySchema = z.object({
  title: z.string().min(1, '請輸入作品標題').optional(),
  imageUrl: z.string().min(1).optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
  lineFeatured: z.boolean().optional(),
  /** 公開頁排序（作品表單的「排序」欄位）；LINE 排序走 …/reorder-line */
  sortOrder: z.coerce.number().int().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.title !== undefined) update.title = b.title;
  if (b.imageUrl !== undefined) update.image_url = b.imageUrl;
  if (b.description !== undefined) update.description = b.description;
  if (b.active !== undefined) update.active = b.active;
  if (b.lineFeatured !== undefined) update.line_featured = b.lineFeatured;
  if (b.sortOrder !== undefined) update.sort_order = b.sortOrder;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase
      .from('portfolios').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此作品', ERR.NOT_FOUND);
    return ok();
  }

  const { data, error } = await t.supabase
    .from('portfolios').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此作品', ERR.NOT_FOUND);

  return ok();
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('portfolios').delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此作品', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
