import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/trips/[id]/publish — DRAFT → PUBLISHED（10 分冊 §5）⚙M。
 *
 * **只影響 VibeAI 公開商店頁的可見性**，與 Midao 前台的 `midao_listing` 完全
 * 獨立（審核權在 Midao 管理員，11 分冊 §4.2）——所以這裡一個字都不碰
 * midao_listing。
 *
 * ARCHIVED 的行程不得直接上架：它是「有訂單所以不能刪」的墓碑狀態
 * （見 DELETE /api/trips/[id]），重新上架要先明確改回 DRAFT。
 */
export const POST = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  const { data: trip, error: rerr } = await t.supabase
    .from('trips').select('status').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (rerr) throw rerr;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  if (trip.status === 'ARCHIVED')
    return fail(409, '已封存的行程請先改回草稿再上架', ERR.CONFLICT);

  const { data, error } = await t.supabase.from('trips')
    .update({ status: 'PUBLISHED', updated_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  return ok(mapTrip(data));
});
