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
      .select('coupon_id, code, redeemed_at')
      .eq('tenant_id', t.tenantId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  /*
   * issue #35：`lastRedeemedCode`（最近一張已核銷實例的代碼）以前是 coupons 頁的
   * 頁內假資料，決定「還原票券（反核銷）」鈕出不出現、還原視窗顯示哪一組代碼。
   * 這裡順手從同一份 instances 算出來（沒有已核銷實例 → null，鈕就不會出現），
   * 不必為了它多打一次 API，也不會產生 N+1。
   */
  const counts = new Map<string, { issued: number; redeemed: number; lastCode: string | null; lastAt: string | null }>();
  for (const inst of instances ?? []) {
    const c = counts.get(inst.coupon_id) ?? { issued: 0, redeemed: 0, lastCode: null, lastAt: null };
    c.issued += 1;
    if (inst.redeemed_at) {
      c.redeemed += 1;
      if (c.lastAt === null || inst.redeemed_at > c.lastAt) {
        c.lastAt = inst.redeemed_at;
        c.lastCode = inst.code;
      }
    }
    counts.set(inst.coupon_id, c);
  }

  return ok(
    (coupons ?? []).map((r: any) => {
      const c = counts.get(r.id);
      return mapCoupon({
        ...r,
        issued_quantity: c?.issued ?? 0,
        redeemed_quantity: c?.redeemed ?? 0,
        last_redeemed_code: c?.lastCode ?? null,
      });
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
  /* --- migration 0022（issue #35）：原站 formModal 既有欄位；null = 未設定 --- */
  minOrderAmount: z.number().min(0).nullable().optional(),
  maxDiscountAmount: z.number().min(0).nullable().optional(),
  giftItem: z.string().optional(),
  limitPerCustomer: z.number().int().min(1).nullable().optional(),
  privateMode: z.boolean().optional(),
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
      min_order_amount: b.minOrderAmount ?? null,
      max_discount_amount: b.maxDiscountAmount ?? null,
      gift_item: b.giftItem ?? '',
      limit_per_customer: b.limitPerCustomer ?? null,
      private_mode: b.privateMode ?? false,
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
