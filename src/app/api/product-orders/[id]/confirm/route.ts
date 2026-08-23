// 商品訂單狀態機（B-3，同 bookings 模式）：PENDING → CONFIRMED。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const { id } = await params;
  const { data, error } = await t.supabase.from('product_orders')
    .update({ status: 'CONFIRMED' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'PENDING') // 僅待確認可確認
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(409, '此訂單狀態已變更，請重新整理', ERR.CONFLICT);
  return ok();
});
