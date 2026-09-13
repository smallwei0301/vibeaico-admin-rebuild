import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { FEATURE_BUNDLES, type FeatureBundleKey } from '@/config/features';
import { runRestoreSideEffects } from '@/server/feature-restore';

/**
 * POST /api/feature-store/bundle/:key/apply — 訂閱套裝方案（09 分冊 §3）⚙OWNER。
 * key = LITE（399 點/月，5 碼）或 PRO（799 點/月，全部 18 項付費碼），否則 404。
 * 扣點只扣一次套裝價、逐碼 upsert（source=BUNDLE_LITE/PRO）—— 整段包在
 * rpc subscribe_bundle（migration 0011，寫法比照 subscribe_feature）。
 * LITE→PRO 升級：訂 PRO 前先把 source='BUNDLE_LITE' 的列 cancelled_at=now()
 * （剩餘天數不退點，原站規則）；方案與單買並存，取消方案不影響單買。
 *
 * §6 還原副作用：套裝的 codes 若含 COUPON_SYSTEM／PRODUCT_SALES，訂閱成功後
 * 要把被 cron 自動暫停的票券／商品改回發布／上架——與單項 apply 同一條路徑
 * （src/server/feature-restore.ts）。
 *
 * ⚠️ 這一段本來是漏的：單項 apply 與 restore 各自有一份拷貝，套裝這一支根本沒寫。
 * 於是店家取消 COUPON_SYSTEM（票券被自動暫停）後改訂 PRO 方案，方案含
 * COUPON_SYSTEM、功能確實變成已訂閱，**但票券還是停用的**——畫面說功能有了，
 * 東西卻還藏著，而且沒有任何錯誤訊息。
 */
const bodySchema = z.object({
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('OWNER');
  const { key } = await params;
  const { months } = bodySchema.parse(await req.json());

  const bundle = FEATURE_BUNDLES[key as FeatureBundleKey];
  if (!bundle) throw new ApiHttpError(404, '找不到此方案', ERR.NOT_FOUND);

  const admin = createAdminSupabase();

  if (key === 'PRO') {
    // LITE→PRO 升級：先取消 LITE 各碼（剩餘天數不退點）
    const { error } = await admin
      .from('feature_subscriptions')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('tenant_id', t.tenantId)
      .eq('source', 'BUNDLE_LITE');
    if (error) throw error;
  }

  const { error } = await admin.rpc('subscribe_bundle', {
    p_tenant: t.tenantId,
    p_key: key,
    p_codes: bundle.codes,
    p_months: months,
    p_price: bundle.price, // 套裝價（點/月），只扣一次
  });
  if (error) {
    // POINTS_001 尚未收進 server/http.ts 的 ERR 表（該檔屬其他 agent），先用字面值
    if (error.message?.includes('INSUFFICIENT_POINTS'))
      throw new ApiHttpError(409, '點數不足', 'POINTS_001');
    throw error;
  }

  // 還原失敗不可讓訂閱失敗（09 分冊 §6，與單項 apply 同一條規則）：點數已經扣了，
  // 這裡再丟例外會讓店家看到「訂閱失敗」卻已被扣點。
  try {
    return ok(await runRestoreSideEffects(admin, t.tenantId, bundle.codes));
  } catch (e) {
    console.error('[feature-store] bundle restore side effect failed', key, e);
    return ok({ restoreSideEffectFailed: true });
  }
});
