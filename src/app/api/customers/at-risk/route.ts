// GET /api/customers/at-risk — 流失風險顧客列表（04 分冊 §B-6）。
// 資料源 customers_view（0007）：at_risk = 「最後一次 COMPLETED 來訪距今超過
// 60 天」（view 內定義：last_visit_at is not null and < now() - 60 days）。
// 回 Customer[]（同既有 /api/customers 列表項，經 mapCustomer），不分頁——
// 這是提醒清單不是瀏覽列表，量級小；僅列 active=true（停用顧客不需關懷提醒），
// 依 last_visit_at 由舊到新排序（最久沒來的排最前面）。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapCustomer } from '@/server/mappers';

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data: rows, error } = await t.supabase.from('customers_view')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .eq('at_risk', true)
    .eq('active', true)
    .order('last_visit_at', { ascending: true });
  if (error) throw error;

  return ok((rows ?? []).map(mapCustomer));
});
