import { z } from 'zod';
import { handle, ok, fail, ERR, ApiHttpError } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripDeparture } from '@/server/mappers';
import { replaceDepartureAssignments, resolveOpenDepartureAssignments } from '@/server/departure-staff';

type Ctx = { params: Promise<{ id: string }> };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const batchSchema = z.object({
  planId: z.string().uuid('請選擇方案'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '請選擇起始日期'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '請選擇結束日期'),
  // 0 = 週日 … 6 = 週六（與 JS Date#getDay 一致，前端的 WEEKDAYS 常數同源）
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, '請至少選一個星期'),
  startTime: z.string().refine((v) => v === '' || TIME_RE.test(v), '出發時間格式錯誤').optional(),
  capacity: z.number().int('名額必須為整數').min(1, '名額必須大於 0'),
  primaryStaffId: z.string().uuid().nullable().optional(),
  assistantStaffIds: z.array(z.string().uuid()).optional(),
});

/** 上限：一次批次最多開 366 天（一年），避免一個打錯的日期區間寫爆整張表。 */
const MAX_DAYS = 366;

/**
 * POST /api/trips/[id]/departures/batch — 批次開團（10 分冊 §5「支援批次建整月」）⚙M。
 *
 * 展開日期是**後端**的事（`services/tours.ts` 的 batchCreateDepartures 只送
 * from/to/weekdays），前端算出來的預覽數字只是預覽。
 *
 * 重複的日期（同方案同日同時間已有團次）**跳過而不是整批失敗**：導遊常在
 * 既有團次上再補幾天，整批 409 會逼他先手動找出哪幾天已存在。回應帶
 * `created` / `skipped` 兩個數字，畫面照實顯示。
 */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const b = batchSchema.parse(await req.json());

  const from = new Date(`${b.from}T00:00:00Z`);
  const to = new Date(`${b.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return fail(400, '日期格式錯誤', ERR.VALIDATION);
  if (to < from) return fail(400, '結束日期不得早於起始日期', ERR.VALIDATION);
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (spanDays > MAX_DAYS) return fail(400, `批次開團最多一次 ${MAX_DAYS} 天`, ERR.VALIDATION);

  const { data: plan, error: perr } = await t.supabase
    .from('trip_plans').select('id, trip_id, duration_minutes')
    .eq('tenant_id', t.tenantId).eq('id', b.planId).maybeSingle();
  if (perr) throw perr;
  if (!plan || plan.trip_id !== id) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const startTime = b.startTime ? b.startTime : null;
  const wanted: string[] = [];
  for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (b.weekdays.includes(d.getUTCDay())) wanted.push(d.toISOString().slice(0, 10));
  }
  if (wanted.length === 0) return ok({ created: 0, skipped: 0, departures: [] });

  // 先查已存在的日期，才能回報「跳過幾筆」——靠 insert 的 23505 只會知道
  // 「有撞到」，不會知道撞了幾筆。
  const existingQuery = t.supabase
    .from('trip_departures').select('departs_on')
    .eq('tenant_id', t.tenantId).eq('plan_id', b.planId).in('departs_on', wanted);
  const { data: existing, error: eerr } = startTime === null
    ? await existingQuery.is('start_time', null)
    : await existingQuery.eq('start_time', startTime);
  if (eerr) throw eerr;

  const taken = new Set((existing ?? []).map((r: any) => r.departs_on));
  const conflicts: Array<{ date: string; staffId: string; staffName: string; reason: string }> = [];
  const rows: Array<Record<string, unknown>> = [];
  const assignmentByDate = new Map<string, Awaited<ReturnType<typeof resolveOpenDepartureAssignments>>>();
  for (const date of wanted.filter((candidate) => !taken.has(candidate))) {
    try {
      const assignments = await resolveOpenDepartureAssignments({
        supabase: t.supabase, tenantId: t.tenantId, departsOn: date,
        startTime, durationMinutes: Number(plan.duration_minutes),
        primaryStaffId: b.primaryStaffId, assistantStaffIds: b.assistantStaffIds,
      });
      assignmentByDate.set(date, assignments);
      rows.push({
        tenant_id: t.tenantId, trip_id: id, plan_id: b.planId, departs_on: date,
        start_time: startTime, capacity: b.capacity, status: 'OPEN', note: '',
      });
    } catch (error) {
      if (!(error instanceof ApiHttpError)) throw error;
      conflicts.push({ date, staffId: '', staffName: '', reason: error.message });
    }
  }

  if (rows.length === 0) return ok({ created: 0, skipped: wanted.length, conflicts, departures: [] });

  const { data, error } = await t.supabase
    .from('trip_departures').insert(rows).select('*, trip_plans(name)');
  if (error) throw error;

  try {
    for (const departure of data ?? []) {
      await replaceDepartureAssignments(
        t.supabase, t.tenantId, departure.id,
        assignmentByDate.get(departure.departs_on) ?? [],
      );
    }
  } catch (assignmentError) {
    // The migration's FK/RLS is the last safety net; remove only this request's
    // newly-created rows instead of reporting a successful but unassigned batch.
    await t.supabase.from('trip_departures').delete().eq('tenant_id', t.tenantId)
      .in('id', (data ?? []).map((departure: any) => departure.id));
    throw assignmentError;
  }

  return ok({
    created: data?.length ?? 0,
    skipped: wanted.length - (data?.length ?? 0),
    conflicts,
    departures: (data ?? []).map(mapTripDeparture),
  });
});
