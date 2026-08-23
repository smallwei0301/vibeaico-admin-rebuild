import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/products/:id/adjust-stock — `{delta, reason}` ⚙MANAGER（B-3）。
 * stock + delta 不可 < 0（409）＋寫 inventory_logs。
 *
 * 併發語意（先讀再寫，但用 CAS 條件式 update 防止扣到負）：
 *   1. 讀目前 stock，算 after = stock + delta；after < 0 → 409。
 *   2. update ... .eq('stock', 讀到的舊值)（compare-and-swap）——若兩個請求
 *      同時通過第 1 步檢查，只有一個能匹配舊值成功更新；另一個拿不到列，
 *      回到第 1 步用新值重算重試（最多 3 次），因此永遠不會出現
 *      「兩邊都以為夠扣、實際扣成負數」的競態。
 *   3. CAS 成功後才寫 inventory_logs（stock_after = CAS 寫入的值，帳目一致）。
 */
const bodySchema = z.object({
  delta: z.coerce.number().int().refine((n) => n !== 0, '調整數量不可為 0'),
  reason: z.string().min(1, '請輸入調整原因'),
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  for (let attempt = 0; ; attempt++) {
    const { data: cur, error: rErr } = await t.supabase
      .from('products').select('stock')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (rErr) throw rErr;
    if (!cur) throw new ApiHttpError(404, '找不到此商品', ERR.NOT_FOUND);

    const after = cur.stock + b.delta;
    if (after < 0)
      throw new ApiHttpError(409, '庫存不足，調整後庫存不可小於 0', ERR.CONFLICT);

    const { data: updated, error: uErr } = await t.supabase
      .from('products').update({ stock: after })
      .eq('id', id).eq('tenant_id', t.tenantId).eq('stock', cur.stock) // CAS
      .select('id').maybeSingle();
    if (uErr) throw uErr;

    if (updated) {
      // reason 欄位存「TYPE:明細」複合格式（DB 只有一個 text 欄位；
      // GET /api/inventory/logs 讀取時拆回 type + reason 兩欄）。
      const { error: lErr } = await t.supabase.from('inventory_logs').insert({
        tenant_id: t.tenantId, product_id: id,
        delta: b.delta, reason: `MANUAL:${b.reason}`, stock_after: after,
      });
      if (lErr) throw lErr;
      return ok({ stock: after });
    }

    if (attempt >= 2)
      throw new ApiHttpError(409, '庫存已被其他操作變更，請重新整理後再試', ERR.CONFLICT);
  }
});
