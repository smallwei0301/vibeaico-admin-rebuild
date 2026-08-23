// POST /api/campaigns/:id/publish — DRAFT→PUBLISHED（04 分冊 §B-5，狀態機同票券）。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data, error } = await t.supabase.from('campaigns')
    .update({ status: 'PUBLISHED' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'DRAFT') // 僅草稿可發佈
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
