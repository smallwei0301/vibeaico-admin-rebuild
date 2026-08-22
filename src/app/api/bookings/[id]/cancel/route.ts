// PENDING/CONFIRMED → CANCELLED，寫 cancel_reason。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

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
  // Phase 4 之後：這裡呼叫 notifyBookingStatus(t.tenantId, id, 'CANCELLED')（05/06 分冊）
  return ok();
});
