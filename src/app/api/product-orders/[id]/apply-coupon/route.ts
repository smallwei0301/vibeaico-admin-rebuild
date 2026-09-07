// POST /api/product-orders/:id/apply-coupon — {code}：核銷票券並重算
// total_amount（issue #33 第 ① 筆：原本前端假裝套用票券，票券代碼從沒送到
// 後端，也從沒被核銷）。
//
// 核銷邏輯（找票券、核對顧客、核銷、算折扣）與 bookings 的 apply-coupon
// 端點共用同一支 src/server/coupons.ts redeemCoupon()，不重複實作。
//
// 折抵金額與「用了哪張票券」都會寫回 product_orders：
//   total_amount       扣掉折抵之後的實付金額（這是真正的錢）
//   coupon_discount    這次折抵了多少（total_amount 已經是扣完的，這欄是明細）
//   coupon_instance_id 是哪一張 coupon_instances 做的，讓折抵可回溯到具體票券
//
// 這兩個欄位在 TEST 與正式庫本來就存在，但**不在 repo 的 migration 帳本裡**
// （issue #33 的 0027 只送到資料庫、程式碼從未合併）。0081 把它們補進帳本，
// 否則從 0001 全新建起來的資料庫沒有這兩欄，local-isolated CI 會與
// canonical TEST 得到相反的結果。詳見
// supabase/migrations/0081_reconcile_product_order_coupon_fields.sql。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { redeemCoupon } from '@/server/coupons';

const bodySchema = z.object({ code: z.string().min(1, '請輸入票券代碼') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: order, error: oErr } = await t.supabase.from('product_orders')
    .select('id, customer_id, total_amount')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (oErr) throw oErr;
  if (!order) throw new ApiHttpError(404, '找不到此訂單', ERR.NOT_FOUND);

  const redemption = await redeemCoupon(
    t.supabase, t.tenantId, b.code, order.customer_id, Number(order.total_amount));

  const { error: uErr } = await t.supabase.from('product_orders')
    .update({
      total_amount: redemption.newAmount,
      coupon_discount: redemption.discount,
      coupon_instance_id: redemption.instanceId,
    })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  return ok({ totalAmount: redemption.newAmount, couponDiscount: redemption.discount });
});
