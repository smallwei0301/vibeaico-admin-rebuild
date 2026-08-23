// POST /api/coupons/redeem-by-code — 核銷（04 分冊 §B-4）。
// {code} → 本租戶 instance：不存在 404；已核銷 409；否則 redeemed_at=now。
import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

const bodySchema = z.object({
  code: z.string().min(1, '請輸入核銷代碼'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'COUPON_SYSTEM');
  const b = bodySchema.parse(await req.json());
  const code = b.code.trim().toUpperCase(); // 代碼一律大寫英數，輸入寬容處理

  const { data: inst, error: e0 } = await t.supabase
    .from('coupon_instances')
    .select('id, redeemed_at, coupon_id, customer_id, coupons(name, discount_type, discount_value), customers(name)')
    .eq('tenant_id', t.tenantId).eq('code', code)
    .maybeSingle();
  if (e0) throw e0;
  if (!inst) throw new ApiHttpError(404, '找不到此核銷代碼', ERR.NOT_FOUND);
  if (inst.redeemed_at) throw new ApiHttpError(409, '此票券已核銷過', ERR.CONFLICT);

  // 條件式 update（.is redeemed_at null）防止並發重複核銷
  const { data: updated, error: e1 } = await t.supabase
    .from('coupon_instances')
    .update({ redeemed_at: new Date().toISOString() })
    .eq('id', inst.id).eq('tenant_id', t.tenantId).is('redeemed_at', null)
    .select('id').maybeSingle();
  if (e1) throw e1;
  if (!updated) throw new ApiHttpError(409, '此票券已核銷過', ERR.CONFLICT);

  // 回票券摘要供前端顯示核銷成功訊息（票券名稱＋折扣內容）
  const coupon: any = inst.coupons;
  const customer: any = inst.customers;
  return ok({
    id: inst.id,
    couponId: inst.coupon_id,
    couponName: coupon?.name ?? '',
    discountType: coupon?.discount_type ?? null,
    discountValue: coupon?.discount_value != null ? Number(coupon.discount_value) : 0,
    customerId: inst.customer_id,
    customerName: customer?.name ?? '',
  });
});
