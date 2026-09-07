import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { hydrateTourOrders } from '@/server/tour-orders';

/**
 * GET /api/tour-orders — 旅遊訂單分頁清單（#8-B，10 分冊 §5）。
 *
 * `/tenant/tour-orders` 頁**早就接好這支 service**（`listTourOrders`），
 * 但在 `tour_orders` 表落地之前這支路由不存在，呼叫一律 404 —— 接線在、鏈路不通。
 *
 * 讀取面**不帶 `requireFeature`**：與 `/api/trips` 等五支 GET 一致（#8-A 的
 * read-contract 修正），退訂後店家仍讀得到自己的歷史訂單，只是不能再建新單。
 * 租戶隔離由 `requireTenant()` ＋ 明確的 `tenant_id` 過濾負責。
 */
export const GET = handle(async (req) => {
  const t = await requireTenant();
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') ?? 20) || 20));
  const status = url.searchParams.get('status');
  const source = url.searchParams.get('source');
  const paymentStatus = url.searchParams.get('paymentStatus');
  const keyword = (url.searchParams.get('keyword') ?? '').trim();

  let query = t.supabase.from('tour_orders')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId);
  if (status) query = query.eq('status', status);
  if (source) query = query.eq('source', source);
  if (paymentStatus) query = query.eq('payment_status', paymentStatus);
  // 顧客姓名與電話存在 contact jsonb 裡，訂單編號是欄位——兩者都要搜得到。
  if (keyword) {
    const like = `%${keyword}%`;
    query = query.or(
      `order_no.ilike.${like},contact->>name.ilike.${like},contact->>phone.ilike.${like}`,
    );
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(page * size, page * size + size - 1);
  if (error) throw error;

  const content = await hydrateTourOrders(t.supabase, t.tenantId, data ?? []);
  const totalElements = count ?? content.length;
  return ok({
    content,
    totalElements,
    totalPages: Math.max(1, Math.ceil(totalElements / size)),
    number: page,
    size,
  });
});
