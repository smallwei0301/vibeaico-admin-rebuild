import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/customers/:id/unbind-line — 雙向清除（04 分冊 §B-5.1）：
 * customers.line_user_id → null、line_users.customer_id → null。
 * 未綁定時視為已完成（冪等），直接回成功。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data: customer, error: e0 } = await t.supabase
    .from('customers')
    .select('id, line_user_id')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);

  if (customer.line_user_id) {
    const { error: e1 } = await t.supabase
      .from('line_users')
      .update({ customer_id: null, updated_at: new Date().toISOString() })
      .eq('tenant_id', t.tenantId)
      .eq('line_user_id', customer.line_user_id);
    if (e1) throw e1;
  }

  // 也清掉任何仍指向此顧客的 line_users 列（防資料曾單向不一致）
  const { error: e2 } = await t.supabase
    .from('line_users')
    .update({ customer_id: null, updated_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId)
    .eq('customer_id', id);
  if (e2) throw e2;

  const { error: e3 } = await t.supabase
    .from('customers')
    .update({ line_user_id: null })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (e3) throw e3;

  return ok({ unbound: true });
});
