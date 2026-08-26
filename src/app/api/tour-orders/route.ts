import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged, pageSizeSchema } from '@/server/paging';
import { mapTourOrder } from '@/server/mappers';

/**
 * GET /api/tour-orders — 旅遊訂單列表（分頁 + 篩選，10 分冊 §5）。
 *
 * ⚠️ join 三張表帶回顯示欄位（trips.title / trip_plans.name /
 * trip_departures.departs_on,start_time）：`mapTourOrder` 對這三者沒有捏造的
 * 預設值，漏 join 只會讓畫面留白，不會顯示錯的行程名。
 *
 * `departureId` 篩選是 10 分冊 §5.5 要的：行事曆點團次 →
 * `/tenant/tour-orders?departureId=…` 看該團報名名單。
 */
const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: pageSizeSchema(20),
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PAID', 'REFUNDED']).optional(),
  source: z.enum(['MIDAO', 'VIBEAI_SHOP', 'LINE', 'MANUAL']).optional(),
  departureId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  keyword: z.string().optional(),
});

const SELECT = '*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)';

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);

  let query = t.supabase.from('tour_orders')
    .select(SELECT, { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (q.status) query = query.eq('status', q.status);
  if (q.paymentStatus) query = query.eq('payment_status', q.paymentStatus);
  if (q.source) query = query.eq('source', q.source);
  if (q.departureId) query = query.eq('departure_id', q.departureId);
  if (q.tripId) query = query.eq('trip_id', q.tripId);
  // 關鍵字只搜 tour_orders 自己的欄位。行程名在 join 過來的表上，PostgREST 的
  // `or` 不能跨表——想搜行程名請用 tripId 篩選（前端的行程下拉就是為此）。
  if (q.keyword) query = query.or(
    `order_no.ilike.%${q.keyword}%,customer_name.ilike.%${q.keyword}%,customer_phone.ilike.%${q.keyword}%`);

  const { data, count, error } = await query;
  if (error) throw error;

  return ok(toPaged((data ?? []).map(mapTourOrder), count, page, size));
});
