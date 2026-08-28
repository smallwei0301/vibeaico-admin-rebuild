import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripDeparture } from '@/server/mappers';
import { throwAvailabilityRpcError } from '@/server/availability-rpc';

type Ctx = { params: Promise<{ id: string }> };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const updateSchema = z.object({
  departsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '請選擇出團日期').optional(),
  startTime: z.string().refine((v) => v === '' || TIME_RE.test(v), '出發時間格式錯誤').optional(),
  capacity: z.number().int('名額必須為整數').min(1, '名額必須大於 0').optional(),
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
  note: z.string().optional(),
  primaryStaffId: z.string().uuid().nullable().optional(),
  assistantStaffIds: z.array(z.string().uuid()).optional(),
});

/**
 * PUT /api/trip-departures/[id] — 更新團次 ⚙M（10 分冊 §5）。
 *
 * **capacity 調低不得小於 seats_booked → 409**（10 分冊 §5 明列）。
 * 這一條在 DB 也有 check 約束（0026 `trip_departures_seats_within_capacity`），
 * 但 check 觸發時只會回一句 Postgres 原文，導遊看不懂——所以這裡先讀現值
 * 明確擋下並回一句人話。DB 那條是最後防線，不是這裡可以省略的理由。
 *
 * `seatsBooked` 一律不接受客戶端寫入（10 分冊 §2：名額只能經 rpc 變動）。
 */
export const PUT = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const b = updateSchema.parse(await req.json());

  const { data: cur, error: rerr } = await t.supabase
    .from('trip_departures').select('id, seats_booked, capacity, departs_on, start_time, status, plan_id, note')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (rerr) throw rerr;
  if (!cur) return fail(404, '找不到此團次', ERR.NOT_FOUND);

  if (b.capacity !== undefined && b.capacity < cur.seats_booked)
    return fail(409, `名額不得少於已報名人數（${cur.seats_booked} 人）`, ERR.CONFLICT);

  const { data: savedId, error: rpcError } = await t.supabase.rpc('save_trip_departure_with_staff', {
    p_tenant: t.tenantId, p_trip_id: null, p_plan_id: cur.plan_id, p_departure_id: id,
    p_departs_on: b.departsOn ?? cur.departs_on,
    p_start_time: b.startTime === undefined ? cur.start_time : (b.startTime || null),
    p_capacity: b.capacity ?? cur.capacity,
    p_status: b.status ?? cur.status, p_note: b.note ?? cur.note,
    p_primary_staff_id: b.primaryStaffId ?? null,
    p_assistant_staff_ids: b.assistantStaffIds ?? null,
  });
  if (rpcError) throwAvailabilityRpcError(rpcError);
  const { data, error } = await t.supabase.from('trip_departures')
    .select('*, trip_plans(name), trip_departure_staff(staff_id, role, staff(name))')
    .eq('tenant_id', t.tenantId).eq('id', savedId).maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  return ok(mapTripDeparture(data));
});

/**
 * DELETE /api/trip-departures/[id] — 刪除團次 ⚙M。
 *
 * 只要有**任何一筆**訂單掛在這個團次上就不刪（含已取消的）：
 * `tour_orders.departure_id` 是 `on delete restrict`（0026），刪掉團次等於
 * 要把那些訂單一起銷毀，而已取消的訂單仍是要保留的營運紀錄。
 * 想讓團次停止收客請改成 CANCELLED（PUT status）——那是另一個語意：
 * 取消保留報名紀錄，刪除不保留。
 */
export const DELETE = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  const { count, error: cerr } = await t.supabase
    .from('tour_orders').select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId).eq('departure_id', id);
  if (cerr) throw cerr;
  if ((count ?? 0) > 0)
    return fail(409, `此團次已有 ${count} 筆訂單，無法刪除；請改為取消團次`, ERR.CONFLICT);

  const { data, error } = await t.supabase.from('trip_departures')
    .delete().eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  // 23503：上面的計數與刪除之間有人剛好建了訂單（TOCTOU），仍回 409 而非 500
  if (error?.code === '23503')
    return fail(409, '此團次已有訂單，無法刪除；請改為取消團次', ERR.CONFLICT);
  if (error) throw error;
  if (!data) return fail(404, '找不到此團次', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
