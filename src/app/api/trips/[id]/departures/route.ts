import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant, requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripDeparture } from '@/server/mappers';
import { departureCreateSchema, timeValue } from '@/server/tour-domain';
import {
  assertStaffBelongsToTenant, bookableStaffIds, checkAssignmentConflicts, departureSlot,
  describeConflicts, readAssignments, resolveAssignment, writeAssignment,
} from '@/server/departure-staff';

type Context = { params: Promise<{ id: string }> };

async function findTripPlan(t: Awaited<ReturnType<typeof requireTenant>>, tripId: string, planId: string) {
  const { data, error } = await t.supabase.from('trip_plans').select('id, trip_id')
    .eq('tenant_id', t.tenantId).eq('id', planId).maybeSingle();
  if (error) throw error;
  return data && data.trip_id === tripId ? data : null;
}

export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  const { data: trip, error: tripError } = await t.supabase.from('trips').select('id')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (tripError) throw tripError;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('trip_departures')
    .select('*, trip_plans(name)').eq('tenant_id', t.tenantId).eq('trip_id', id)
    .order('departs_on', { ascending: true }).order('start_time', { ascending: true, nullsFirst: true });
  if (error) throw error;
  const rows = data ?? [];
  // 指派另外讀一次而不是塞進上面的 select：`trip_departure_staff` 一團可能多列，
  // 用 join 會把團次列複製成多筆，分頁與排序都要跟著改寫。
  const assignments = await readAssignments(t.supabase, t.tenantId, rows.map((r) => r.id));
  return ok(rows.map((r) => ({ ...mapTripDeparture(r), ...assignments.get(r.id) })));
});

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = departureCreateSchema.parse(await req.json());
  if (!await findTripPlan(t, id, body.planId)) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const status = body.status ?? 'OPEN';
  const startTime = body.startTime ? body.startTime : null;

  // 0/1/2+ 自動適應 → 同租戶驗證 → 撞班驗證。三步都在寫入之前，避免留下
  // 「團次建好了但指派失敗」的半成品（issue #37 §3 明文禁止未指派半成品）。
  const bookable = await bookableStaffIds(t.supabase, t.tenantId);
  const assignment = resolveAssignment({
    requested: { primaryStaffId: body.primaryStaffId, assistantStaffIds: body.assistantStaffIds },
    bookable,
    status,
  });
  assertStaffBelongsToTenant(assignment, bookable);

  const slot = await departureSlot(t.supabase, t.tenantId, id, body.departsOn, startTime);
  const conflicts = await checkAssignmentConflicts(
    t.supabase, t.tenantId, assignment, slot, slot.shiftDate,
  );
  // ⚠️ 衝突細節寫進 message 而不是另加一個欄位：`request()` 的失敗信封只有
  // { success, message, code }（CLAUDE.md 硬規則），多塞的欄位前端根本讀不到。
  // §5.1 要的是「說明衝突來源與時間，不只回 409」——一句能讀的話就滿足它。
  if (conflicts.length > 0) {
    return fail(409, `無法指派：${describeConflicts(conflicts)}`, ERR.CONFLICT);
  }

  const { data, error } = await t.supabase.from('trip_departures').insert({
    tenant_id: t.tenantId,
    trip_id: id,
    plan_id: body.planId,
    departs_on: body.departsOn,
    start_time: timeValue(body.startTime),
    capacity: body.capacity,
    status,
    note: body.note ?? '',
  }).select('*, trip_plans(name)').single();
  if (error?.code === '23505') return fail(409, '相同方案、日期與時間的團次已存在', ERR.CONFLICT);
  if (error) throw error;

  await writeAssignment(t.supabase, t.tenantId, data.id, assignment);
  const assignments = await readAssignments(t.supabase, t.tenantId, [data.id]);
  return ok({ ...mapTripDeparture(data), ...assignments.get(data.id) });
});
