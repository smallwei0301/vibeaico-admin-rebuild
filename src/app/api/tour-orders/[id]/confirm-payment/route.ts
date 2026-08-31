import { z } from 'zod';
import { fail, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  amount: z.coerce.number().positive('實收金額必須大於 0'),
  receiptReference: z.string().trim().min(1, '請輸入可稽核的收款憑證編號'),
});

/** Bank/manual confirmation is amount + receipt based; it never assumes that
 * a click means the full order was paid. */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const body = bodySchema.parse(await req.json());
  const { data, error } = await createAdminSupabase().rpc('record_tour_order_payment_41', {
    p_tenant: t.tenantId, p_order: id, p_actor_user: t.user.id,
    p_amount: body.amount, p_channel: 'BANK_MANUAL', p_receipt_reference: body.receiptReference,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('TOUR_ORDER_NOT_FOUND')) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
    if (message.includes('PAYMENT_AMOUNT_EXCEEDS_TOTAL') || message.includes('PAYMENT_RECEIPT_CONFLICT')
      || message.includes('PAYMENT_ORDER_NOT_PAYABLE')) return fail(409, '此筆收款無法套用至訂單', ERR.CONFLICT);
    if (message.includes('PAYMENT_RECEIPT_INVALID')) return fail(400, '收款資料不完整', ERR.VALIDATION);
    throw error;
  }
  return ok({ orderId: data });
});
