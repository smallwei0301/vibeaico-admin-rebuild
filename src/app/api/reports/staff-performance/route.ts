// GET /api/reports/staff-performance?from&to — StaffPerformance[]（src/lib/types.ts）。
// 預設區間為本月（Asia/Taipei，固定 +08:00，見 src/server/tz.ts）。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiMonthRange } from '@/server/tz';
import { mapStaffPerformance } from '@/server/mappers';

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { fromIso: defaultFrom, toIso: defaultTo } = taipeiMonthRange();
  const from = q.from ?? defaultFrom;
  const to = q.to ?? defaultTo;

  // 店家量級小：active 員工全列 + 區間內全部預約一次查回，記憶體聚合即可，
  // 不另外寫 SQL 聚合 view（同 A-5 其他報表端點的作法）。
  const [{ data: staffRows, error: e1 }, { data: bookingRows, error: e2 }] = await Promise.all([
    t.supabase.from('staff').select('id, name')
      .eq('tenant_id', t.tenantId).eq('active', true).order('sort_order', { ascending: true }),
    t.supabase.from('bookings').select('staff_id, status, final_price')
      .eq('tenant_id', t.tenantId).gte('start_at', from).lte('start_at', to),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const byStaff = new Map<string, { bookingCount: number; completed: number; revenue: number }>();
  for (const s of staffRows ?? []) byStaff.set(s.id, { bookingCount: 0, completed: 0, revenue: 0 });

  for (const b of bookingRows ?? []) {
    if (!b.staff_id) continue; // 未指定員工的預約不歸屬任何人的績效
    const agg = byStaff.get(b.staff_id);
    if (!agg) continue; // 非 active 員工（離職/停用）不列在報表
    agg.bookingCount += 1;
    if (b.status === 'COMPLETED') {
      agg.completed += 1;
      agg.revenue += Number(b.final_price);
    }
  }

  const rows = (staffRows ?? []).map((s) => {
    const agg = byStaff.get(s.id)!;
    // 百分比，取一位小數（對照 mock 資料如 94.2）；沒有任何預約時給 0。
    const completionRate = agg.bookingCount > 0
      ? Math.round((agg.completed / agg.bookingCount) * 1000) / 10
      : 0;
    return {
      staff_id: s.id,
      staff_name: s.name,
      booking_count: agg.bookingCount,
      completion_rate: completionRate,
      revenue: agg.revenue,
    };
  });

  return ok(rows.map(mapStaffPerformance));
});
