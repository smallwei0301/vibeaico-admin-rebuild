import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripDeparture } from '@/server/mappers';
import { throwAvailabilityRpcError } from '@/server/availability-rpc';

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
    .from('trip_plans').select('id, trip_id')
    .eq('tenant_id', t.tenantId).eq('id', b.planId).maybeSingle();
  if (perr) throw perr;
  if (!plan || plan.trip_id !== id) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const { data: rpcData, error: rpcError } = await t.supabase.rpc('create_trip_departures_batch_with_staff', {
    p_tenant: t.tenantId, p_trip_id: id, p_plan_id: b.planId, p_from: b.from, p_to: b.to,
    p_weekdays: b.weekdays, p_start_time: b.startTime || null, p_capacity: b.capacity,
    p_primary_staff_id: b.primaryStaffId ?? null, p_assistant_staff_ids: b.assistantStaffIds ?? null,
  });
  if (rpcError) throwAvailabilityRpcError(rpcError);
  const result = rpcData as { createdIds?: string[]; skipped?: number; conflicts?: Array<{ date: string; staffId: string; staffName: string; reason: string }> };
  const createdIds = result.createdIds ?? [];
  const { data, error } = createdIds.length === 0
    ? { data: [], error: null }
    : await t.supabase.from('trip_departures')
      .select('*, trip_plans(name), trip_departure_staff(staff_id, role, staff(name))')
      .eq('tenant_id', t.tenantId).in('id', createdIds);
  if (error) throw error;
  return ok({
    created: data?.length ?? 0,
    skipped: result.skipped ?? 0,
    conflicts: result.conflicts ?? [],
    departures: (data ?? []).map(mapTripDeparture),
  });
});
