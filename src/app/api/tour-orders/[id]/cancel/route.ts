import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { cancelTourOrderSchema } from '@/server/tour-domain';
import { hydrateTourOrders } from '@/server/tour-orders';

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/tour-orders/:id/cancel — 取消訂單並釋放名額（#8-B，10 分冊 §3）。
 *
 * 改狀態與釋放名額**同一交易**，由 `cancel_tour_order` rpc 負責。分開做的話，
 * 釋放成功但訂單沒改成 CANCELLED，逾期 cron 下一輪會再釋放一次同一筆——
 * 名額憑空多出來，店家會看到「明明客滿卻顯示還有位」。
 *
 * rpc 回 false 有兩種情況（都對映到 409／404）：找不到這筆單（回 404），
 * 或它已經是 CANCELLED／COMPLETED（終態，不重複釋放名額）。
 *
 * ⚠️ **已付款的單不自動退款**（10 分冊 §3：「已付款須人工退款」）。
 * 這裡只改狀態；`payment_status` 維持 PAID，讓導遊看得到「這筆要退錢」。
 * 自動把它改成 REFUNDED 會宣稱一件沒發生的事。
 */
export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  const body = cancelTourOrderSchema.parse(await req.json().catch(() => ({})));
  await requireFeature(t.tenantId, 'TOUR_MODULE');

  const { data: current, error: readError } = await t.supabase.from('tour_orders')
    .select('id, status').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此訂單', ERR.NOT_FOUND);

  const { data: released, error } = await t.supabase.rpc('cancel_tour_order', {
    p_tenant: t.tenantId, p_order: id, p_reason: body.reason ?? '',
  });
  if (error) throw error;
  if (released !== true) return fail(409, '此訂單狀態已變更', ERR.CONFLICT);

  const { data, error: afterError } = await t.supabase.from('tour_orders')
    .select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (afterError) throw afterError;
  if (!data) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [data]);
  return ok(order);
});
