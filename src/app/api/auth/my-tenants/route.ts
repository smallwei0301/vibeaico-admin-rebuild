import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTenantSummary } from '@/server/mappers';

// GET /api/auth/my-tenants → TenantSummary[]（src/lib/types.ts）
// current = 與 requireTenant() 解析出的 tenantId 相同者。
//
// business_type 由 migration 0015 補上，這裡要撈出來，否則註冊時選的業態模式
// 到不了前端，所有真實店家都會 fallback 成 LOCAL_SHOP 的選單與名詞。
// extra_modules 仍未有欄位（13 分冊的「斜槓店家加開模組」尚未定案儲存位置），
// mapTenantSummary 對缺欄位有 `?? undefined` 防呆，省略即可。
export const GET = handle(async () => {
  const t = await requireTenant();
  const { data, error } = await t.supabase
    .from('tenant_users')
    .select('tenant_id, role, tenants(shop_code, name, business_type)')
    .eq('user_id', t.user.id);
  if (error) throw error;
  return ok((data ?? []).map((r: any) => mapTenantSummary(r, t.tenantId)));
});
