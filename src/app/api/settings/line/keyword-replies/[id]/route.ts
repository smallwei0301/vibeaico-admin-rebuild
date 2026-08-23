import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * PUT/DELETE /api/settings/line/keyword-replies/:id（04 分冊 §B-5）。
 * 寫入端點 requireFeature('KEYWORD_REPLY')（09 分冊 §5）。
 * PUT 只更新 body 裡實際出現的欄位（services 慣例）。
 */

const bodySchema = z.object({
  keywords: z.array(z.string().min(1)).min(1, '請至少輸入一個關鍵字').optional(),
  replyType: z.enum(['TEXT', 'IMAGE', 'FLEX']).optional(),
  content: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'KEYWORD_REPLY');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.keywords !== undefined) update.keywords = b.keywords;
  if (b.replyType !== undefined) update.reply_type = b.replyType;
  if (b.content !== undefined) update.content = b.content;
  if (b.active !== undefined) update.active = b.active;
  if (b.sortOrder !== undefined) update.sort_order = b.sortOrder;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase
      .from('keyword_replies').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);
    return ok();
  }

  const { data, error } = await t.supabase
    .from('keyword_replies').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  return ok();
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'KEYWORD_REPLY');
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('keyword_replies').delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
