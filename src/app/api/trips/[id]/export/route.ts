import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip, mapTripPlan } from '@/server/mappers';
import { toTourPlatformJson } from '@/server/trip-payload';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/trips/[id]/export — 匯出成 tour-platform 格式的行程 JSON。
 *
 * 刻意產出與 tour-platform `buildActivityExportTemplate()` 相同的鍵名與小寫
 * enum，因此這份檔案可以：
 *   - 原樣再匯回本後台（/api/trips/import），或
 *   - 拿去 tour-platform 匯入
 * 兩邊互通，管理者整理好的行程不必重打。
 *
 * 走一般信封（不像 CSV 匯出那樣直接回檔案）：前端拿到物件後自行
 * JSON.stringify + 下載，這樣錯誤情形仍能照 ApiResponse 呈現。
 */
export const GET = handle(async (_req, ctx: Ctx) => {
  const { id } = await (ctx.params);
  const t = await requireTenant();

  const { data: trip, error } = await t.supabase.from('trips')
    .select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const { data: plans, error: perr } = await t.supabase.from('trip_plans')
    .select('*').eq('tenant_id', t.tenantId).eq('trip_id', id)
    .order('sort_order', { ascending: true });
  if (perr) throw perr;

  return ok(toTourPlatformJson(mapTrip(trip), (plans ?? []).map(mapTripPlan)));
});
