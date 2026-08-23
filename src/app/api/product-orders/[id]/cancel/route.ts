// 商品訂單狀態機（B-3）：PENDING/CONFIRMED → CANCELLED，並回補庫存。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  // 條件式 update（同 bookings cancel）：拿不到列＝狀態已變 → 409。
  // 同時把 order_no 帶回來給 inventory_logs 的 reason 用。
  const { data: order, error } = await t.supabase.from('product_orders')
    .update({ status: 'CANCELLED' })
    .eq('id', id).eq('tenant_id', t.tenantId).in('status', ['PENDING', 'CONFIRMED'])
    .select('id, order_no').maybeSingle();
  if (error) throw error;
  if (!order) throw new ApiHttpError(409, '此訂單狀態已變更，請重新整理', ERR.CONFLICT);

  // 回補庫存＋寫 log。取消動作本身已成立（上面 CAS-style update 保證只執行一次，
  // 不會重複回補）；回補是附加效果，失敗只 log 不 500（同 bookings complete 累點
  // 的錯誤處理原則）。每項用 CAS（.eq('stock', 舊值)）重試 3 次，防止與其他
  // 庫存操作併發時寫壞 stock_after。
  try {
    const { data: items, error: iErr } = await t.supabase
      .from('product_order_items')
      .select('product_id, quantity')
      .eq('order_id', order.id).eq('tenant_id', t.tenantId);
    if (iErr) throw iErr;

    for (const it of items ?? []) {
      let restocked = false;
      for (let attempt = 0; attempt < 3 && !restocked; attempt++) {
        const { data: cur, error: rErr } = await t.supabase
          .from('products').select('stock')
          .eq('id', it.product_id).eq('tenant_id', t.tenantId).maybeSingle();
        if (rErr) throw rErr;
        if (!cur) break; // 商品已被真刪 → 無庫存可回補

        const after = cur.stock + it.quantity;
        const { data: updated, error: uErr } = await t.supabase
          .from('products').update({ stock: after })
          .eq('id', it.product_id).eq('tenant_id', t.tenantId).eq('stock', cur.stock) // CAS
          .select('id').maybeSingle();
        if (uErr) throw uErr;
        if (!updated) continue;

        const { error: lErr } = await t.supabase.from('inventory_logs').insert({
          tenant_id: t.tenantId, product_id: it.product_id,
          delta: it.quantity, reason: `ORDER_CANCELLED:訂單 ${order.order_no}`, stock_after: after,
        });
        if (lErr) throw lErr;
        restocked = true;
      }
      if (!restocked)
        console.error('[api] product-orders cancel: restock failed', order.id, it.product_id);
    }
  } catch (e) {
    console.error('[api] product-orders cancel: restock failed', order.id, e);
  }

  return ok();
});
