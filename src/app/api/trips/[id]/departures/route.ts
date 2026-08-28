import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripDeparture } from '@/server/mappers';
import { throwAvailabilityRpcError } from '@/server/availability-rpc';

type Ctx = { params: Promise<{ id: string }> };

/** `HH:MM` 或 `HH:MM:SS`；空字串代表「未指定時間」（10 分冊 §5.5：整日忙碌）。 */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * GET /api/trips/[id]/departures — 該行程的所有團次（10 分冊 §5）。
 *
 * join `trip_plans(name)` 帶回 `planName`：團次表格每一列都要顯示方案名，
 * 分兩支查再在前端配對只會多一輪 loading，且配錯的風險由前端承擔。
 */
export const GET = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant();

  const { data: trip, error: terr } = await t.supabase
    .from('trips').select('id').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (terr) throw terr;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const { data, error } = await t.supabase
    .from('trip_departures')
    .select('*, trip_plans(name), trip_departure_staff(staff_id, role, staff(name))')
    .eq('tenant_id', t.tenantId).eq('trip_id', id)
    .order('departs_on', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true });
  if (error) throw error;

  return ok((data ?? []).map(mapTripDeparture));
});

const createSchema = z.object({
  planId: z.string().uuid('請選擇方案'),
  departsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '請選擇出團日期'),
  startTime: z.string().refine((v) => v === '' || TIME_RE.test(v), '出發時間格式錯誤').optional(),
  capacity: z.number().int('名額必須為整數').min(1, '名額必須大於 0'),
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
  note: z.string().optional(),
  primaryStaffId: z.string().uuid().nullable().optional(),
  assistantStaffIds: z.array(z.string().uuid()).optional(),
});

/**
 * POST /api/trips/[id]/departures — 建立單一團次 ⚙M。
 *
 * `seats_booked` 一律由 DB 預設值 0 起算、之後只能經 reserve_seats/release_seats
 * 變動（10 分冊 §2「禁止在應用層算庫存」）——所以這裡刻意**不接受**客戶端
 * 送來的 seatsBooked。
 */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  // 方案必須屬於同一租戶的同一個行程，否則會建出一個掛錯行程的團次
  const { data: plan, error: perr } = await t.supabase
    .from('trip_plans').select('id, trip_id')
    .eq('tenant_id', t.tenantId).eq('id', b.planId).maybeSingle();
  if (perr) throw perr;
  if (!plan || plan.trip_id !== id) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const { data: departureId, error: rpcError } = await t.supabase.rpc('save_trip_departure_with_staff', {
    p_tenant: t.tenantId, p_trip_id: id, p_plan_id: b.planId, p_departure_id: null,
    p_departs_on: b.departsOn, p_start_time: b.startTime || null, p_capacity: b.capacity,
    p_status: b.status ?? 'OPEN', p_note: b.note ?? '',
    p_primary_staff_id: b.primaryStaffId ?? null,
    p_assistant_staff_ids: b.assistantStaffIds ?? null,
  });
  if (rpcError) throwAvailabilityRpcError(rpcError);

  const { data, error } = await t.supabase.from('trip_departures')
    .select('*, trip_plans(name), trip_departure_staff(staff_id, role, staff(name))')
    .eq('tenant_id', t.tenantId).eq('id', departureId).maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  return ok(mapTripDeparture(data));
});
