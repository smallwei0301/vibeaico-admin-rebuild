// PUT /api/bookings/:id — 改時間/員工/備註（04 分冊 §B-1）。
// 改 startAt 時以既有 duration_minutes 重算 end_at；重疊同 POST 交給
// DB 排除約束 x_bookings_overlap，catch 23P01 回 409。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { notifyBookingStatus } from '@/server/line-notify';

const bodySchema = z.object({
  startAt: z.string().optional(),
  /** undefined = 不動；null = 清除指定員工 */
  staffId: z.string().uuid().nullable().optional(),
  note: z.string().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: existing, error: e0 } = await t.supabase.from('bookings')
    .select('id, duration_minutes, start_at, staff_id')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  const update: Record<string, unknown> = {};
  // 只有顧客需要知道的時間／服務人員變更才觸發 MODIFIED；店內備註不推播。
  let notifyTriggered = false;
  if (b.startAt !== undefined) {
    const startMs = Date.parse(b.startAt);
    if (Number.isNaN(startMs))
      throw new ApiHttpError(400, '開始時間格式錯誤', ERR.VALIDATION);
    update.start_at = new Date(startMs).toISOString();
    update.end_at = new Date(startMs + existing.duration_minutes * 60_000).toISOString();
    if (Date.parse(existing.start_at) !== startMs) notifyTriggered = true;
  }
  if (b.staffId !== undefined) {
    if (b.staffId) {
      const { data: staff, error } = await t.supabase.from('staff').select('id')
        .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
      if (error) throw error;
      if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
    }
    update.staff_id = b.staffId; // null = 清除
    if ((existing.staff_id ?? null) !== (b.staffId ?? null)) notifyTriggered = true;
  }
  if (b.note !== undefined) update.note = b.note;

  if (Object.keys(update).length === 0) return ok({ notifyTriggered: false }); // 沒有要改的欄位

  const { error } = await t.supabase.from('bookings')
    .update(update)
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) {
    if (error.code === '23P01')
      throw new ApiHttpError(409, '該時段已有預約', ERR.CONFLICT);
    throw error;
  }

  // 06 §5：推播不能拖慢或改變預約更新結果，且由函式內部吞掉 delivery error。
  if (notifyTriggered) void notifyBookingStatus(t.tenantId, id, 'MODIFIED');

  return ok({ notifyTriggered });
});
