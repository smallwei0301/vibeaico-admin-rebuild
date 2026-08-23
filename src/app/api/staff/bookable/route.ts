import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * GET /api/staff/bookable — active 且 bookable 的精簡清單（04 分冊 §B-2），
 * 只回 { id, name }，sort_order asc。預約表單的員工下拉用。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('staff')
    .select('id, name')
    .eq('tenant_id', t.tenantId)
    .eq('active', true)
    .eq('bookable', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(data.map((r: any) => ({ id: r.id as string, name: r.name as string })));
});
