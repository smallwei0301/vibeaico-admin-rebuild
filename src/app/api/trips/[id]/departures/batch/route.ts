import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripDeparture } from '@/server/mappers';
import { dateRange, dateRangeLength, departureBatchSchema, timeValue } from '@/server/tour-domain';
import {
  assertStaffBelongsToTenant, bookableStaffIds, readAssignments, resolveAssignment, staffNames,
  writeAssignment, type ResolvedAssignment,
} from '@/server/departure-staff';
import {
  CONFLICT_REASON_TEXT, departureInterval, findStaffConflicts, loadStaffLoad, taipeiDayStartMs,
} from '@/server/staff-availability';
import type { DepartureConflict } from '@/lib/types';

type Context = { params: Promise<{ id: string }> };
const MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = departureBatchSchema.parse(await req.json());
  const rangeLength = dateRangeLength(body.from, body.to);
  if (rangeLength > MAX_DAYS) return fail(400, `批次開團最多一次 ${MAX_DAYS} 天`, ERR.VALIDATION);
  const dates = dateRange(body.from, body.to);
  const { data: plan, error: planError } = await t.supabase.from('trip_plans').select('id, trip_id')
    .eq('tenant_id', t.tenantId).eq('id', body.planId).maybeSingle();
  if (planError) throw planError;
  if (!plan || plan.trip_id !== id) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const selected = dates.filter((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return body.weekdays.includes(day);
  });

  // batch 建立的團次一律 OPEN，所以 0 位導遊會在這裡就被擋下（不是逐日各擋一次）。
  const bookable = await bookableStaffIds(t.supabase, t.tenantId);
  const assignment: ResolvedAssignment = resolveAssignment({
    requested: { primaryStaffId: body.primaryStaffId, assistantStaffIds: body.assistantStaffIds },
    bookable,
    status: 'OPEN',
  });
  assertStaffBelongsToTenant(assignment, bookable);
  const assignedIds = [assignment.primaryStaffId, ...assignment.assistantStaffIds]
    .filter((v): v is string => !!v);

  /**
   * ⚠️ 整個日期範圍的負載**一次讀完**，然後逐日純函式判斷。
   *
   * 逐日各查一次 DB 在 366 天的上限下會是 366 趟來回；更糟的是，那樣讀到的是
   * 「查到那一天為止的狀態」，而本批次自己前面幾天剛建立的團次不在裡面——同一次
   * 批次開團就能讓同一位導遊在同一天被排兩團。所以本批次自己建立的團次也要
   * 即時累加回負載裡（見下方 `load.departures.push`）。
   */
  const { data: tripRow, error: tripError } = await t.supabase.from('trips')
    .select('duration_hours').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (tripError) throw tripError;
  const durationHours = tripRow?.duration_hours ?? null;
  const startTime = body.startTime ? body.startTime : null;

  const load = selected.length > 0 && assignedIds.length > 0
    ? await loadStaffLoad(
      t.supabase, t.tenantId,
      taipeiDayStartMs(selected[0]),
      taipeiDayStartMs(selected[selected.length - 1]) + DAY_MS,
    )
    : null;
  const names = await staffNames(t.supabase, t.tenantId, assignedIds);

  const createdIds: string[] = [];
  const conflicts: DepartureConflict[] = [];
  let skipped = 0;

  for (const date of selected) {
    // 撞班先判：一個「因為撞班而跳過」的日期不該先去 DB 查重複。
    if (load) {
      const slot = departureInterval({ departsOn: date, startTime, durationHours });
      const dayConflicts = findStaffConflicts(assignedIds, slot, date, load);
      if (dayConflicts.length > 0) {
        skipped += 1;
        for (const c of dayConflicts) {
          conflicts.push({
            date,
            staffId: c.staffId,
            staffName: names.get(c.staffId) ?? '',
            reason: c.reason,
            text: CONFLICT_REASON_TEXT[c.reason],
            conflictStart: c.conflictStart,
            conflictEnd: c.conflictEnd,
            departureId: c.departureId,
          });
        }
        continue;
      }
    }

    let existingQuery = t.supabase.from('trip_departures').select('id')
      .eq('tenant_id', t.tenantId).eq('plan_id', body.planId).eq('departs_on', date);
    existingQuery = body.startTime
      ? existingQuery.eq('start_time', timeValue(body.startTime))
      : existingQuery.is('start_time', null);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      skipped += 1;
      continue;
    }
    const { data, error } = await t.supabase.from('trip_departures').insert({
      tenant_id: t.tenantId, trip_id: id, plan_id: body.planId, departs_on: date,
      start_time: timeValue(body.startTime), capacity: body.capacity, status: 'OPEN', note: '',
    }).select('id').maybeSingle();
    if (error?.code === '23505') {
      skipped += 1;
      continue;
    }
    if (error) throw error;
    if (data) {
      createdIds.push(data.id);
      await writeAssignment(t.supabase, t.tenantId, data.id, assignment);
      // 本批次剛建立的團次立刻計入負載，後面的日期才擋得住同批次的自我重疊。
      if (load) {
        const slot = departureInterval({ departsOn: date, startTime, durationHours });
        for (const staffId of assignedIds) {
          load.departures.push({ departureId: data.id, staffId, start: slot.start, end: slot.end });
        }
      }
    }
  }

  const { data: rows, error } = createdIds.length === 0
    ? { data: [], error: null }
    : await t.supabase.from('trip_departures').select('*, trip_plans(name)')
      .eq('tenant_id', t.tenantId).in('id', createdIds);
  if (error) throw error;
  const assignments = await readAssignments(t.supabase, t.tenantId, createdIds);
  return ok({
    created: createdIds.length,
    skipped,
    conflicts,
    departures: (rows ?? []).map((r) => ({ ...mapTripDeparture(r), ...assignments.get(r.id) })),
  });
});
