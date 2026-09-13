import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripDeparture } from '@/server/mappers';
import { departureUpdateSchema, timeValue } from '@/server/tour-domain';
import {
  assertStaffBelongsToTenant, bookableStaffIds, checkAssignmentConflicts, departureSlot,
  describeConflicts, readAssignments, resolveAssignment, writeAssignment,
} from '@/server/departure-staff';

type Context = { params: Promise<{ id: string }> };

export const PUT = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = departureUpdateSchema.parse(await req.json());
  const { data: current, error: readError } = await t.supabase.from('trip_departures').select('*')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  if (body.capacity !== undefined && body.capacity < current.seats_booked) {
    return fail(409, `名額不得少於已報名人數（${current.seats_booked} 人）`, ERR.CONFLICT);
  }
  if (body.planId !== undefined) {
    const { data: plan, error } = await t.supabase.from('trip_plans').select('id, trip_id')
      .eq('tenant_id', t.tenantId).eq('id', body.planId).maybeSingle();
    if (error) throw error;
    if (!plan || plan.trip_id !== current.trip_id) return fail(404, '找不到此方案', ERR.NOT_FOUND);
  }
  const patch: Record<string, unknown> = {};
  if (body.planId !== undefined) patch.plan_id = body.planId;
  if (body.departsOn !== undefined) patch.departs_on = body.departsOn;
  if (body.startTime !== undefined) patch.start_time = timeValue(body.startTime);
  if (body.capacity !== undefined) patch.capacity = body.capacity;
  if (body.status !== undefined) patch.status = body.status;
  if (body.note !== undefined) patch.note = body.note;
  /* ---------------- issue #37：導遊指派與撞班驗證 ----------------
   *
   * ⚠️ 這裡讀的是**更新後**的日期／時間／狀態，不是資料庫裡的舊值：改團日期時，
   * 要驗的是新日期上有沒有撞班。用舊值驗會讓「把團從沒撞的那天改到撞班那天」
   * 整個檢查形同虛設。
   *
   * ⚠️ `excludeDepartureId` 不可省：不排除自己的話，任何一次「只改名額」的儲存
   * 都會被這團自己既有的指派擋下來，店家會看到一個他完全無法理解的 409。
   */
  const nextStatus = (body.status ?? current.status) as 'OPEN' | 'CLOSED' | 'CANCELLED';
  const nextDate = body.departsOn ?? current.departs_on;
  const nextTime = body.startTime !== undefined
    ? (body.startTime ? body.startTime : null)
    : (current.start_time == null ? null : String(current.start_time).slice(0, 5));

  const existingMap = await readAssignments(t.supabase, t.tenantId, [id]);
  const existing = existingMap.get(id) ?? { primaryStaffId: null, assistantStaffIds: [] };
  const bookable = await bookableStaffIds(t.supabase, t.tenantId);

  const assignment = resolveAssignment({
    requested: { primaryStaffId: body.primaryStaffId, assistantStaffIds: body.assistantStaffIds },
    bookable,
    status: nextStatus,
    existing: { primaryStaffId: existing.primaryStaffId, assistantStaffIds: existing.assistantStaffIds },
  });
  assertStaffBelongsToTenant(assignment, bookable);

  const slot = await departureSlot(t.supabase, t.tenantId, current.trip_id, nextDate, nextTime);
  const conflicts = nextStatus === 'CANCELLED'
    ? [] // 取消的團次釋放時間（§5.3），不必也不該再驗撞班
    : await checkAssignmentConflicts(t.supabase, t.tenantId, assignment, slot, slot.shiftDate,
      { excludeDepartureId: id });
  if (conflicts.length > 0) {
    return fail(409, `無法指派：${describeConflicts(conflicts)}`, ERR.CONFLICT);
  }

  /**
   * ⚠️ `patch` 可能是**空的**——一個只改導遊指派的請求（`{ primaryStaffId }`）不會
   * 產生任何 `trip_departures` 的欄位變更，因為指派存在另一張表。
   *
   * PostgREST 對「沒有任何欄位」的 update 不會更新任何列，於是 `maybeSingle()` 回
   * null，下面那行就把它當成「找不到此團次」回 404——**改派導遊這個本 PR 最主要的
   * 新操作，會 100% 失敗**。單元測試看不到這件事（它不碰 HTTP 與 PostgREST），
   * 是整合測試抓到的。
   *
   * 所以沒有欄位要改時就不要送那一次 update，直接把現況讀回來。
   */
  const { data, error } = Object.keys(patch).length === 0
    ? await t.supabase.from('trip_departures').select('*, trip_plans(name)')
      .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle()
    : await t.supabase.from('trip_departures').update(patch)
      .eq('tenant_id', t.tenantId).eq('id', id).select('*, trip_plans(name)').maybeSingle();
  if (error?.code === '23505') return fail(409, '相同方案、日期與時間的團次已存在', ERR.CONFLICT);
  if (error) throw error;
  if (!data) return fail(404, '找不到此團次', ERR.NOT_FOUND);

  await writeAssignment(t.supabase, t.tenantId, id, assignment);
  const assignments = await readAssignments(t.supabase, t.tenantId, [id]);
  return ok({ ...mapTripDeparture(data), ...assignments.get(id) });
});

/**
 * 團次刪除。
 *
 * 這支端點原本刻意留白（註解寫著「order-aware departure deletion belongs to #8-B」），
 * 但頁面上的刪除鍵並沒有跟著停用——它只是 `setDepartures(filter)` 再報「團次已刪除」，
 * 店家重新整理團次就回來了。留著一顆假成功比缺一支端點更糟，所以這一輪把它補上。
 *
 * 它**不需要** `tour_orders`：`seats_booked` 是 `reserve_seats` 維護的權威計數器，
 * 同一支路由的 PUT 早就拿它當不變量用（`body.capacity < current.seats_booked` → 409）。
 * 這裡沿用同一個判準——已經有人報名的團次不得刪除，回 409 而不是靜默把名額吃掉。
 * `tour_orders` 落地後（#8-B）可以在此之上再加「連帶處理已存在訂單」的規則，
 * 但那是擴充，不是推翻：seats_booked > 0 不能刪，兩個階段都成立。
 */
export const DELETE = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const { data: current, error: readError } = await t.supabase.from('trip_departures')
    .select('id, seats_booked').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  if (current.seats_booked > 0) {
    return fail(409, `已有 ${current.seats_booked} 人報名，無法刪除此團次`, ERR.CONFLICT);
  }
  const { data, error } = await t.supabase.from('trip_departures').delete()
    .eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  return ok({ deleted: true });
});
