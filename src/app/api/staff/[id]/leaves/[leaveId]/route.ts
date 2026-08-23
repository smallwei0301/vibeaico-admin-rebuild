import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * DELETE /api/staff/:id/leaves/:leaveId — 刪除一筆請假。
 * 以 id + staff_id + tenant_id 三重過濾，查無（或不屬本租戶/該員工）回 404。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'SHIFT_MANAGEMENT');
  const { id, leaveId } = await params;

  const { data, error } = await t.supabase
    .from('staff_leaves')
    .delete()
    .eq('id', leaveId)
    .eq('staff_id', id)
    .eq('tenant_id', t.tenantId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此請假紀錄', ERR.NOT_FOUND);

  return ok();
});
