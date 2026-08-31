import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const { data, error } = await t.supabase.from('tenant_payment_methods')
    .select('id,method_type').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return ok({ ok: false, verifiable: true, code: 'REQ_002', message: '找不到此收款方式' });
  return ok({
    ok: false, verifiable: false, state: 'NOT_AVAILABLE', code: 'PAYMENT_E2E_PENDING',
    message: '完整收款流程驗證需待 checkout/callback（Issue #12）完成；未執行扣款。',
  });
});
