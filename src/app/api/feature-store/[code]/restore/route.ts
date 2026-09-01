import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { FEATURE_CATALOG } from '@/config/features';

/**
 * POST /api/feature-store/:code/restore — 恢復已取消的訂閱（09 分冊 §3）⚙OWNER。
 * 未過期且已取消 → cancelled_at = null，**不扣點**（用到原到期日為止）；
 * 已過期 → 409「已過期，請重新訂閱」（走 apply 重新扣點訂閱）。
 * 未取消的有效訂閱不可重複呼叫 restore；回 409 且不執行任何還原副作用。
 * COUPON_SYSTEM / PRODUCT_SALES 恢復時執行 §6 還原副作用，
 * 回 {restoredCoupons, restoredProducts}（前端 toast「N 張票券已自動恢復發布」）。
 */

/**
 * §6 還原副作用（與 apply/route.ts 內同名函式刻意重複 —— 共用落點
 * src/server/features.ts 由另一 agent 負責，且 route.ts 不允許額外具名匯出）。
 */
async function runRestoreSideEffects(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  code: string,
): Promise<{ restoredCoupons: number; restoredProducts: number }> {
  let restoredCoupons = 0;
  let restoredProducts = 0;
  if (code === 'COUPON_SYSTEM') {
    const { data, error } = await admin
      .from('coupons')
      .update({ status: 'PUBLISHED', auto_paused_by_feature: false })
      .eq('tenant_id', tenantId)
      .eq('auto_paused_by_feature', true)
      .select('id');
    if (error) throw error;
    restoredCoupons = data?.length ?? 0;
  }
  if (code === 'PRODUCT_SALES') {
    const { data, error } = await admin
      .from('products')
      .update({ active: true, auto_paused_by_feature: false })
      .eq('tenant_id', tenantId)
      .eq('auto_paused_by_feature', true)
      .select('id');
    if (error) throw error;
    restoredProducts = data?.length ?? 0;
  }
  return { restoredCoupons, restoredProducts };
}

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('OWNER');
  const { code } = await params;

  const item = FEATURE_CATALOG.find((f) => f.key === code && f.paid);
  if (!item) throw new ApiHttpError(404, '找不到此功能', ERR.NOT_FOUND);

  const admin = createAdminSupabase();
  const { data: sub, error: e0 } = await admin
    .from('feature_subscriptions')
    .select('code, active, expires_at, cancelled_at')
    .eq('tenant_id', t.tenantId)
    .eq('code', code)
    .maybeSingle();
  if (e0) throw e0;
  if (!sub) throw new ApiHttpError(404, '找不到此訂閱', ERR.NOT_FOUND);

  if (sub.cancelled_at === null) {
    throw new ApiHttpError(409, '此訂閱尚未取消，無需恢復', ERR.CONFLICT);
  }

  // expires_at = null 是平台永久贈送，永遠視為未過期
  if (sub.expires_at !== null && new Date(sub.expires_at).getTime() <= Date.now())
    throw new ApiHttpError(409, '已過期，請重新訂閱', ERR.CONFLICT);

  const { data: restored, error: e1 } = await admin
    .from('feature_subscriptions')
    .update({ cancelled_at: null })
    .eq('tenant_id', t.tenantId)
    .eq('code', code)
    // 避免讀取 cancelled 後被其他請求先恢復時，仍回報本次 restore 成功。
    .not('cancelled_at', 'is', null)
    .select('code');
  if (e1) throw e1;
  if (!restored?.length) {
    throw new ApiHttpError(409, '此訂閱尚未取消，無需恢復', ERR.CONFLICT);
  }

  if (code === 'COUPON_SYSTEM' || code === 'PRODUCT_SALES') {
    try {
      return ok(await runRestoreSideEffects(admin, t.tenantId, code));
    } catch (e) {
      // 還原失敗不可讓恢復失敗（09 分冊 §6）；前端已有對應警示文案
      console.error('[feature-store] restore side effect failed', code, e);
      return ok({ restoreSideEffectFailed: true });
    }
  }

  return ok();
});
