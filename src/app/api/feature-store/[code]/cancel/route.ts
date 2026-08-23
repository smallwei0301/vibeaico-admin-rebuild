import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { FEATURE_CATALOG } from '@/config/features';

/**
 * POST /api/feature-store/:code/cancel — 取消訂閱（09 分冊 §3）⚙OWNER。
 * 只設 cancelled_at = now()：**不退點、不縮短到期日**（原站規則），
 * 到期前功能仍可用（featureActive 不看 cancelled_at，09 分冊 §2）。
 * 無此訂閱 → 404。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('OWNER');
  const { code } = await params;

  const item = FEATURE_CATALOG.find((f) => f.key === code && f.paid);
  if (!item) throw new ApiHttpError(404, '找不到此功能', ERR.NOT_FOUND);

  // feature_subscriptions 沒有租戶端寫入的 RLS policy（寫入一律走 service role），
  // 權限已由 requireTenant('OWNER') 把關，條件鎖死在該租戶。
  const { data, error } = await createAdminSupabase()
    .from('feature_subscriptions')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId)
    .eq('code', code)
    .select('code');
  if (error) throw error;
  if (!data?.length) throw new ApiHttpError(404, '找不到此訂閱', ERR.NOT_FOUND);

  return ok();
});
