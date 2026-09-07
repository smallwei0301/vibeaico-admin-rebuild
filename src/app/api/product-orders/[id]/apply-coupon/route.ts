// POST /api/product-orders/:id/apply-coupon — {code}：核銷票券並重算
// total_amount（issue #33 第 ① 筆：原本前端假裝套用票券，票券代碼從沒送到
// 後端，也從沒被核銷）。
//
// 核銷邏輯（找票券、核對顧客、核銷、算折扣）與 bookings 的 apply-coupon
// 端點共用同一支 src/server/coupons.ts redeemCoupon()，不重複實作。
//
// product_orders 表沒有可以存「本單套用了哪張票券／折抵多少」的欄位
// （0004 migration：僅 total_amount，沒有 custom_fields 這類 jsonb 欄位可借
// 用——bookings 表才有 custom_fields）。這裡把折抵直接套用到 total_amount
// （這是真正的錢，訂單金額确实變少了），並把這次折抵的金額 couponDiscount
// 原樣回給前端當下顯示；但沒有欄位可以讓「這筆訂單被折抵過多少」在之後重新
// 查詢訂單時還能看到——重新整理後這個折抵數字會從畫面上消失（只剩
// total_amount 已經是折抵後的金額）。若要讓折抵金額能在訂單詳情長期顯示，
// 需要在 product_orders 上新增一個像 coupon_discount numeric not null
// default 0 的欄位（本任務不擅自加 migration，留給 Issue owner 決定）。
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
    .update({ total_amount: redemption.newAmount })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  return ok({ totalAmount: redemption.newAmount, couponDiscount: redemption.discount });
});
