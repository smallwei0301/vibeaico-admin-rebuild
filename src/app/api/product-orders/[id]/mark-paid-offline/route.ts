// 商品訂單（B-3，同 bookings mark-paid-offline 模式）：payment_status → PAID_OFFLINE。
// 守門：僅未付款（UNPAID）且未取消的訂單可標記；條件不符（已付款/已退款/已取消）
// 拿不到列 → 409。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const { id } = await params;
  const { data, error } = await t.supabase.from('product_orders')
    .update({ payment_status: 'PAID_OFFLINE' })
    .eq('id', id).eq('tenant_id', t.tenantId)
    .eq('payment_status', 'UNPAID')
    .in('status', ['PENDING', 'CONFIRMED', 'COMPLETED'])
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此訂單付款狀態已變更，請重新整理', ERR.CONFLICT);
  return ok();
});
