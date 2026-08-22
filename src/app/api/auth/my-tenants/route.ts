import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTenantSummary } from '@/server/mappers';

// GET /api/auth/my-tenants → TenantSummary[]（src/lib/types.ts）
// current = 與 requireTenant() 解析出的 tenantId 相同者。
//
// tenants 表目前沒有 business_type / extra_modules 欄位（見 mapTenantSummary
// 註解，這兩欄要等 migration 0014 才會加），所以這裡的 select 不去撈它們——
// mapTenantSummary 對缺欄位已有 `?? undefined` 防呆，TenantSummary 上這兩個
// 欄位本來就是 optional，省略即可，不用自己加欄位到 SQL。
export const GET = handle(async () => {
  const t = await requireTenant();
  const { data, error } = await t.supabase
    .from('tenant_users')
    .select('tenant_id, role, tenants(shop_code, name)')
    .eq('user_id', t.user.id);
  if (error) throw error;
  return ok((data ?? []).map((r: any) => mapTenantSummary(r, t.tenantId)));
});
