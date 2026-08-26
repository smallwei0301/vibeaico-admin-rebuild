import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/trips/[id]/unpublish — PUBLISHED → DRAFT（10 分冊 §5）⚙M。
 *
 * 與 publish 一樣只動 `status`，不碰 `midao_listing`：下架商店頁不等於
 * 撤回 Midao 上架申請（那是 Midao 管理員那邊的事，11 分冊 §4.2）。
 */
export const POST = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  const { data, error } = await t.supabase.from('trips')
    .update({ status: 'DRAFT', updated_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId).eq('id', id).eq('status', 'PUBLISHED')
    .select('*').maybeSingle();
  if (error) throw error;

  if (!data) {
    // 分辨「不存在」與「本來就不是 PUBLISHED」——前者 404、後者 409，
    // 不要把兩件事併成同一個訊息（使用者看到的原因完全不同）。
    const { data: exists } = await t.supabase
      .from('trips').select('status').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
    if (!exists) return fail(404, '找不到此行程', ERR.NOT_FOUND);
    return fail(409, '此行程目前不是已上架狀態', ERR.CONFLICT);
  }

  return ok(mapTrip(data));
});
