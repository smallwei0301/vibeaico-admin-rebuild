// PENDING/CONFIRMED → CANCELLED，寫 cancel_reason。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { notifyBookingEvent } from '@/server/email/notify';

const bodySchema = z.object({ reason: z.string().optional() });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'CANCELLED', cancel_reason: b.reason ?? null })
    .eq('id', id).eq('tenant_id', t.tenantId).in('status', ['PENDING', 'CONFIRMED'])
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);
  // Email 通知（05 分冊 §3：notifyBookingCancel 開關）不 await ——寄信慢或失敗
  // 都不可拖垮這支 API 的回應，函式內部已吞錯。LINE 顧客端推播屬 06 分冊，尚未接線。
  void notifyBookingEvent(createAdminSupabase(), t.tenantId, id, 'CANCELLED');
  return ok();
});
