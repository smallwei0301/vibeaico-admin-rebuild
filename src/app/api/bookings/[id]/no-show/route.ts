// CONFIRMED → NO_SHOW。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'NO_SHOW' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'CONFIRMED')
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);
  // Phase 4 之後：這裡呼叫 notifyBookingStatus(t.tenantId, id, 'NO_SHOW')（05/06 分冊）
  return ok();
});
