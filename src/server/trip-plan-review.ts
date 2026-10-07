import { ApiHttpError, ERR } from '@/server/http';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';
import type { requireTenantManager } from '@/server/tenant';

type Tenant = Awaited<ReturnType<typeof requireTenantManager>>;

/** Temporary API guard until LISTED plan review has a real submission/decision path.
 * This read does not serialize external listing changes; no DB/RLS guarantee is claimed.
 */
export async function requireUnlistedTripForPlanWrite(t: Tenant, tripId: string) {
  const { data, error } = await t.supabase.from('trips').select('id, midao_listing')
    .eq('tenant_id', t.tenantId).eq('id', tripId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此行程', ERR.NOT_FOUND);
  if (data.midao_listing === 'LISTED') {
    throw new ApiHttpError(409, tripsPage.plans.review.unavailable, ERR.CONFLICT);
  }
  if (!['NONE', 'PENDING', 'REJECTED'].includes(data.midao_listing)) {
    throw new Error('Unknown trip listing state');
  }
}

export async function requirePlanForSeasonWrite(t: Tenant, planId: string) {
  const { data, error } = await t.supabase.from('trip_plans').select('id, trip_id')
    .eq('tenant_id', t.tenantId).eq('id', planId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此方案', ERR.NOT_FOUND);
  await requireUnlistedTripForPlanWrite(t, data.trip_id);
}

export async function requireSeasonForWrite(t: Tenant, seasonId: string) {
  const { data, error } = await t.supabase.from('trip_plan_seasons').select('*')
    .eq('tenant_id', t.tenantId).eq('id', seasonId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此季節', ERR.NOT_FOUND);
  await requirePlanForSeasonWrite(t, data.plan_id);
  return data;
}

/** 刪除行程前的 LISTED 擋閘（#42）：已上架 Midao 的行程不可刪（會連帶刪方案／季節）。
 * 這裡的讀取不與外部上架變更序列化；DELETE 路由另以 `.neq('midao_listing','LISTED')` 帶條件刪除收斂競態。
 */
export async function requireUnlistedTripForDelete(t: Tenant, tripId: string) {
  const { data, error } = await t.supabase.from('trips').select('id, midao_listing')
    .eq('tenant_id', t.tenantId).eq('id', tripId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此行程', ERR.NOT_FOUND);
  if (data.midao_listing === 'LISTED') {
    throw new ApiHttpError(409, tripsPage.actions.deleteListedBlocked, ERR.CONFLICT);
  }
}
