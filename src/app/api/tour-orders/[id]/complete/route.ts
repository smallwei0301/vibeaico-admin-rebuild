import { fail, ERR, handle } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { requireTenant } from '@/server/tenant';

type Ctx = { params: Promise<{ id: string }> };

/** Completion must freeze #37 performance in the same transaction. The clean
 * source graph lacks it, so this is a stable fail-closed contract, not a fake
 * status update. */
export const POST = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const { data: order, error: readError } = await t.supabase.from('tour_orders')
    .select('departure_id').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!order) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  const { error } = await createAdminSupabase().rpc('complete_tour_departure_41', {
    p_tenant: t.tenantId, p_departure: order.departure_id, p_actor_user: t.user.id,
  });
  if (error?.message?.includes('TOUR_COMPLETION_BLOCKED_BY_DEPENDENCY_37'))
    return fail(503, 'TOUR_COMPLETION_BLOCKED_BY_DEPENDENCY_37', 'TOUR_COMPLETION_BLOCKED_BY_DEPENDENCY_37');
  if (error) throw error;
  return fail(503, 'TOUR_COMPLETION_CONTRACT_NOT_WIRED', 'TOUR_COMPLETION_CONTRACT_NOT_WIRED');
});
