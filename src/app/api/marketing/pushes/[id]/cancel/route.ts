import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/marketing/pushes/:id/cancel — SCHEDULED→CANCELLED（04 分冊 §B-5，
 * 狀態機 409 樣板：條件式 update，0 列 = 不存在（404）或狀態不符（409））。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('marketing_pushes')
    .update({ status: 'CANCELLED' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'SCHEDULED')
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: exists, error: e2 } = await t.supabase
      .from('marketing_pushes').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (e2) throw e2;
    if (!exists) throw new ApiHttpError(404, '找不到此推播', ERR.NOT_FOUND);
    throw new ApiHttpError(409, '此推播狀態已變更，請重新整理', ERR.CONFLICT);
  }

  return ok();
});
