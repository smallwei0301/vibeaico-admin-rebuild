// GET /api/coupons/instances?couponId — 發放明細（04 分冊 §B-4）。
// join customers 取顧客名稱；issued_at desc。全量不分頁（明細受票券總量約束，小表）。
import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const querySchema = z.object({
  couponId: z.string().uuid(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  // 票券須屬本租戶（帶他店 id 一律 404，規約 7）
  const { data: coupon, error: e0 } = await t.supabase
    .from('coupons').select('id')
    .eq('id', q.couponId).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!coupon) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);

  const { data, error } = await t.supabase
    .from('coupon_instances')
    .select('id, coupon_id, customer_id, code, issued_at, redeemed_at, customers(name)')
    .eq('tenant_id', t.tenantId).eq('coupon_id', q.couponId)
    .order('issued_at', { ascending: false });
  if (error) throw error;

  // types.ts 尚無 CouponInstance 型別（不得改 types.ts）→ 依 mappers 命名慣例回 camelCase
  return ok(
    (data ?? []).map((r: any) => ({
      id: r.id,
      couponId: r.coupon_id,
      customerId: r.customer_id,
      customerName: r.customers?.name ?? '',
      code: r.code,
      issuedAt: r.issued_at,
      redeemedAt: r.redeemed_at,
    })),
  );
});
