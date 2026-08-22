import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapMembershipLevel } from '@/server/mappers';

/**
 * GET /api/membership-levels — membership_levels + customer_count（依
 * membership_level_id 分組計數 customers）。全量小表，一次抓 customers 的
 * membership_level_id 在記憶體分組（同 coupons 端點手法）。全量不分頁，
 * sort_order asc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const [{ data: levels, error: e1 }, { data: customers, error: e2 }] = await Promise.all([
    t.supabase
      .from('membership_levels')
      .select('*')
      .eq('tenant_id', t.tenantId)
      .order('sort_order', { ascending: true }),
    t.supabase
      .from('customers')
      .select('membership_level_id')
      .eq('tenant_id', t.tenantId)
      .not('membership_level_id', 'is', null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const counts = new Map<string, number>();
  for (const c of customers ?? []) {
    counts.set(c.membership_level_id, (counts.get(c.membership_level_id) ?? 0) + 1);
  }

  return ok(
    (levels ?? []).map((r: any) => mapMembershipLevel({ ...r, customer_count: counts.get(r.id) ?? 0 })),
  );
});
