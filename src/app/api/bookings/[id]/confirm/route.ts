// 04-API-CONTRACTS.md §0 狀態動作樣板，逐字採用（補上樣板省略的 import）。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const { data, error } = await t.supabase.from('bookings')
    .update({ status: 'CONFIRMED' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'PENDING') // 僅待確認可確認
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此預約狀態已變更，請重新整理', ERR.CONFLICT);
  // Phase 4 之後：這裡呼叫 notifyBookingStatus(t.tenantId, id, 'CONFIRMED')（05/06 分冊）
  return ok();
});
