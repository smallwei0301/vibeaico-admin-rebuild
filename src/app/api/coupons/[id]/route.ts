import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * PUT /api/coupons/:id — 更新票券（04 分冊 §B-4）⚙M。
 * 所有欄位皆可選；只更新 body 裡實際出現的欄位（同 customers/:id 模式）。
 * startAt/endAt 空字串 = 明確清空 → 存 null。status 不在此端點改，
 * 狀態機一律走 publish/pause/resume 子端點。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入票券名稱').optional(),
  description: z.string().optional(),
  discountType: z.enum(['AMOUNT', 'PERCENT', 'GIFT']).optional(),
  discountValue: z.number().min(0).optional(),
  totalQuantity: z.number().int().min(0).optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  minOrderAmount: z.number().min(0).nullable().optional(),
  maxDiscountAmount: z.number().min(0).nullable().optional(),
  giftItem: z.string().optional(),
  limitPerCustomer: z.number().int().min(1).nullable().optional(),
  privateMode: z.boolean().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'COUPON_SYSTEM');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.description !== undefined) update.description = b.description;
  if (b.discountType !== undefined) update.discount_type = b.discountType;
  if (b.discountValue !== undefined) update.discount_value = b.discountValue;
  if (b.totalQuantity !== undefined) update.total_quantity = b.totalQuantity;
  if (b.startAt !== undefined) update.start_at = b.startAt ? b.startAt : null;
  if (b.endAt !== undefined) update.end_at = b.endAt ? b.endAt : null;
  if (b.minOrderAmount !== undefined) update.min_order_amount = b.minOrderAmount;
  if (b.maxDiscountAmount !== undefined) update.max_discount_amount = b.maxDiscountAmount;
  if (b.giftItem !== undefined) update.gift_item = b.giftItem;
  if (b.limitPerCustomer !== undefined) update.limit_per_customer = b.limitPerCustomer;
  if (b.privateMode !== undefined) update.private_mode = b.privateMode;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase
      .from('coupons').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);
    return ok();
  }

  const { data, error } = await t.supabase
    .from('coupons').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);

  return ok();
});

/**
 * DELETE /api/coupons/:id — 僅 DRAFT 可刪（04 分冊 §B-4），其他狀態 409。
 * coupon_instances FK 為 on delete cascade，DRAFT 尚未發放不會有 instance。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'COUPON_SYSTEM');
  const { id } = await params;

  const { data: existing, error: e0 } = await t.supabase
    .from('coupons').select('id, status').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此票券', ERR.NOT_FOUND);
  if (existing.status !== 'DRAFT')
    throw new ApiHttpError(409, '僅草稿票券可以刪除', ERR.CONFLICT);

  const { error } = await t.supabase
    .from('coupons').delete().eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'DRAFT');
  if (error) throw error;

  return ok();
});
