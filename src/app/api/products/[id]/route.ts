import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/products/:id — 編輯商品 ⚙MANAGER。所有欄位皆可選，只更新 body 裡
 * 實際出現的欄位（同 customers/[id] 模式）。
 *
 * stock 特例：商品編輯表單（products/page.tsx）含庫存欄位，因此 PUT 接受
 * stock，但為了讓 inventory_logs 帳目完整，stock 變更走「CAS 條件式更新＋
 * 寫 log」路徑（見下方註解），其餘欄位為普通 update。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入商品名稱').optional(),
  categoryId: z.string().optional(),
  description: z.string().optional(),
  price: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  safetyStock: z.coerce.number().int().min(0).optional(),
  imageUrl: z.string().optional(),
  active: z.boolean().optional(),
  lineFeatured: z.boolean().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.categoryId !== undefined) update.category_id = b.categoryId ? b.categoryId : null;
  if (b.description !== undefined) update.description = b.description;
  if (b.price !== undefined) update.price = b.price;
  if (b.safetyStock !== undefined) update.safety_stock = b.safetyStock;
  if (b.imageUrl !== undefined) update.image_url = b.imageUrl;
  if (b.active !== undefined) update.active = b.active;
  if (b.lineFeatured !== undefined) update.line_featured = b.lineFeatured;

  if (Object.keys(update).length > 0) {
    const { data, error } = await t.supabase
      .from('products').update(update)
      .eq('id', id).eq('tenant_id', t.tenantId)
      .select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此商品', ERR.NOT_FOUND);
  } else {
    const { data, error } = await t.supabase
      .from('products').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此商品', ERR.NOT_FOUND);
  }

  // stock 變更：讀舊值 → 以 .eq('stock', 舊值) 條件式更新（CAS），拿不到列表示
  // 有人併發改了庫存 → 重讀重試，最多 3 次；成功才寫 MANUAL log（delta = 差額）。
  if (b.stock !== undefined) {
    for (let attempt = 0; ; attempt++) {
      const { data: cur, error: rErr } = await t.supabase
        .from('products').select('stock')
        .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
      if (rErr) throw rErr;
      if (!cur) throw new ApiHttpError(404, '找不到此商品', ERR.NOT_FOUND);
      const delta = b.stock - cur.stock;
      if (delta === 0) break;

      const { data: updated, error: uErr } = await t.supabase
        .from('products').update({ stock: b.stock })
        .eq('id', id).eq('tenant_id', t.tenantId).eq('stock', cur.stock)
        .select('id').maybeSingle();
      if (uErr) throw uErr;
      if (updated) {
        const { error: lErr } = await t.supabase.from('inventory_logs').insert({
          tenant_id: t.tenantId, product_id: id,
          delta, reason: 'MANUAL:商品編輯調整', stock_after: b.stock,
        });
        if (lErr) console.error('[api] products PUT: inventory log failed', id, lErr);
        break;
      }
      if (attempt >= 2)
        throw new ApiHttpError(409, '庫存已被其他操作變更，請重新整理後再試', ERR.CONFLICT);
    }
  }

  return ok();
});

/**
 * DELETE /api/products/:id — ⚙MANAGER。
 * 有「未出貨訂單」（product_order_items join product_orders，狀態非終態
 * PENDING/CONFIRMED）→ 軟刪 active=false；否則真刪
 * （inventory_logs FK on delete cascade、已完成/取消訂單的 items FK 為
 * restrict —— 真刪前仍需無任何 items 參照，若有歷史訂單 items 也改軟刪）。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: existing, error: e0 } = await t.supabase
    .from('products').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此商品', ERR.NOT_FOUND);

  // 未出貨（非終態）訂單：PENDING / CONFIRMED。!inner 讓 join 過濾生效。
  const { data: openItems, error: e1 } = await t.supabase
    .from('product_order_items')
    .select('id, product_orders!inner(status)')
    .eq('tenant_id', t.tenantId).eq('product_id', id)
    .in('product_orders.status', ['PENDING', 'CONFIRMED'])
    .limit(1);
  if (e1) throw e1;

  // 歷史訂單（終態）items 的 FK 是 on delete restrict，真刪會炸 → 一律軟刪。
  const { data: anyItems, error: e2 } = await t.supabase
    .from('product_order_items')
    .select('id')
    .eq('tenant_id', t.tenantId).eq('product_id', id)
    .limit(1);
  if (e2) throw e2;

  if ((openItems?.length ?? 0) > 0 || (anyItems?.length ?? 0) > 0) {
    const { error } = await t.supabase
      .from('products').update({ active: false })
      .eq('id', id).eq('tenant_id', t.tenantId);
    if (error) throw error;
    // 與 services DELETE 的回應形狀對齊：讓前端能分辨「下架保留」與「真刪」
    // （頁面據此決定該列標停用還是移除）。
    return ok({ deactivated: true });
  }

  const { error } = await t.supabase
    .from('products').delete().eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;
  return ok({ deleted: true });
});
