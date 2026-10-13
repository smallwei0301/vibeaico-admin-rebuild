// POST /api/bookings/:id/mark-paid-offline — 標記現場已收款（04 §B-1）。
// #933：已取消／未到店的預約不可標記收款（與 #923 調價規則一致）；
// 條件式 update 避免讀到更新之間狀態被改成取消的競態。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const BLOCKED_MESSAGE = '已取消或未到店的預約無法標記已收款';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, status')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW')
    throw new ApiHttpError(409, BLOCKED_MESSAGE, ERR.CONFLICT);

  const { data, error } = await t.supabase.from('bookings')
    .update({ payment_status: 'PAID_OFFLINE' })
    .eq('id', id).eq('tenant_id', t.tenantId)
    .not('status', 'in', '(CANCELLED,NO_SHOW)')
    .select('id').maybeSingle();
  if (error) throw error;
  // 讀到之後狀態被改成取消／未到店（影響 0 筆）
  if (!data) throw new ApiHttpError(409, BLOCKED_MESSAGE, ERR.CONFLICT);
  return ok();
});
