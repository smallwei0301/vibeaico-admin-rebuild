import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
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
