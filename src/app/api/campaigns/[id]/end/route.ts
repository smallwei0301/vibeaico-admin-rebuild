// POST /api/campaigns/:id/end — PUBLISHED/PAUSED→ENDED（04 分冊 §B-5，狀態機同票券）。
// ENDED 為終態，不可再轉出。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data, error } = await t.supabase.from('campaigns')
    .update({ status: 'ENDED' })
    .eq('id', id).eq('tenant_id', t.tenantId).in('status', ['PUBLISHED', 'PAUSED'])
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: exists, error: e2 } = await t.supabase
      .from('campaigns').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (e2) throw e2;
    if (!exists) throw new ApiHttpError(404, '找不到此活動', ERR.NOT_FOUND);
    throw new ApiHttpError(409, '此活動狀態已變更，請重新整理', ERR.CONFLICT);
  }
  return ok();
});
