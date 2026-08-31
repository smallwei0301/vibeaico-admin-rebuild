import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  GATEWAY_PROVIDERS, PAYMENT_METHOD_TYPES, buildPaymentMethodMutation, mapPaymentMethodRow,
} from '@/server/payment-methods';

const bodySchema = z.object({
  methodType: z.enum(PAYMENT_METHOD_TYPES).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  qrImageUrl: z.string().max(2048).optional(),
  bankName: z.string().max(120).optional(),
  bankCode: z.string().max(16).optional(),
  accountNumber: z.string().max(64).optional(),
  accountHolderName: z.string().max(120).optional(),
  gatewaySource: z.enum(['own', 'demo']).optional(),
  gatewayProvider: z.enum(GATEWAY_PROVIDERS).optional(),
  gatewayMerchantId: z.string().max(120).optional(),
  gatewayHashKey: z.string().optional(),
  gatewayHashIv: z.string().optional(),
  gatewaySandbox: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
  instructions: z.string().max(2000).optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());
  const { data: current, error: readError } = await t.supabase.from('tenant_payment_methods')
    .select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) throw new ApiHttpError(404, '找不到此收款方式', ERR.NOT_FOUND);
  const mutation = buildPaymentMethodMutation({
    methodType: b.methodType ?? current.method_type,
    displayName: b.displayName ?? current.display_name,
    qrImageUrl: b.qrImageUrl, bankName: b.bankName, bankCode: b.bankCode,
    accountNumber: b.accountNumber, accountHolderName: b.accountHolderName,
    gatewaySource: b.gatewaySource, gatewayProvider: b.gatewayProvider,
    gatewayMerchantId: b.gatewayMerchantId, gatewayHashKey: b.gatewayHashKey,
    gatewayHashIv: b.gatewayHashIv, gatewaySandbox: b.gatewaySandbox,
    sortOrder: b.sortOrder, active: b.active, instructions: b.instructions,
  }, current);
  const { data, error } = await t.supabase.from('tenant_payment_methods')
    .update(mutation).eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此收款方式', ERR.NOT_FOUND);
  return ok(mapPaymentMethodRow(data));
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const { data, error } = await t.supabase.from('tenant_payment_methods')
    .delete().eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此收款方式', ERR.NOT_FOUND);
  return ok();
});
