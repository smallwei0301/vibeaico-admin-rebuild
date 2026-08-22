// 04-API-CONTRACTS.md §0 參考實作，逐字採用。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged } from '@/server/paging';
import { mapBooking } from '@/server/mappers';

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  keyword: z.string().optional(),
  from: z.string().optional(), // ISO 日期
  to: z.string().optional(),
  staffId: z.string().uuid().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);

  let query = t.supabase.from('bookings_view')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: false })
    .range(from, to);
  if (q.status) query = query.eq('status', q.status);
  if (q.staffId) query = query.eq('staff_id', q.staffId);
  if (q.from) query = query.gte('start_at', q.from);
  if (q.to) query = query.lte('start_at', q.to);
  if (q.keyword) query = query.or(
    `customer_name.ilike.%${q.keyword}%,customer_phone.ilike.%${q.keyword}%,booking_no.ilike.%${q.keyword}%`);

  const { data, count, error } = await query;
  if (error) throw error;
  return ok(toPaged(data.map(mapBooking), count, page, size));
});
