// DELETE /api/block-times/:id — 刪除封鎖時段（04 §B-1）。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error } = await t.supabase.from('block_times')
    .delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此封鎖時段', ERR.NOT_FOUND);
  return ok();
});
