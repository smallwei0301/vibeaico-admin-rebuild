// POST /api/coupons/instances/:id/unredeem — 取消核銷（04 分冊 §B-4）⚙M。
// redeemed_at 清空；未核銷過 → 409。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('coupon_instances')
    .update({ redeemed_at: null })
    .eq('id', id).eq('tenant_id', t.tenantId).not('redeemed_at', 'is', null)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) {
    // 分辨 404（不存在/跨租戶）與 409（存在但尚未核銷）
    const { data: exists, error: e2 } = await t.supabase
      .from('coupon_instances').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (e2) throw e2;
    if (!exists) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);
    throw new ApiHttpError(409, '此票券尚未核銷，無法取消核銷', ERR.CONFLICT);
  }
  return ok();
});
