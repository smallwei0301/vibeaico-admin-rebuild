// GET /api/reports/top-products?from&to — 熱門商品 TOP 10（04 分冊 §B-6）。
// 回應形狀對齊前端 reports 頁 mock 的 `TopProduct[]`
// （src/app/tenant/reports/page.tsx）：{ name, quantity, revenue }[]
//
// 口徑：僅計 status='COMPLETED' 的商品訂單（比照預約「COMPLETED 才算營收」；
// PENDING/CONFIRMED 未完成、CANCELLED 已取消都不列入銷量與營收）。
//   - quantity：訂單明細 quantity 加總；revenue：quantity × price（下單當下快照）加總。
//   - name 用 product_order_items.product_name 快照（商品之後改名/刪除也不影響歷史報表）。
// 排序：quantity desc，取前 10（mock 給 10 名、頁面標題「TOP 10」）。
// 區間：?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，含 to 當天）套在訂單
// created_at；缺省預設本月。店家量級小：一次查回、Node 端聚合即可。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiMonthRange } from '@/server/tz';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

function taipeiDayIso(ymd: string, offsetDays = 0): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS).toISOString();
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromIso = q.from ? taipeiDayIso(q.from) : month.fromIso;
  const toIso = q.to ? taipeiDayIso(q.to, 1) : month.toIso;

  // !inner + 內嵌欄位過濾：只留區間內、已完成訂單的明細列。
  const { data: rows, error } = await t.supabase.from('product_order_items')
    .select('product_id, product_name, quantity, price, product_orders!inner(status, created_at)')
    .eq('tenant_id', t.tenantId)
    .eq('product_orders.status', 'COMPLETED')
    .gte('product_orders.created_at', fromIso)
    .lt('product_orders.created_at', toIso);
  if (error) throw error;

  const byProduct = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const it of rows ?? []) {
    let agg = byProduct.get(it.product_id);
    if (!agg) {
      agg = { name: it.product_name, quantity: 0, revenue: 0 };
      byProduct.set(it.product_id, agg);
    }
    agg.quantity += it.quantity;
    agg.revenue += it.quantity * Number(it.price);
  }

  const top = [...byProduct.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 10);
  return ok(top);
});
