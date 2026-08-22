import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapProductOrder } from '@/server/mappers';

/**
 * GET /api/product-orders — product_orders + product_order_items 聚合成 items[]
 * + customers(name) 聚合成 customer_name。⚠️ mapProductOrder 對 customer_name
 * 沒有防禦預設（`r.customer_name` 直接傳遞），查詢絕不可漏這個 join。
 * 全量不分頁，created_at desc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('product_orders')
    .select('*, customers(name), product_order_items(product_id, product_name, quantity, price)')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ok(
    data.map((r: any) =>
      mapProductOrder({
        ...r,
        customer_name: r.customers?.name ?? '',
        items: r.product_order_items ?? [],
      }),
    ),
  );
});
