import { z } from 'zod';
import { fail, ERR, handle, ok } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { requireTenant } from '@/server/tenant';

type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  decision: z.enum(['STILL_FORM', 'EXTEND', 'CONTINUE', 'CANCEL']),
  newDeadline: z.string().datetime().optional(),
  note: z.string().max(2_000).optional(),
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const body = bodySchema.parse(await req.json());
  const { data, error } = await createAdminSupabase().rpc('decide_tour_formation', {
    p_tenant: t.tenantId, p_departure: id, p_decision: body.decision,
    p_actor_user: t.user.id, p_new_deadline: body.newDeadline ?? null, p_note: body.note ?? '',
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('DEPARTURE_NOT_FOUND')) return fail(404, '找不到此團次', ERR.NOT_FOUND);
    if (message.includes('FORMATION_DECISION_INVALID') || message.includes('FORMATION_DEADLINE_INVALID'))
      return fail(409, '此團次目前不能執行這個決定', ERR.CONFLICT);
    throw error;
  }
  return ok({ formationStatus: data });
});
