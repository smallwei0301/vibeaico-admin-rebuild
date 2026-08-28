// GET /api/reports/staff-performance?from&to — StaffPerformance[]（src/lib/types.ts）。
// 預設區間為本月（Asia/Taipei，固定 +08:00，見 src/server/tz.ts）。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiMonthRange } from '@/server/tz';
import { mapStaffPerformance } from '@/server/mappers';
import { aggregatePerformance } from '@/server/addon-performance';

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'BASIC_REPORT');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { fromIso: defaultFrom, toIso: defaultTo } = taipeiMonthRange();
  const from = q.from ?? defaultFrom;
  const to = q.to ?? defaultTo;

  // 店家量級小：active 員工全列 + 區間內全部預約一次查回，記憶體聚合即可，
  // 不另外寫 SQL 聚合 view（同 A-5 其他報表端點的作法）。
  const [{ data: staffRows, error: e1 }, { data: bookingRows, error: e2 },
    { data: bookingAddonRows, error: e3 }, { data: tourAddonRows, error: e4 }] = await Promise.all([
    t.supabase.from('staff').select('id, name')
      .eq('tenant_id', t.tenantId).eq('active', true).order('sort_order', { ascending: true }),
    t.supabase.from('bookings').select('id, staff_id, status, final_price')
      .eq('tenant_id', t.tenantId).gte('start_at', from).lte('start_at', to),
    t.supabase.from('booking_addons').select('booking_id, applied_amount, performance_mode, performance_staff_id')
      .eq('tenant_id', t.tenantId),
    t.supabase.from('tour_order_addons')
      .select('performance_staff_id, performance_amount, tour_orders!inner(status, updated_at)')
      .eq('tenant_id', t.tenantId).eq('tour_orders.status', 'COMPLETED')
      .gte('tour_orders.updated_at', from).lte('tour_orders.updated_at', to),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;
  const byStaff = aggregatePerformance(
    (staffRows ?? []).map((staff: any) => staff.id),
    (bookingRows ?? []).map((booking: any) => ({ id: booking.id, staffId: booking.staff_id, status: booking.status, finalPrice: Number(booking.final_price) })),
    (bookingAddonRows ?? []).map((addon: any) => ({ bookingId: addon.booking_id, appliedAmount: Number(addon.applied_amount), performanceMode: addon.performance_mode ?? 'PRIMARY', performanceStaffId: addon.performance_staff_id })),
    (tourAddonRows ?? []).map((addon: any) => ({ performanceStaffId: addon.performance_staff_id, performanceAmount: addon.performance_amount == null ? null : Number(addon.performance_amount) })),
  );

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
