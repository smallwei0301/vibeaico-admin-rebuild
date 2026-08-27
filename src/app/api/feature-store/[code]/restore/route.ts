import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { FEATURE_CATALOG } from '@/config/features';

/**
 * POST /api/feature-store/:code/restore — 恢復已取消的訂閱（09 分冊 §3）⚙OWNER。
 * 未過期且已取消 → cancelled_at = null，**不扣點**（用到原到期日為止）；
 * 已過期 → 409「已過期，請重新訂閱」（走 apply 重新扣點訂閱）。
 * COUPON_SYSTEM / PRODUCT_SALES 恢復時執行 §6 還原副作用，
 * 回 {restoredCoupons, restoredProducts}（前端 toast「N 張票券已自動恢復發布」）。
 */

/**
 * 還原副作用失敗時，在 `bug_reports`（0012／0018）留一筆平台端待處理紀錄。
 *
 * 為什麼要有這個（14 分冊 §8.10 的同一條紀律，第三輪稽核）：先前這個失敗只有
 * `console.error`，而畫面卻對店家說「（已通知平台處理）」——**沒有任何人被通知**。
 * 店家因此不會主動回報，問題就這樣消失。而票券／商品的自動恢復是平台端邏輯，
 * 店家自己修不好，沒人知道就真的沒人處理。
 *
 * 這筆紀錄必須一眼看得出是系統自動產生、不是使用者回報，所以：
 * `reporter = 'system'`（使用者回報一律是登入者 email）、
 * `category = 'SYSTEM_RESTORE_SIDE_EFFECT'`（使用者回報的類別來自 modal 下拉選單）。
 *
 * 寫入本身也可能失敗，所以整段 try/catch 吞錯並 log——但**回傳值必須說實話**：
 * 成功才回 `true`，失敗回 `false`，呼叫端據此填 `platformNotified`，畫面再據此
 * 決定敢不敢說「已自動記錄」。這一段刻意不 `return true` 了事：這整件事本來就是
 * 在清「宣稱一個沒量到的狀態」，實作若無條件回 true，就是在同一個地方再犯一次。
 *
 * @returns `bug_reports` 這筆 insert 是否真的成功（`error === null` 且沒拋錯）
 */
async function recordPlatformIssue(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  reporterEmail: string,
  code: string,
  cause: unknown,
): Promise<boolean> {
  try {
    /*
     * Supabase 丟出來的是 PostgrestError（普通物件，不是 Error 實例），
     * 直接 String() 會變成 '[object Object]'——那筆紀錄就等於沒有原因，
     * 平台端看到也修不了。所以物件走 JSON 序列化，保住 message/code/details/hint。
     */
    const detail = cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : (cause && typeof cause === 'object')
        ? JSON.stringify(cause, Object.getOwnPropertyNames(cause))
        : String(cause);
    const { error } = await admin.from('bug_reports').insert({
      tenant_id: tenantId,
      reporter: 'system',
      category: 'SYSTEM_RESTORE_SIDE_EFFECT',
      subject: `[自動] 恢復訂閱的還原副作用失敗：${code}`,
      content:
        `功能代碼：${code}\n` +
        `操作者：${reporterEmail || '(未知)'}\n` +
        `失敗原因：${detail}\n\n` +
        '訂閱本身已恢復（cancelled_at 已清空），但票券重新發布／商品重新上架失敗，' +
        '需要平台端人工確認 auto_paused_by_feature 仍為 true 的資料。',
      contact_email: reporterEmail || '',
      page_url: '/tenant/feature-store',
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[feature-store] 無法寫入平台待處理紀錄（bug_reports）', code, e);
    return false;
  }
}

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
    .select('code, expires_at, cancelled_at')
    .eq('tenant_id', t.tenantId)
    .eq('code', code)
    .maybeSingle();
  if (e0) throw e0;
  if (!sub) throw new ApiHttpError(404, '找不到此訂閱', ERR.NOT_FOUND);

  // expires_at = null 是平台永久贈送，永遠視為未過期
  if (sub.expires_at !== null && new Date(sub.expires_at).getTime() <= Date.now())
    throw new ApiHttpError(409, '已過期，請重新訂閱', ERR.CONFLICT);

  const { error: e1 } = await admin
    .from('feature_subscriptions')
    .update({ cancelled_at: null })
    .eq('tenant_id', t.tenantId)
    .eq('code', code);
  if (e1) throw e1;

  if (code === 'COUPON_SYSTEM' || code === 'PRODUCT_SALES') {
    try {
      return ok(await runRestoreSideEffects(admin, t.tenantId, code));
    } catch (e) {
      // 還原失敗不可讓恢復失敗（09 分冊 §6）；前端已有對應警示文案
      console.error('[feature-store] restore side effect failed', code, e);
      // 平台端待處理紀錄：這個失敗店家自己修不好，沒人知道就沒人處理（見上方註解）
      const platformNotified =
        await recordPlatformIssue(admin, t.tenantId, t.user.email ?? '', code, e);
      /*
       * platformNotified 照實回傳，**不是無條件 true**：紀錄寫成功畫面才可以說
       * 「已自動記錄」，寫失敗就得叫店家聯絡客服。這個旗標本身若說謊，就是把
       * 「捏造的已知」從文案搬到了 API——同一個錯換個地方犯。
       */
      return ok({ restoreSideEffectFailed: true, platformNotified });
    }
  }

  return ok();
});
