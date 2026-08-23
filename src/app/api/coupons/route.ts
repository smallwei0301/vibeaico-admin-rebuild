import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapCoupon } from '@/server/mappers';

/**
 * GET /api/coupons — coupons + issued_quantity/redeemed_quantity。
 * 02 分冊註解：這兩個數字用 count 即時算；票券表全量小表，一次抓
 * coupon_instances 的 (coupon_id, redeemed_at) 在記憶體依 coupon_id 分組計數，
 * 比逐筆子查詢便宜。全量不分頁，created_at desc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const [{ data: coupons, error: e1 }, { data: instances, error: e2 }] = await Promise.all([
    t.supabase
      .from('coupons')
      .select('*')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false }),
    t.supabase
      .from('coupon_instances')
      .select('coupon_id, redeemed_at')
      .eq('tenant_id', t.tenantId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const counts = new Map<string, { issued: number; redeemed: number }>();
  for (const inst of instances ?? []) {
    const c = counts.get(inst.coupon_id) ?? { issued: 0, redeemed: 0 };
    c.issued += 1;
    if (inst.redeemed_at) c.redeemed += 1;
    counts.set(inst.coupon_id, c);
  }

  return ok(
    (coupons ?? []).map((r: any) => {
      const c = counts.get(r.id);
      return mapCoupon({ ...r, issued_quantity: c?.issued ?? 0, redeemed_quantity: c?.redeemed ?? 0 });
    }),
  );
});

/**
 * POST /api/coupons — 新增票券（04 分冊 §B-4）⚙M。
 * 新票券一律 DRAFT（coupon_status enum default），發佈走 /:id/publish。
 * startAt/endAt 空字串 = 未設定 → 存 null（timestamptz 欄位不接受 ''）。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入票券名稱'),
  description: z.string().optional(),
  discountType: z.enum(['AMOUNT', 'PERCENT', 'GIFT']),
  discountValue: z.number().min(0).default(0),
  totalQuantity: z.number().int().min(0).default(0), // 0 = 不限量（0004 註解）
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'COUPON_SYSTEM');
  const b = bodySchema.parse(await req.json());

  const { data, error } = await t.supabase
    .from('coupons')
    .insert({
      tenant_id: t.tenantId,
      name: b.name,
      description: b.description ?? '',
      discount_type: b.discountType,
      discount_value: b.discountValue,
      total_quantity: b.totalQuantity,
      start_at: b.startAt ? b.startAt : null,
      end_at: b.endAt ? b.endAt : null,
      status: 'DRAFT',
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
