import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { departureStaffAvailability } from '@/server/departure-staff';

type Ctx = { params: Promise<{ id: string }> };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const querySchema = z.object({
  planId: z.string().uuid(),
  departsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().refine((value) => value === '' || TIME_RE.test(value)).optional(),
  excludeDepartureId: z.string().uuid().optional(),
});

/** Candidate names remain visible even when busy; only their availability changes. */
export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { data: plan, error } = await t.supabase.from('trip_plans')
    .select('id, duration_minutes').eq('tenant_id', t.tenantId).eq('trip_id', id).eq('id', q.planId).maybeSingle();
  if (error) throw error;
  if (!plan) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const result = await departureStaffAvailability({
    supabase: t.supabase, tenantId: t.tenantId, departsOn: q.departsOn,
    startTime: q.startTime ?? '', durationMinutes: Number(plan.duration_minutes),
    excludeDepartureId: q.excludeDepartureId,
  });
  const byId = new Map(result.availability.map((item) => [item.staffId, item]));
  return ok({
    count: result.staff.length,
    staff: result.staff.map((staff) => ({
      staffId: staff.id, staffName: staff.name,
      available: byId.get(staff.id)?.available ?? false,
      conflicts: byId.get(staff.id)?.conflicts ?? [],
    })),
  });
});
