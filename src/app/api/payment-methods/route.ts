import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  PAYMENT_METHOD_TYPES, GATEWAY_PROVIDERS, buildPaymentMethodMutation, mapPaymentMethodRow,
} from '@/server/payment-methods';

const bodySchema = z.object({
  methodType: z.enum(PAYMENT_METHOD_TYPES),
  displayName: z.string().trim().min(1).max(120),
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

export const GET = handle(async () => {
  const t = await requireTenant();
  const { data, error } = await t.supabase.from('tenant_payment_methods')
    .select('*').eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return ok((data ?? []).map((row) => mapPaymentMethodRow(row)));
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());
  const mutation = buildPaymentMethodMutation(b);
  const { data, error } = await t.supabase.from('tenant_payment_methods')
    .insert({ tenant_id: t.tenantId, ...mutation }).select('*').single();
  if (error) throw error;
  return ok(mapPaymentMethodRow(data));
});
