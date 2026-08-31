import { z } from 'zod';
import { fail, ERR, handle, ok } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { requireTenant } from '@/server/tenant';

type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ reason: z.string().max(2_000).optional() });

/** Cancellation and capacity release are one DB transaction. Paid money only
 * becomes REFUND_PENDING; refund policy/provider actions are not inferred. */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const body = bodySchema.parse(await req.json().catch(() => ({})));
  const { data, error } = await createAdminSupabase().rpc('cancel_tour_order_41', {
    p_tenant: t.tenantId, p_order: id, p_actor_user: t.user.id, p_reason: body.reason ?? '',
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('TOUR_ORDER_NOT_FOUND')) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
    if (message.includes('TOUR_ORDER_ALREADY_CANCELLED') || message.includes('TOUR_ORDER_COMPLETED_NOT_CANCELLABLE'))
      return fail(409, '此訂單目前無法取消', ERR.CONFLICT);
    throw error;
  }
  return ok({ orderId: data });
});
