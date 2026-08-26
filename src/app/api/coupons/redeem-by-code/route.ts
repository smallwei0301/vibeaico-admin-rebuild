// POST /api/coupons/redeem-by-code — 核銷（04 分冊 §B-4）。
// {code} → 本租戶 instance：不存在 404；已核銷 409；否則 redeemed_at=now。
//
// 核銷邏輯走 src/server/coupon-redeem.ts 的共用實作（issue #33：原本這裡與
// /api/bookings/:id/apply-coupon 各有一份拷貝）。這一支不綁單據，所以不帶
// expectCustomerId——店員手動核銷就是掃碼即核銷。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { redeemCouponByCode } from '@/server/coupon-redeem';

const bodySchema = z.object({
  code: z.string().min(1, '請輸入核銷代碼'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'COUPON_SYSTEM');
  const b = bodySchema.parse(await req.json());

  const c = await redeemCouponByCode(t, b.code, {
    notFoundMessage: '找不到此核銷代碼',
    alreadyRedeemedMessage: '此票券已核銷過',
  });

  // 回票券摘要供前端顯示核銷成功訊息（票券名稱＋折扣內容）
  return ok({
    id: c.instanceId,
    couponId: c.couponId,
    couponName: c.couponName,
    discountType: c.discountType,
    discountValue: c.discountValue,
    customerId: c.customerId,
    customerName: c.customerName,
  });
});
