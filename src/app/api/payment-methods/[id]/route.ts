import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { paymentMethodBodySchema } from '@/server/payment-methods';

/**
 * /api/payment-methods/:id — 單筆收款方式的更新與刪除（issue #9）
 *
 * ⚠️ 每一次查詢都帶 `tenant_id`。RLS（`is_tenant_member(tenant_id)`）已經是一道
 * 防線，但這裡不靠它單獨成立：`requireTenant()` 回的 client 若哪天換成 service
 * role，RLS 就整個消失，而這一行還在。
 */

const patchSchema = paymentMethodBodySchema.partial();

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = patchSchema.parse(await req.json());

  const patch: Record<string, unknown> = {};
  if (b.methodType !== undefined) patch.method_type = b.methodType;
  if (b.displayName !== undefined) patch.display_name = b.displayName;
  if (b.qrImageUrl !== undefined) patch.qr_image_url = b.qrImageUrl;
  if (b.config !== undefined) patch.config = b.config;
  if (b.active !== undefined) patch.active = b.active;
  if (b.sortOrder !== undefined) patch.sort_order = b.sortOrder;

  /*
   * ⚠️ 空 patch 不能就這樣送出去。PostgREST 對空的 update 會影響 0 列，於是
   * `maybeSingle()` 回 null，我們就把「沒有任何欄位要改」誤判成「查無此資源」
   * 而回 404——那正是 #294 在 `PUT /api/trip-departures/:id` 上踩過的同一個坑
   * （改派導遊 100% 失敗，而單元測試看不到，因為它沒有真的 PostgREST）。
   */
  if (Object.keys(patch).length === 0) {
    const { data, error } = await t.supabase
      .from('tenant_payment_methods')
      .select('id')
      .eq('tenant_id', t.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此收款方式', ERR.NOT_FOUND);
    return ok({ updated: true });
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await t.supabase
    .from('tenant_payment_methods')
    .update(patch)
    .eq('tenant_id', t.tenantId)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此收款方式', ERR.NOT_FOUND);

  return ok({ updated: true });
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  /*
   * ⚠️ tour_orders.payment_method_id 沒有 FK／快照：實體刪除會讓歷史訂單失去收款方式標籤（#873）。
   * 已被本店訂單引用者拒絕刪除，改走停用（active=false）；停用不影響既有標籤。
   */
  const { count, error: refErr } = await t.supabase
    .from('tour_orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId)
    .eq('payment_method_id', id);
  if (refErr) throw refErr;
  if ((count ?? 0) > 0) {
    throw new ApiHttpError(409, '已有訂單使用此收款方式，請改為停用', ERR.CONFLICT);
  }

  const { data, error } = await t.supabase
    .from('tenant_payment_methods')
    .delete()
    .eq('tenant_id', t.tenantId)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此收款方式', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
