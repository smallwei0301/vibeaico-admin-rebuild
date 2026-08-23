import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/customers/:id/bind-line — `{lineUserId}`：雙向寫
 * customers.line_user_id + line_users.customer_id（04 分冊 §B-5.1）。
 * 任一方已綁定其他人 → 409（u_customers_line 唯一索引是最後防線，23505 也轉 409）。
 * 兩段 update 非同交易（MVP，無 rpc）；第二段失敗時回滾第一段。
 */
const bodySchema = z.object({ lineUserId: z.string().min(1, '請指定 LINE 使用者') });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: customer, error: e0 } = await t.supabase
    .from('customers')
    .select('id, line_user_id')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
  if (customer.line_user_id && customer.line_user_id !== b.lineUserId)
    throw new ApiHttpError(409, '此顧客已綁定其他 LINE 帳號', ERR.CONFLICT);

  const { data: lu, error: e1 } = await t.supabase
    .from('line_users')
    .select('line_user_id, customer_id')
    .eq('tenant_id', t.tenantId)
    .eq('line_user_id', b.lineUserId)
    .maybeSingle();
  if (e1) throw e1;
  if (!lu) throw new ApiHttpError(404, '找不到此 LINE 使用者', ERR.NOT_FOUND);
  if (lu.customer_id && lu.customer_id !== id)
    throw new ApiHttpError(409, '此 LINE 帳號已綁定其他顧客', ERR.CONFLICT);

  const { error: e2 } = await t.supabase
    .from('customers')
    .update({ line_user_id: b.lineUserId })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (e2) {
    if ((e2 as any).code === '23505')
      throw new ApiHttpError(409, '此 LINE 帳號已綁定其他顧客', ERR.CONFLICT);
    throw e2;
  }

  const { error: e3 } = await t.supabase
    .from('line_users')
    .update({ customer_id: id, updated_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId)
    .eq('line_user_id', b.lineUserId);
  if (e3) {
    // 回滾第一段，維持雙向一致
    await t.supabase
      .from('customers')
      .update({ line_user_id: customer.line_user_id ?? null })
      .eq('id', id).eq('tenant_id', t.tenantId);
    throw e3;
  }

  return ok({ bound: true });
});
