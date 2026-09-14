import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { hydrateTourOrders } from '@/server/tour-orders';

// #43 Final Risk F1：orderId 完全由 client 控制（GUIDE 收件匣 deep link 的 query string），
// 沒驗證時傳一個非 uuid 值會讓 Postgres 直接回 22P02，`handle()` 把它變成 500——但這其實是
// 畸形輸入，應該 400。比照 `/api/bookings` 的 `bookingId`（同一份合約的等價欄位）用
// `z.string().uuid()`；只驗這一個欄位，不把整支路由改寫成 zod schema，避免為了一個 400
// 擴大這支 PR 的範圍。驗證失敗要讓 ZodError 往外丟給 `handle()` 轉 400——不能吞掉當成
// 沒帶 orderId，否則 deep link 打錯字會無聲地退回整頁列表，比報錯更難查。
const orderIdSchema = z.string().uuid().optional();

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
  // GUIDE 收件匣 REFUND_PENDING 卡片的 deep link（#43 類別 5）以 orderId 精準撈一筆，
  // 比照 `/api/bookings` 的 `bookingId`——`.eq('tenant_id', ...)` 已經先套用，這裡再加
  // `.eq('id', orderId)` 不會、也不能繞過租戶邊界：跨租戶的 id 一律撈不到任何列。
  // 非 uuid 值在這裡就擋下（400），不留給 Postgres 的 22P02 變成 500（Final Risk F1）。
  const orderId = orderIdSchema.parse(url.searchParams.get('orderId') ?? undefined);

  let query = t.supabase.from('tour_orders')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId);
  if (orderId) query = query.eq('id', orderId);
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
