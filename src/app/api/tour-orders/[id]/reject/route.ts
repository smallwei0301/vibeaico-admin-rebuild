import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { rejectTourRequestSchema } from '@/server/tour-domain';
import { hydrateTourOrders } from '@/server/tour-orders';

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/tour-orders/:id/reject — 導遊拒絕 REQUEST 訂單（#46，GUIDE 側）。
 *
 * 只對「還在等待導遊決定」的 REQUEST 申請生效（PENDING + `trip_plans.sales_mode
 * = 'REQUEST'`）。不重用通用的 `cancel_tour_order`：後者無條件 `release_seats`，
 * 而修好之後（`0111`）尚未被接受的 REQUEST 訂單根本沒鎖過名額——無條件釋放會
 * 憑空放出一個從未存在的名額。`reject_tour_request` 只在 `seats_reserved` 為真
 * （既有資料的既成事實）時才釋放，理由與 `0111` migration 的說明一致。
 *
 * rpc 回 false 對映到 409：這筆單不存在、已被接受、已被處理過，或根本不是
 * REQUEST 方案——都是「你按下去沒有發生你以為會發生的事」，不得靜默成功。
 */
export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  const body = rejectTourRequestSchema.parse(await req.json().catch(() => ({})));
  await requireFeature(t.tenantId, 'TOUR_MODULE');

  const { data: current, error: readError } = await t.supabase.from('tour_orders')
    .select('id').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此訂單', ERR.NOT_FOUND);

  const { data: rejected, error } = await t.supabase.rpc('reject_tour_request', {
    p_tenant: t.tenantId, p_order: id, p_reason: body.reason ?? '',
  });
  if (error) throw error;
  if (rejected !== true) {
    return fail(409, '此訂單目前無法拒絕（非待處理的先申請再確認訂單）', ERR.TOUR_REQUEST_NOT_ELIGIBLE);
  }

  const { data: updated, error: afterError } = await t.supabase.from('tour_orders')
    .select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (afterError) throw afterError;
  if (!updated) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [updated]);
  return ok(order);
});
