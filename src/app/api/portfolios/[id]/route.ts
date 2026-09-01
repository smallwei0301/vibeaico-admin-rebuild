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
  // Kept only to return a bounded conflict to stale clients; rank edits must
  // go through the complete-collection reorder endpoint.
  sortOrder: z.coerce.number().int().optional(),
}).superRefine((body, ctx) => {
  if (body.sortOrder !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sortOrder'],
      message: '排序請使用列表排序功能調整',
    });
  }
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
