// POST /api/coupons/:id/batch-issue — 批次發放（04 分冊 §B-4）。
// body {customerIds[]}：每人一張 coupon_instances，code = 8 碼大寫英數。
import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
// 代碼產生器抽到 src/server/coupon-code.ts 共用（issue #176 的活動獎勵也要發券）。
// unique (tenant_id, code) 是跨來源的，兩份各自演化會讓碰撞機率跟著實作漂移。
import { genCouponCode } from '@/server/coupon-code';

const bodySchema = z.object({
  customerIds: z.array(z.string().uuid()).min(1, '請選擇至少一位顧客'),
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'COUPON_SYSTEM');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  // 票券存在且屬本租戶
  const { data: coupon, error: e0 } = await t.supabase
    .from('coupons').select('id, total_quantity')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!coupon) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);

  // 顧客皆須屬本租戶（帶他店 id 一律 404，規約 7）
  const customerIds = Array.from(new Set(b.customerIds));
  const { data: customers, error: e1 } = await t.supabase
    .from('customers').select('id')
    .eq('tenant_id', t.tenantId).in('id', customerIds);
  if (e1) throw e1;
  if ((customers ?? []).length !== customerIds.length)
    throw new ApiHttpError(404, '找不到部分顧客', ERR.NOT_FOUND);

  // 限量檢查：total_quantity 0 = 不限量（0004 註解）；已發 + 本批 > 總量 → 409
  if (coupon.total_quantity > 0) {
    const { count, error: e2 } = await t.supabase
      .from('coupon_instances')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('coupon_id', id);
    if (e2) throw e2;
    if ((count ?? 0) + customerIds.length > coupon.total_quantity)
      throw new ApiHttpError(409, '發放數量超過票券總量上限', ERR.CONFLICT);
  }

  // code 有 unique (tenant_id, code) 約束；32^8 ≈ 1.1e12 組合，碰撞機率極低，
  // 仍以 23505 重試（換一批新 code）保險，最多 3 次。
  for (let attempt = 0; ; attempt++) {
    const rows = customerIds.map((customerId) => ({
      tenant_id: t.tenantId,
      coupon_id: id,
      customer_id: customerId,
      code: genCouponCode(),
    }));
    const { error } = await t.supabase.from('coupon_instances').insert(rows);
    if (!error) break;
    if (error.code === '23505' && attempt < 2) continue;
    throw error;
  }

  return ok({ issued: customerIds.length });
});
