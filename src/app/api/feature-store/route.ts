import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import type { FeatureSubscription } from '@/config/features';

/**
 * GET /api/feature-store — 回 FeatureSubscription[]。
 * active = DB 的 active 欄位 && (expires_at is null || expires_at > now())。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const { data, error } = await t.supabase
    .from('feature_subscriptions')
    .select('code, active, expires_at')
    .eq('tenant_id', t.tenantId);
  if (error) throw error;

  const now = Date.now();
  const result: FeatureSubscription[] = (data ?? []).map((r) => ({
    code: r.code,
    active: Boolean(r.active) && (r.expires_at === null || new Date(r.expires_at).getTime() > now),
    expiresAt: r.expires_at,
  }));

  return ok(result);
});
