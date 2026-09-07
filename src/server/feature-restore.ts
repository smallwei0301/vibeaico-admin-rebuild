// src/server/feature-restore.ts — 功能訂閱恢復後的 §6 還原副作用，共用一份。
//
// 功能到期時 cron 會把票券／商品自動暫停（`auto_paused_by_feature = true`）。
// 訂閱恢復之後這些列必須自動改回發布／上架並歸零旗標，否則店家看到「功能已訂閱」
// 但票券還是停用的——功能是活的，東西卻還藏著。
//
// ⚠️ 這支函式原本在三個 route 各自有一份拷貝（`[code]/apply`、`[code]/restore`，
// 而 `bundle/[key]/apply` **根本沒有**）。那兩份的檔頭都寫著「刻意重複，共用落點
// src/server/features.ts 由另一 agent 負責」——那個所有權限制早已不存在，而重複
// 的代價已經實現了：套裝方案那一支從一開始就漏掉，沒有人發現，因為沒有單一真相
// 可以對照。現在收斂成這一份。
import type { createAdminSupabase } from '@/server/supabase';

/** 會觸發還原副作用的功能碼；其餘功能碼恢復時沒有副作用。 */
export const RESTORE_SIDE_EFFECT_CODES = ['COUPON_SYSTEM', 'PRODUCT_SALES'] as const;

export type RestoreSideEffectResult = {
  restoredCoupons: number;
  restoredProducts: number;
};

export function hasRestoreSideEffect(code: string): boolean {
  return (RESTORE_SIDE_EFFECT_CODES as readonly string[]).includes(code);
}

/**
 * 對一組功能碼執行還原副作用，回傳合計筆數。
 *
 * 傳入單一碼（單項訂閱／恢復）或整組碼（套裝方案）都走同一條路徑，這樣「套裝
 * 有沒有做還原」不再是另一段要各自維護的邏輯。不在 RESTORE_SIDE_EFFECT_CODES
 * 裡的碼會被忽略，所以呼叫端可以直接把整個 bundle.codes 丟進來。
 */
export async function runRestoreSideEffects(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  codes: readonly string[],
): Promise<RestoreSideEffectResult> {
  let restoredCoupons = 0;
  let restoredProducts = 0;

  if (codes.includes('COUPON_SYSTEM')) {
    const { data, error } = await admin
      .from('coupons')
      .update({ status: 'PUBLISHED', auto_paused_by_feature: false })
      .eq('tenant_id', tenantId)
      .eq('auto_paused_by_feature', true)
      .select('id');
    if (error) throw error;
    restoredCoupons = data?.length ?? 0;
  }

  if (codes.includes('PRODUCT_SALES')) {
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
