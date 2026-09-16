// DELETE /api/external-calendars/:id — 刪除外部行事曆訂閱（Issue #21）。
// `on delete cascade`（0115 migration）順帶清掉這個訂閱的快取事件，
// `GET /api/calendar` 之後自然看不到已刪除來源的事件，不需要另外清理。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error: selErr } = await t.supabase.from('external_calendars')
    .select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (selErr) throw selErr;
  if (!data) throw new ApiHttpError(404, '找不到此外部行事曆', ERR.NOT_FOUND);

  const { error } = await t.supabase.from('external_calendars')
    .delete().eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;
  return ok();
});
