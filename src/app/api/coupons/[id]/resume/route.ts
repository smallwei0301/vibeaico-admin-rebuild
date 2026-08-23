// POST /api/coupons/:id/resume — PAUSED→PUBLISHED（04 分冊 §B-4 狀態機）。
// 樣板：bookings/:id/confirm（條件式 update，0 列 = 非法轉移或不存在 → 409/404）。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error } = await t.supabase.from('coupons')
    .update({ status: 'PUBLISHED' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'PAUSED') // 僅暫停中可恢復
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: exists, error: e2 } = await t.supabase
      .from('coupons').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (e2) throw e2;
    if (!exists) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);
    throw new ApiHttpError(409, '此票券狀態已變更，請重新整理', ERR.CONFLICT);
  }
  return ok();
});
