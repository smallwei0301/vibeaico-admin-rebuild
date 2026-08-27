import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTourOrder } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/tour-orders/[id] — 單筆旅遊訂單（10 分冊 §5）。
 * 跨租戶一律 404（不洩漏存在性，與 trips / customers 同慣例）。
 */
export const GET = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('tour_orders')
    .select('*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此訂單', ERR.NOT_FOUND);

  return ok(mapTourOrder(data));
});
