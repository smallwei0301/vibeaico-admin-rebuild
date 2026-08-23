// POST /api/bookings/:id/apply-coupon — {code}：核銷票券並重算 final_price（04 §B-1）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const bodySchema = z.object({ code: z.string().min(1, '請輸入票券代碼') });

/**
 * discount 欄位語意（0004 migration：coupons.discount_type / discount_value，
 * enum AMOUNT | PERCENT | GIFT——migration 未再註解，此處決策並固定）：
 *   AMOUNT  折抵固定金額：final = max(0, final - value)
 *   PERCENT 打折（value = 折扣百分比，例 10 = 九折/減 10%）：
 *           final = round(final * (1 - value/100))，round 取整避免小數金額
 *   GIFT    贈品券：不影響金額，只核銷
 * 折扣基底用「目前的 final_price」而非原價 price：apply-points / adjust-price
 * 可能已先動過 final_price，用原價重算會把先前的折抵洗掉。
 */
function applyDiscount(final: number, type: string, value: number): number {
  if (type === 'AMOUNT') return Math.max(0, final - value);
  if (type === 'PERCENT') return Math.max(0, Math.round(final * (1 - value / 100)));
  return final; // GIFT
}

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, customer_id, final_price, custom_fields')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  const { data: inst, error: iErr } = await t.supabase.from('coupon_instances')
    .select('id, customer_id, redeemed_at, coupons(discount_type, discount_value)')
    .eq('tenant_id', t.tenantId).eq('code', b.code).maybeSingle();
  if (iErr) throw iErr;
  if (!inst) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);
  if (inst.redeemed_at)
    throw new ApiHttpError(409, '此票券已核銷', ERR.CONFLICT);
  // 票券是發給特定顧客的（coupon_instances.customer_id not null），
  // 只允許核銷在該顧客自己的預約上。
  if (inst.customer_id !== booking.customer_id)
    throw new ApiHttpError(409, '此票券不屬於該預約的顧客', ERR.CONFLICT);

  // 巢狀 join 靜態型別在無 Database 型別時被推成陣列，實際為多對一物件
  // （同 src/server/email/notify.ts 的說明），先轉 unknown 再取用。
  const coupon = (inst as unknown as {
    coupons: { discount_type: string; discount_value: number } | null;
  }).coupons;
  if (!coupon) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);

  // 先標記核銷（條件帶 redeemed_at is null，兩個併發請求只有一個會成功）。
  const { data: redeemed, error: rErr } = await t.supabase.from('coupon_instances')
    .update({ redeemed_at: new Date().toISOString() })
    .eq('id', inst.id).eq('tenant_id', t.tenantId).is('redeemed_at', null)
    .select('id').maybeSingle();
  if (rErr) throw rErr;
  if (!redeemed) throw new ApiHttpError(409, '此票券已核銷', ERR.CONFLICT);

  // bookings 表沒有 coupon 欄位（0004 migration；欄位真相以 DB 為準），
  // 「booking 記 coupon」改記在 custom_fields jsonb 的保留鍵 _coupon 底下
  // （不與預約自訂欄位填答的一般鍵衝突），保住票券↔預約的追溯性。
  const newFinal = applyDiscount(
    Number(booking.final_price), coupon.discount_type, Number(coupon.discount_value));
  const { error: uErr } = await t.supabase.from('bookings')
    .update({
      final_price: newFinal,
      custom_fields: {
        ...(booking.custom_fields ?? {}),
        _coupon: {
          instanceId: inst.id, code: b.code,
          discountType: coupon.discount_type, discountValue: Number(coupon.discount_value),
        },
      },
    })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  return ok({ finalPrice: newFinal });
});
