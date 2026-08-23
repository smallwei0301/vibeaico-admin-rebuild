import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { FEATURE_BUNDLES, type FeatureBundleKey } from '@/config/features';

/**
 * POST /api/feature-store/bundle/:key/cancel — 取消套裝方案（09 分冊 §3）⚙OWNER。
 * 該 source（BUNDLE_LITE / BUNDLE_PRO）的所有列 cancelled_at = now()。
 * 不退點、不縮短到期日；單買（INDIVIDUAL）的列不受影響（方案與單買並存）。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('OWNER');
  const { key } = await params;

  const bundle = FEATURE_BUNDLES[key as FeatureBundleKey];
  if (!bundle) throw new ApiHttpError(404, '找不到此方案', ERR.NOT_FOUND);

  const { data, error } = await createAdminSupabase()
    .from('feature_subscriptions')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId)
    .eq('source', bundle.source)
    .select('code');
  if (error) throw error;

  return ok({ cancelled: data?.length ?? 0 });
});
