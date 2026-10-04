import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTenantSummary } from '@/server/mappers';

// GET /api/auth/my-tenants → TenantSummary[]（src/lib/types.ts）
// current = 與 requireTenant() 解析出的 tenantId 相同者。
//
// select 必須含 tenants.business_type（migration 0103）：AppShell 在 AUTH_REAL 下
// 以此決定 Sidebar／GUIDE 底部導覽的業態外框，缺了就會一律退成 LOCAL_SHOP。
// extra_modules 目前仍不是 tenants 欄位，故不撈；mapTenantSummary 對缺欄位有
// `?? undefined` 防呆，TenantSummary 上該欄位為 optional。
export const GET = handle(async () => {
  const t = await requireTenant();
  // 代登入期間：requireTenant() 已改用 service role 並把 tenantId 鎖在 session row 的目標店；
  // 管理者自己不是該店成員，查 tenant_users 會得到空清單或無關店家。此時只回代入目標一筆，
  // 資料全取自 requireTenant 已載入的 tenants 列，絕不由 request 輸入推導目標（#754 Codex P1）。
  if (t.impersonation) {
    return ok([
      {
        id: t.tenantId,
        shopCode: t.shopCode,
        name: t.tenantName,
        role: t.role,
        current: true,
        businessType: t.businessType,
      },
    ]);
  }
  const { data, error } = await t.supabase
    .from('tenant_users')
    .select('tenant_id, role, tenants(shop_code, name, business_type)')
    .eq('user_id', t.user.id);
  if (error) throw error;
  return ok((data ?? []).map((r: any) => mapTenantSummary(r, t.tenantId)));
});
