import { z } from 'zod';
import { ApiHttpError, handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripPlan } from '@/server/mappers';
import { planAdminFields, planRowFromImport } from '@/server/trip-payload';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/trips/[id]/plans — 該行程的方案，sort_order asc。 */
export const GET = handle(async (_req, ctx: Ctx) => {
  const { id } = await (ctx.params);
  const t = await requireTenant();

  const { data, error } = await t.supabase.from('trip_plans').select('*')
    .eq('tenant_id', t.tenantId).eq('trip_id', id)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok((data ?? []).map(mapTripPlan));
});

/**
 * POST /api/trips/[id]/plans — 新增方案 ⚙M。
 *
 * body 直接吃 tour-platform 的 activityPlans[] 單筆形狀（小寫 enum、
 * planItinerary 等），交給 planRowFromImport 轉換——這樣「手動新增」與
 * 「JSON 匯入」走同一條轉換路徑，欄位對照只有一份，不會漂移。
 */
const planSchema = z.object({ name: z.string().min(1, '請輸入方案名稱') }).passthrough();

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await (ctx.params);
  const t = await requireTenant('MANAGER');
  const b = planSchema.parse(await req.json());

  // 先確認行程屬於本租戶，否則等於允許往別人的行程掛方案
  const { data: trip, error: terr } = await t.supabase.from('trips')
    .select('id, midao_listing').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (terr) throw terr;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const { count } = await t.supabase.from('trip_plans')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId).eq('trip_id', id);

  const { data, error } = await t.supabase.from('trip_plans')
    .insert({
      ...planRowFromImport(b, t.tenantId, id, count ?? 0),
      ...planAdminFields(b),
      // 已在 Midao 前台上架的行程，方案異動需重新送審（10/11 分冊）。
      // 頁面的成功訊息本來就寫「方案已儲存並送出審核」——這一行是讓那句話成真。
      // 審核端點在 Midao 那邊（11 分冊 §4.2，Phase 10），這裡只寫狀態。
      review_state: trip.midao_listing === 'LISTED' ? 'PENDING' : 'NONE',
    })
    .select('*').single();
  // `trip_plan_limit_guard` is the authoritative, transaction-safe check.
  // The earlier count only supplies a stable default sort order; concurrent
  // requests can both observe 99, so never use it as the admission decision.
  if (error?.code === 'P0001' && error.message.includes('TRIP_PLAN_LIMIT')) {
    throw new ApiHttpError(409, '每個行程最多 100 個方案', ERR.CONFLICT);
  }
  if (error) throw error;

  return ok(mapTripPlan(data));
});
