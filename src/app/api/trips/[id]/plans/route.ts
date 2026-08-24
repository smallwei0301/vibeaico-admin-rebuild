import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripPlan } from '@/server/mappers';
import { planRowFromImport } from '@/server/trip-payload';

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
    .select('id').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (terr) throw terr;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const { count } = await t.supabase.from('trip_plans')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId).eq('trip_id', id);

  const { data, error } = await t.supabase.from('trip_plans')
    .insert(planRowFromImport(b, t.tenantId, id, count ?? 0))
    .select('*').single();
  if (error) throw error;

  return ok(mapTripPlan(data));
});
