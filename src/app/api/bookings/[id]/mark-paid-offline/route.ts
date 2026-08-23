// POST /api/bookings/:id/mark-paid-offline — 標記現場已收款（04 §B-1）。
// 契約未限制原 payment_status，僅做 404 歸屬檢查後直接標記。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error } = await t.supabase.from('bookings')
    .update({ payment_status: 'PAID_OFFLINE' })
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  return ok();
});
