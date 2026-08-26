// POST /api/product-orders/:id/apply-coupon — {code}：核銷票券並重算 total_amount
//（04 分冊 §B-4；issue #33 第 ① 筆）。
//
// 原站出處：docs/specs/product-orders.json
//   jsApiCalls  `/api/product-orders/${id}/apply-coupon`
//   jsStrings[76] 「票券已套用！折抵 ${formatMoney(couponRes.data?.couponDiscount || 0)}」
//     → 回應欄位名 **couponDiscount**，而且**折抵金額由後端算**（前端只是印它）。
//   jsStrings[77] 「票券已套用，但「完成訂單」失敗：」
//     → 原站是**兩段獨立的請求**：先 apply-coupon、再 complete，第二段可以單獨
//       失敗而第一段已經生效。本端點照這個語意做：**只做套券，不碰訂單狀態**，
//       「完成取貨」仍是 POST /api/product-orders/:id/complete。
//       （另一個選項是把兩件事併成單一交易，那樣就不會有那句文案存在的餘地；
//        既然原站的文案明確描述了「前段成功、後段失敗」，就照原站。）
//
// ⚠️ 適用範圍是**我方選定**的，不是原站考據結果：原站對「票券能不能用在商品
// 訂單、有沒有品類限制」零字串。我方採「與 /api/bookings/:id/apply-coupon
// 完全同一套規則」——不限品類，只限票券持有人本人。理由與出處寫在
// src/server/coupon-redeem.ts 的檔頭與 14 分冊 §12.1。
//
// 金額語意：product_orders 只有一個金額欄位 total_amount（0004:166），
// 沒有 bookings 的 price/final_price 兩層。列表頁的「金額」欄與詳情頁的
// 「票券折抵」欄是同一張表的兩個顯示（docs/specs/product-orders.json
// tables[0].columns 只有一個「金額」），所以：
//   total_amount    = **應付金額**，套券後直接扣減
//   coupon_discount = 已發生的折抵金額累計（migration 0027）
// 原始金額仍可由 total_amount + coupon_discount 還原，也可從 product_order_items
// 的單價快照重算。
import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { applyCouponDiscount, redeemCouponByCode } from '@/server/coupon-redeem';

const bodySchema = z.object({ code: z.string().min(1, '請輸入票券代碼') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: order, error: oErr } = await t.supabase.from('product_orders')
    .select('id, customer_id, total_amount, status, coupon_discount')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (oErr) throw oErr;
  if (!order) throw new ApiHttpError(404, '找不到此訂單', ERR.NOT_FOUND);

  // 已完成／已取消的訂單不再套券：金額已經結清，事後改數字沒有對應的實體動作。
  // （原站的套券入口只出現在「完成取貨」的視窗裡，也就是還沒完成的單。）
  if (order.status !== 'PENDING' && order.status !== 'CONFIRMED')
    throw new ApiHttpError(409, '此訂單狀態已變更，請重新整理', ERR.CONFLICT);

  const coupon = await redeemCouponByCode(t, b.code, {
    expectCustomerId: order.customer_id,
    notOwnerMessage: '此票券不屬於該訂單的顧客',
  });

  const before = Number(order.total_amount);
  const after = applyCouponDiscount(before, coupon.discountType, coupon.discountValue);
  const couponDiscount = before - after;

  const { error: uErr } = await t.supabase.from('product_orders')
    .update({
      total_amount: after,
      coupon_discount: Number(order.coupon_discount ?? 0) + couponDiscount,
      coupon_instance_id: coupon.instanceId,
    })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (uErr) throw uErr;

  // 欄位名對齊原站 jsStrings[76] 讀的 `couponRes.data?.couponDiscount`。
  return ok({ totalAmount: after, couponDiscount });
});
