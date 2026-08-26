// POST /api/bookings/:id/apply-coupon — {code}：核銷票券並重算 final_price（04 §B-1）。
//
// 核銷本身（查 instance／已核銷／過期／持有人／條件式 update）走
// src/server/coupon-redeem.ts 的共用實作——issue #33 把原本散在這裡、
// /api/coupons/redeem-by-code、以及新的商品訂單版的三份拷貝收成一份。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { applyCouponDiscount, redeemCouponByCode } from '@/server/coupon-redeem';

const bodySchema = z.object({ code: z.string().min(1, '請輸入票券代碼') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, customer_id, final_price, custom_fields, coupon_discount')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  // 票券是發給特定顧客的（coupon_instances.customer_id not null），
  // 只允許核銷在該顧客自己的預約上。
  const coupon = await redeemCouponByCode(t, b.code, {
    expectCustomerId: booking.customer_id,
    notOwnerMessage: '此票券不屬於該預約的顧客',
  });

  // bookings 表沒有 coupon 欄位（0004 migration；欄位真相以 DB 為準），
  // 「booking 記 coupon」改記在 custom_fields jsonb 的保留鍵 _coupon 底下
  // （不與預約自訂欄位填答的一般鍵衝突），保住票券↔預約的追溯性。
  const newFinal = applyCouponDiscount(
    Number(booking.final_price), coupon.discountType, coupon.discountValue);
  /*
   * issue #35：折抵了多少錢以前沒有留下來，於是 bookings 頁的「票券折抵」只能吃
   * 頁內假資料。這裡把**實際發生的折抵金額**累計進 `coupon_discount`
   * （migration 0022），一筆預約套多張票券就累加。原站的 apply-coupon 回應本來
   * 就有 `couponDiscount`（docs/specs/bookings.json jsStrings[127]
   * 「票券折抵 ${couponRes.data?.couponDiscount || 0}」），本輪一併補上回應欄位。
   */
  const couponDiscount = Number(booking.final_price) - newFinal;
  const totalCouponDiscount = Number(booking.coupon_discount ?? 0) + couponDiscount;

  const { error: uErr } = await t.supabase.from('bookings')
    .update({
      final_price: newFinal,
      coupon_discount: totalCouponDiscount,
      custom_fields: {
        ...(booking.custom_fields ?? {}),
        _coupon: {
          instanceId: coupon.instanceId, code: coupon.code,
          discountType: coupon.discountType, discountValue: coupon.discountValue,
        },
      },
    })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  return ok({ finalPrice: newFinal, couponDiscount });
});
