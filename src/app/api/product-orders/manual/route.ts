import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiTodayDateString } from '@/server/tz';
import {
  notifyProductOrderReceipt, type ProductOrderNotifyOutcome,
} from '@/server/line-notify';

/**
 * POST /api/product-orders/manual — 手動建單（B-3）。
 * `{customerId, items:[{productId, quantity}]}`：
 *   1. 驗顧客與商品存在（404）；同 productId 的多列先合併數量。
 *   2. 逐項扣庫存：CAS 條件式 update（.eq('stock', 舊值)）防併發扣到負——
 *      兩個請求同時通過「夠扣」檢查時只有一個 CAS 成功，另一個重讀重試；
 *      重試後仍不足 → 409，message 指名哪個商品。
 *   3. 途中任一項失敗（不足/衝突）→ 回補已扣的前面項目（無 DB 交易可用，
 *      以補償寫回近似原子性；回補也走 CAS 重試）。
 *   4. 建 product_orders（單價/名稱取當下 products 快照）＋ items ＋
 *      inventory_logs（SALE_OUT:訂單 <order_no>）。
 *
 *   5. `notifyCustomer` 為 true 時（建單視窗「LINE 通知顧客消費明細」勾選框），
 *      送出消費明細：LINE 優先，未綁 LINE 改寄 Email，LINE 每則扣 1 推播額度
 *      （Email 不扣）——規則逐字照那個勾選框的標籤（issue #27 ③）。
 *      回應多帶 `notify`（實際結果，見 ProductOrderNotifyOutcome），頁面照它顯示
 *      「已用 LINE 通知」／「已改寄 Email」／「沒送出」，不再重播標籤字面（鐵則 12）。
 *      ⚠️ 這裡**刻意 await**：不等結果就無從得知走的是哪條路，只能寫死一句話，
 *      那正是本 issue 要修的病。notifyProductOrderReceipt 永不拋錯，等它不會讓
 *      已成立的訂單失敗；通知失敗只影響回應裡的 `notify` 值，訂單照樣建成功。
 *
 * order_no：'PO' + yymmdd(Asia/Taipei) + 4 位當日流水（同租戶）。
 * migration 0004 的 product_orders.order_no 為 text + unique(tenant_id, order_no)、
 * 無 DB 端預設 → 由 API 產生；撞號（併發同時取到同一流水）靠 unique 約束
 * 擋下（23505），重取流水重試最多 3 次。
 */
const bodySchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1, '數量至少為 1'),
  })).min(1, '請至少選擇一項商品'),
  /** 建單視窗的「LINE 通知顧客消費明細」勾選框；未帶＝不通知 */
  notifyCustomer: z.boolean().optional().default(false),
});

/** CAS 調整單一商品庫存；requireNonNegative=true 時扣到負回 null（不足） */
async function casAdjustStock(
  supabase: any, tenantId: string, productId: string, delta: number,
): Promise<{ after: number } | 'INSUFFICIENT' | 'CONFLICT' | 'NOT_FOUND'> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: cur, error: rErr } = await supabase
      .from('products').select('stock')
      .eq('id', productId).eq('tenant_id', tenantId).maybeSingle();
    if (rErr) throw rErr;
    if (!cur) return 'NOT_FOUND';

    const after = cur.stock + delta;
    if (after < 0) return 'INSUFFICIENT';

    const { data: updated, error: uErr } = await supabase
      .from('products').update({ stock: after })
      .eq('id', productId).eq('tenant_id', tenantId).eq('stock', cur.stock) // CAS
      .select('id').maybeSingle();
    if (uErr) throw uErr;
    if (updated) return { after };
  }
  return 'CONFLICT';
}

