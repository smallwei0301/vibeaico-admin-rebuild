import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { mapTourOrder } from '@/server/mappers';
import { pageRange, toPaged } from '@/server/paging';
import { requireTenant } from '@/server/tenant';

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0), size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED']).optional(),
  source: z.enum(['MIDAO', 'VIBEAI_SHOP', 'LINE', 'MANUAL']).optional(),
  keyword: z.string().trim().max(100).optional(),
});
const SELECT = '*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)';

/** Tenant-scoped list. Payment status includes PARTIAL: tail-payment work is
 * never hidden from a guide merely because an upfront receipt exists. */
export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);
  let query = t.supabase.from('tour_orders').select(SELECT, { count: 'exact' })
    .eq('tenant_id', t.tenantId).order('created_at', { ascending: false }).range(from, to);
  if (q.status) query = query.eq('status', q.status);
  if (q.paymentStatus) query = query.eq('payment_status', q.paymentStatus);
  if (q.source) query = query.eq('source', q.source);
  if (q.keyword) query = query.or(
    `order_no.ilike.%${q.keyword}%,customer_name.ilike.%${q.keyword}%,customer_phone.ilike.%${q.keyword}%`);
  const { data, count, error } = await query;
  if (error) throw error;
  return ok(toPaged((data ?? []).map(mapTourOrder), count, page, size));
});
