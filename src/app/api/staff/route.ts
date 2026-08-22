import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapStaff } from '@/server/mappers';

/**
 * GET /api/staff — staff + staff_services 聚合成 service_ids（多對多）。
 * 全量不分頁，sort_order asc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('staff')
    .select('*, staff_services(service_id)')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(
    data.map((r: any) =>
      mapStaff({ ...r, service_ids: (r.staff_services ?? []).map((s: any) => s.service_id) }),
    ),
  );
});