export const POST = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const b = bodySchema.parse(await req.json());

  // 顧客必須屬於本租戶（404 規則：不存在與不屬於一視同仁）
  const { data: customer, error: cErr } = await t.supabase
    .from('customers').select('id')
    .eq('id', b.customerId).eq('tenant_id', t.tenantId).maybeSingle();
  if (cErr) throw cErr;
  if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);

  // 合併重複 productId
  const qtyByProduct = new Map<string, number>();
  for (const it of b.items)
    qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.quantity);
  const productIds = [...qtyByProduct.keys()];

  // 商品快照（名稱/單價）
  const { data: products, error: pErr } = await t.supabase
    .from('products').select('id, name, price, stock')
    .in('id', productIds).eq('tenant_id', t.tenantId);
  if (pErr) throw pErr;
  const byId = new Map((products ?? []).map((p: any) => [p.id, p]));
  for (const pid of productIds)
    if (!byId.has(pid)) throw new ApiHttpError(404, '找不到部分商品，請重新整理', ERR.NOT_FOUND);

  // 逐項 CAS 扣庫存；失敗即回補已扣項目後拋錯
  const deducted: Array<{ productId: string; quantity: number; stockAfter: number }> = [];
  const rollback = async () => {
    for (const d of deducted) {
      const r = await casAdjustStock(t.supabase, t.tenantId, d.productId, d.quantity);
      if (typeof r === 'string')
        console.error('[api] product-orders/manual: rollback failed', d.productId, r);
    }
  };

  for (const pid of productIds) {
    const qty = qtyByProduct.get(pid)!;
    const p: any = byId.get(pid);
    const r = await casAdjustStock(t.supabase, t.tenantId, pid, -qty);
    if (typeof r === 'string') {
      await rollback();
      if (r === 'INSUFFICIENT')
        throw new ApiHttpError(409, `「${p.name}」庫存不足，無法建立訂單`, ERR.CONFLICT);
      if (r === 'NOT_FOUND')
        throw new ApiHttpError(404, '找不到部分商品，請重新整理', ERR.NOT_FOUND);
      throw new ApiHttpError(409, `「${p.name}」庫存已被其他操作變更，請重試`, ERR.CONFLICT);
    }
    deducted.push({ productId: pid, quantity: qty, stockAfter: r.after });
  }

  const totalAmount = productIds.reduce(
    (sum, pid) => sum + Number((byId.get(pid) as any).price) * qtyByProduct.get(pid)!, 0);

  // 建單：'PO'+yymmdd+4 位流水，撞 unique(tenant_id, order_no) 就重取重試
  const yymmdd = taipeiTodayDateString().replaceAll('-', '').slice(2); // YYYY-MM-DD → yymmdd
  let order: { id: string; order_no: string } | null = null;
  try {
    for (let attempt = 0; attempt < 3 && !order; attempt++) {
      const { data: last, error: nErr } = await t.supabase
        .from('product_orders').select('order_no')
        .eq('tenant_id', t.tenantId).like('order_no', `PO${yymmdd}%`)
        .order('order_no', { ascending: false }).limit(1).maybeSingle();
      if (nErr) throw nErr;
      const serial = last ? Number(last.order_no.slice(-4)) + 1 : 1;
      const orderNo = `PO${yymmdd}${String(serial).padStart(4, '0')}`;

      const { data: created, error: oErr } = await t.supabase
        .from('product_orders')
        .insert({
          tenant_id: t.tenantId, order_no: orderNo, customer_id: b.customerId,
          total_amount: totalAmount, status: 'PENDING', payment_status: 'UNPAID',
        })
        .select('id, order_no').single();
      if (oErr) {
        if ((oErr as any).code === '23505') continue; // 撞號 → 重取流水
        throw oErr;
      }
      order = created;
    }
    if (!order) throw new ApiHttpError(409, '訂單編號產生衝突，請重試', ERR.CONFLICT);

    const { error: iErr } = await t.supabase.from('product_order_items').insert(
      productIds.map((pid) => {
        const p: any = byId.get(pid);
        return {
          order_id: order!.id, tenant_id: t.tenantId, product_id: pid,
          product_name: p.name, quantity: qtyByProduct.get(pid)!, price: p.price,
        };
      }),
    );
    if (iErr) throw iErr;
  } catch (e) {
    // 建單失敗 → 回補已扣庫存（已建立的 order 若 items 失敗也一併刪除）
    await rollback();
    if (order) {
      const { error: dErr } = await t.supabase
        .from('product_orders').delete().eq('id', order.id).eq('tenant_id', t.tenantId);
      if (dErr) console.error('[api] product-orders/manual: order cleanup failed', order.id, dErr);
    }
    throw e;
  }

  // 出庫 log（附加效果：失敗只 log，不讓已成立的訂單 500 —— 同 bookings complete 累點模式）
  const { error: lErr } = await t.supabase.from('inventory_logs').insert(
    deducted.map((d) => ({
      tenant_id: t.tenantId, product_id: d.productId,
      delta: -d.quantity, reason: `SALE_OUT:訂單 ${order!.order_no}`, stock_after: d.stockAfter,
    })),
  );
  if (lErr) console.error('[api] product-orders/manual: inventory log failed', order.id, lErr);

  // 消費明細通知（見檔頭 5.）：沒勾就是 'NONE'，什麼都不做也不謊稱做了。
  const notify: ProductOrderNotifyOutcome = b.notifyCustomer
    ? await notifyProductOrderReceipt(t.tenantId, order.id)
    : 'NONE';

  return ok({ id: order.id, orderNo: order.order_no, notify });
});
