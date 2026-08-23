import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式需為 HH:mm');

/**
 * PUT /api/shift-templates/:id — 更新班別。欄位皆可選；時間有改動時以
 * 「改後有效值」檢查 end > start（只帶其中一個也要跟 DB 現值比）。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入班別名稱').optional(),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  color: z.string().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: existing, error: e0 } = await t.supabase
    .from('shift_templates')
    .select('start_time, end_time')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此班別', ERR.NOT_FOUND);

  const nextStart = b.startTime ?? String(existing.start_time).slice(0, 5);
  const nextEnd = b.endTime ?? String(existing.end_time).slice(0, 5);
  if (nextEnd <= nextStart)
    throw new ApiHttpError(400, '結束時間需晚於開始時間', ERR.VALIDATION);

  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.startTime !== undefined) update.start_time = b.startTime;
  if (b.endTime !== undefined) update.end_time = b.endTime;
  if (b.color !== undefined) update.color = b.color;

  if (Object.keys(update).length > 0) {
    const { error } = await t.supabase
      .from('shift_templates').update(update).eq('id', id).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});

/**
 * DELETE /api/shift-templates/:id — 真刪。
 * shifts.template_id 為 on delete set null（0005），已排班的日子保留自身時間不受影響。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('shift_templates').delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此班別', ERR.NOT_FOUND);

  return ok();
});
