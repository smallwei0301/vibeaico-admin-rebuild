// GET /api/bookings/calendar?from&to — 回區間內全部「服務預約」（不分頁，
// 含 customer/service/staff 名稱；04 §B-1。行事曆頁請改用 GET /api/calendar）。
// 區間判定用重疊（start_at < to 且 end_at > from），跨日/跨界事件才不會漏。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapBooking } from '@/server/mappers';

const querySchema = z.object({
  from: z.string().min(1, '請提供起始時間'),
  to: z.string().min(1, '請提供結束時間'),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data, error } = await t.supabase.from('bookings_view')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .lt('start_at', q.to)
    .gt('end_at', q.from)
    .order('start_at', { ascending: true });
  if (error) throw error;

  return ok(data.map(mapBooking));
});
