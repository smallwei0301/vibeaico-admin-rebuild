import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapPaymentMethodRow } from '@/server/payment-methods';

const bodySchema = z.object({ active: z.boolean().optional() });

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json().catch(() => ({})));
  const { data: current, error: readError } = await t.supabase.from('tenant_payment_methods')
    .select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) throw new ApiHttpError(404, '找不到此收款方式', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('tenant_payment_methods')
    .update({ active: b.active ?? !current.active })
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').single();
  if (error) throw error;
  return ok(mapPaymentMethodRow(data));
});
