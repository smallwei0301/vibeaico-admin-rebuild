import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapPaymentMethodRow, testGatewayConnection } from '@/server/payment-methods';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const { data: row, error } = await t.supabase.from('tenant_payment_methods')
    .select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!row) return ok({ ok: false, verifiable: true, code: 'REQ_002', message: '找不到此收款方式' });

  const result = await testGatewayConnection(row);
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await t.supabase.from('tenant_payment_methods')
    .update({
      last_verified_at: now,
      connection_verified_at: result.ok ? now : null,
      verification_error: result.ok ? null : result.message,
    })
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').single();
  if (updateError) throw updateError;
  return ok({ ...result, method: mapPaymentMethodRow(updated) });
});
