// POST /api/points/transfer — 跨店點數轉移（04 分冊 §B-4）⚙O。
// OUT/IN 兩筆交易在 DB function transfer_tenant_points 內同一交易完成
// （supabase/migrations/0012）。rpc 已 revoke anon/authenticated，只能以
// service role 呼叫（createAdminSupabase）；⚙O 權限在這裡（API 層）驗。
import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

const bodySchema = z.object({
  toShopCode: z.string().min(1, '請輸入目標店家代碼'),
  amount: z.number().int('點數必須為整數').positive('點數必須大於 0'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('OWNER');
  const b = bodySchema.parse(await req.json());

  const admin = createAdminSupabase();
  const { error } = await admin.rpc('transfer_tenant_points', {
    p_from_tenant: t.tenantId,
    p_to_shop_code: b.toShopCode,
    p_amount: b.amount,
  });

  if (error) {
    // rpc 內 raise exception 的訊息 → HTTP 錯誤映射（0012 分冊註解）
    const msg = error.message ?? '';
    if (msg.includes('TRANSFER_INSUFFICIENT_BALANCE'))
      throw new ApiHttpError(409, '點數餘額不足', 'POINTS_001');
    if (msg.includes('TRANSFER_TARGET_NOT_FOUND'))
      throw new ApiHttpError(404, '找不到目標店家', ERR.NOT_FOUND);
    if (msg.includes('TRANSFER_TO_SELF'))
      throw new ApiHttpError(400, '不能轉移點數給自己的店家', ERR.VALIDATION);
    if (msg.includes('TRANSFER_INVALID_AMOUNT'))
      throw new ApiHttpError(400, '轉移點數必須大於 0', ERR.VALIDATION);
    throw error;
  }

  return ok({ transferred: true });
});
