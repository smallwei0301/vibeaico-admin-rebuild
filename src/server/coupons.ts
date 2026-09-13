// 票券核銷共用邏輯 —— bookings 與 product-orders 的 apply-coupon 端點共用
// （issue #33 第 ① 筆明確要求：核銷邏輯只能有一份，不可各自複製一份）。
//
// 語意（0004 migration：coupons.discount_type / discount_value，
// enum AMOUNT | PERCENT | GIFT——migration 未再註解，此處決策並固定）：
//   AMOUNT  折抵固定金額：final = max(0, final - value)
//   PERCENT 打折（value = 折扣百分比，例 10 = 九折/減 10%）：
//           final = round(final * (1 - value/100))，round 取整避免小數金額
//   GIFT    贈品券：不影響金額，只核銷
// 折扣基底用「目前的金額」而非原價：apply-points / adjust-price 等其他折抵
// 可能已先動過金額，用原價重算會把先前的折抵洗掉。
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from '@/server/http';

export function applyDiscount(final: number, type: string, value: number): number {
  if (type === 'AMOUNT') return Math.max(0, final - value);
  if (type === 'PERCENT') return Math.max(0, Math.round(final * (1 - value / 100)));
  return final; // GIFT
}

/**
 * 核銷一張票券並算出折抵後金額。呼叫端負責：
 *   1. 先查出自己那張單據（booking / product_order）確認存在、拿到 customerId
 *      與目前金額；
 *   2. 拿這支函式回傳的 newAmount 寫回自己的金額欄位（bookings.final_price /
 *      product_orders.total_amount）。
 * 這支函式只管「票券」這一段（找票券、核對顧客、核銷、算折扣），不碰呼叫端
 * 的單據表——兩張單據表結構不同，寫回邏輯留在各自的 route 裡。
 *
 * 核銷用 `.is('redeemed_at', null)` 當條件寫入，兩個併發請求只有一個會成功
 * （409），避免同一張票券被核銷兩次。
 */
export async function redeemCoupon(
  supabase: SupabaseClient,
  tenantId: string,
  code: string,
  customerId: string,
  currentAmount: number,
): Promise<{ newAmount: number; discount: number; instanceId: string; discountType: string; discountValue: number }> {
  const { data: inst, error: iErr } = await supabase.from('coupon_instances')
    .select('id, customer_id, redeemed_at, coupons(discount_type, discount_value, start_at, end_at)')
    .eq('tenant_id', tenantId).eq('code', code).maybeSingle();
  if (iErr) throw iErr;
  if (!inst) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);
  if (inst.redeemed_at)
    throw new ApiHttpError(409, '此票券已核銷', ERR.CONFLICT);
  // 票券是發給特定顧客的（coupon_instances.customer_id not null），
  // 只允許核銷在該顧客自己的單據上。
  if (inst.customer_id !== customerId)
    throw new ApiHttpError(409, '此票券不屬於該顧客', ERR.CONFLICT);

  // 巢狀 join 靜態型別在無 Database 型別時被推成陣列，實際為多對一物件
  // （同 src/server/email/notify.ts 的說明），先轉 unknown 再取用。
  const coupon = (inst as unknown as {
    coupons: {
      discount_type: string;
      discount_value: number;
      start_at: string | null;
      end_at: string | null;
    } | null;
  }).coupons;
  if (!coupon) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);

  // 有效期：coupons.start_at / end_at（0004 migration）。這兩欄一直都在，但整條
  // 核銷路徑從來沒有檢查過——過期票券照樣可以核銷、照樣折抵，店家等於在兌現
  // 自己已經結束的活動，而且畫面顯示核銷成功。null = 不限（沒有設定起訖）。
  //
  // 邊界採半開區間 [start_at, end_at)，與專案其他日期範圍判定一致：剛好等於
  // start_at 可用；剛好等於 end_at 已過期。
  const now = Date.now();
  if (coupon.start_at !== null && now < Date.parse(coupon.start_at))
    throw new ApiHttpError(409, '此票券尚未開始', ERR.CONFLICT);
  if (coupon.end_at !== null && now >= Date.parse(coupon.end_at))
    throw new ApiHttpError(409, '此票券已過期', ERR.CONFLICT);

  const { data: redeemed, error: rErr } = await supabase.from('coupon_instances')
    .update({ redeemed_at: new Date().toISOString() })
    .eq('id', inst.id).eq('tenant_id', tenantId).is('redeemed_at', null)
    .select('id').maybeSingle();
  if (rErr) throw rErr;
  if (!redeemed) throw new ApiHttpError(409, '此票券已核銷', ERR.CONFLICT);

  const newAmount = applyDiscount(currentAmount, coupon.discount_type, Number(coupon.discount_value));
  return {
    newAmount,
    discount: currentAmount - newAmount,
    instanceId: inst.id as string,
    discountType: coupon.discount_type,
    discountValue: Number(coupon.discount_value),
  };
}
