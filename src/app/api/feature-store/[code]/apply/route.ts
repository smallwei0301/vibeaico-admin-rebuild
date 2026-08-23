import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { FEATURE_CATALOG } from '@/config/features';

/**
 * POST /api/feature-store/:code/apply — 訂閱／續訂單一功能（09 分冊 §3）⚙OWNER。
 * body {months: 1|3|6|12}。code 必須在 §1 的 18 個付費碼內，否則 404。
 * 扣點 + 開通走 rpc subscribe_feature（migration 0011，原子操作防止「扣了點
 * 但沒開通」）；餘額不足 → 409 POINTS_001「點數不足」（前端會開儲值 modal）。
 * EXTRA_PUSH 加購前的「LINE 方案提醒」是純前端 modal，後端不管。
 * 成功後若 code 是 COUPON_SYSTEM / PRODUCT_SALES → 執行 §6 還原副作用，
 * 回 {restoredCoupons, restoredProducts}；還原失敗不可讓訂閱失敗 →
 * {restoreSideEffectFailed: true}。
 */
const bodySchema = z.object({
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
});

/**
 * §6 還原副作用：功能到期時被 cron 自動暫停（auto_paused_by_feature=true）的
 * 票券／商品，訂閱恢復後自動改回發布／上架並歸零旗標，回筆數。
 * ⚠️ 與 restore/route.ts 內同名函式刻意重複 —— 共用落點 src/server/features.ts
 * 由另一 agent 負責（檔案所有權），且 route.ts 不允許額外具名匯出。
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

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('OWNER');
  const { code } = await params;
  const { months } = bodySchema.parse(await req.json());

  const item = FEATURE_CATALOG.find((f) => f.key === code && f.paid);
  if (!item) throw new ApiHttpError(404, '找不到此功能', ERR.NOT_FOUND);

  const admin = createAdminSupabase();
  const { error } = await admin.rpc('subscribe_feature', {
    p_tenant: t.tenantId,
    p_code: code,
    p_months: months,
    p_price: item.price, // 目錄價（點/月）
    p_source: 'INDIVIDUAL',
  });
  if (error) {
    // POINTS_001 尚未收進 server/http.ts 的 ERR 表（該檔屬其他 agent），先用字面值
    if (error.message?.includes('INSUFFICIENT_POINTS'))
      throw new ApiHttpError(409, '點數不足', 'POINTS_001');
    throw error;
  }

  if (code === 'COUPON_SYSTEM' || code === 'PRODUCT_SALES') {
    try {
      return ok(await runRestoreSideEffects(admin, t.tenantId, code));
    } catch (e) {
      // 還原失敗不可讓訂閱失敗（09 分冊 §6）；前端已有對應警示文案
      console.error('[feature-store] restore side effect failed', code, e);
      return ok({ restoreSideEffectFailed: true });
    }
  }

  return ok();
});
