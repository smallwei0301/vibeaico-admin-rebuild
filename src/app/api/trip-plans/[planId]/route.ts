import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripPlan } from '@/server/mappers';
import { planAdminFields, planRowFromImport } from '@/server/trip-payload';

type Ctx = { params: Promise<{ planId: string }> };

/**
 * 方案的更新／刪除。
 *
 * 路徑刻意是**扁平**的 /api/trip-plans/[planId] 而非掛在行程底下：
 * src/services/tours.ts 的 deleteTripPlan(planId) 只拿得到 planId，
 * 契約既已如此，端點就配合它（planId 本身唯一，加上 tenant_id 過濾就足夠隔離，
 * 不需要 tripId 才能定位）。
 */
const planSchema = z.object({ name: z.string().min(1, '請輸入方案名稱') }).passthrough();

export const PUT = handle(async (req, ctx: Ctx) => {
  const { planId } = await (ctx.params);
  const t = await requireTenant('MANAGER');
  const b = planSchema.parse(await req.json());

  const { data: existing, error: eerr } = await t.supabase.from('trip_plans')
    .select('trip_id, sort_order').eq('tenant_id', t.tenantId).eq('id', planId).maybeSingle();
  if (eerr) throw eerr;
  if (!existing) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  // 整筆覆蓋語意：方案編輯畫面本來就是一次送出完整表單，逐欄位 patch 會讓
  // 「清空某個陣列」變成無法表達的操作。tenant_id / trip_id 不由 body 決定，
  // 避免方案被搬到別人的行程底下。
  const row = planRowFromImport(b, t.tenantId, existing.trip_id, existing.sort_order ?? 0);
  const { tenant_id: _t, trip_id: _tr, ...patch } = row;

  // 已在 Midao 前台上架的行程，方案異動需重新送審（見 POST /api/trips/:id/plans
  // 的同一段註解）。頁面的「方案已儲存並送出審核」靠這一行成真。
  const { data: trip } = await t.supabase.from('trips')
    .select('midao_listing').eq('tenant_id', t.tenantId).eq('id', existing.trip_id).maybeSingle();
  const reviewPatch = trip?.midao_listing === 'LISTED' ? { review_state: 'PENDING' } : {};

  const { data, error } = await t.supabase.from('trip_plans')
    .update({
      ...patch,
      ...planAdminFields(b),
      ...reviewPatch,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', t.tenantId).eq('id', planId).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  return ok(mapTripPlan(data));
});

/**
 * DELETE /api/trip-plans/[planId] ⚙M。
 *
 * 有訂單的方案不刪（`tour_orders.plan_id` 是 on delete restrict，
 * migration 0026）；團次則由 `trip_departures.plan_id` 的 cascade 一併移除。
 * 沒有這個防護的話會撞外鍵回 500，畫面只能顯示「系統發生錯誤」。
 */
export const DELETE = handle(async (_req, ctx: Ctx) => {
  const { planId } = await (ctx.params);
  const t = await requireTenant('MANAGER');

  const { count, error: cerr } = await t.supabase
    .from('tour_orders').select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId).eq('plan_id', planId);
  if (cerr) throw cerr;
  if ((count ?? 0) > 0)
    return fail(409, `此方案已有 ${count} 筆訂單，無法刪除；請改為停用此方案`, ERR.CONFLICT);

  const { data, error } = await t.supabase.from('trip_plans')
    .delete().eq('tenant_id', t.tenantId).eq('id', planId).select('id').maybeSingle();
  if (error?.code === '23503')
    return fail(409, '此方案已有訂單，無法刪除；請改為停用此方案', ERR.CONFLICT);
  if (error) throw error;
  if (!data) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
