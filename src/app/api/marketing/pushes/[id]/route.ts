import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT/DELETE /api/marketing/pushes/:id — 草稿 CRUD（04 分冊 §B-5）。
 * PUT：僅 DRAFT/SCHEDULED 可編輯；scheduledAt 有值→SCHEDULED、清空→DRAFT。
 * DELETE：SENT 保留歷史不可刪（409），其餘皆可刪。
 */

const bodySchema = z.object({
  title: z.string().min(1, '請輸入推播標題').optional(),
  content: z.string().optional(),
  imageUrl: z.string().optional(),
  note: z.string().optional(),
  targetType: z.enum(['ALL', 'MEMBERSHIP_LEVEL', 'TAG', 'CUSTOM']).optional(),
  targetValue: z.string().optional(),
  targetLabel: z.string().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: row, error: e0 } = await t.supabase
    .from('marketing_pushes')
    .select('id, status, content, audience')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此推播', ERR.NOT_FOUND);
  if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED')
    throw new ApiHttpError(409, '此推播已發送或取消，無法編輯', ERR.CONFLICT);

  const content = { ...(row.content ?? {}) } as Record<string, unknown>;
  if (b.content !== undefined) content.text = b.content;
  if (b.imageUrl !== undefined) content.imageUrl = b.imageUrl;
  if (b.note !== undefined) content.note = b.note;

  const audience = { ...(row.audience ?? {}) } as Record<string, unknown>;
  if (b.targetType !== undefined) audience.type = b.targetType;
  if (b.targetValue !== undefined) audience.value = b.targetValue;
  if (b.targetLabel !== undefined) audience.label = b.targetLabel;

  const update: Record<string, unknown> = { content, audience };
  if (b.title !== undefined) update.title = b.title;
  if (b.scheduledAt !== undefined) {
    update.scheduled_at = b.scheduledAt;
    update.status = b.scheduledAt ? 'SCHEDULED' : 'DRAFT';
  }

  const { error } = await t.supabase
    .from('marketing_pushes').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok();
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: row, error: e0 } = await t.supabase
    .from('marketing_pushes')
    .select('id, status')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此推播', ERR.NOT_FOUND);
  if (row.status === 'SENT')
    throw new ApiHttpError(409, '已發送的推播不可刪除', ERR.CONFLICT);

  const { error } = await t.supabase
    .from('marketing_pushes').delete()
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok({ deleted: true });
});
