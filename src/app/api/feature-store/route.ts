import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import type { FeatureSubscription } from '@/config/features';

/**
 * GET /api/feature-store — 回 FeatureSubscription[]。
 * active = DB 的 active 欄位 && (expires_at is null || expires_at > now())。
 * cancelled_at 不影響到期前可用（09 分冊 §2），只透過 cancelledAt 給前端顯示
 * 「已取消（到期前可用）」。started_at/cancelled_at/source 為 migration 0011 新欄位。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const { data, error } = await t.supabase
    .from('feature_subscriptions')
    .select('code, active, expires_at, started_at, cancelled_at, source')
    .eq('tenant_id', t.tenantId);
  if (error) throw error;

  const now = Date.now();
  const result: FeatureSubscription[] = (data ?? []).map((r) => ({
    code: r.code,
    active: Boolean(r.active) && (r.expires_at === null || new Date(r.expires_at).getTime() > now),
    expiresAt: r.expires_at,
    startedAt: r.started_at ?? undefined,
    cancelledAt: r.cancelled_at ?? null,
    source: r.source ?? undefined,
  }));

  return ok(result);
});
