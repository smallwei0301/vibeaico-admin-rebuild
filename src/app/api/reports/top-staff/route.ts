// GET /api/reports/top-staff?from&to — 員工排行 TOP 5（04 分冊 §B-6）。
// 回應形狀 = StaffPerformance[]（src/lib/types.ts）：前端 reports 頁的員工排行
// 直接以 StaffPerformance 渲染（staffId/staffName/bookingCount/completionRate/
// revenue，頁面 `staff.slice(0, 5)`），本端點沿用同一形狀，僅改為「已排序＋
// 取前 5」。聚合方式與口徑照抄既有 /api/reports/staff-performance：
//   - bookingCount 計全部狀態；revenue 僅 COMPLETED 的 final_price（營收口徑）。
//   - 未指定員工的預約不歸屬任何人；非 active 員工不列入。
// 排序：revenue desc，其次 bookingCount desc（排行看業績）。
// 區間：?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，含 to 當天），缺省預設
// 本月（同 staff-performance）。店家量級小：一次查回、Node 端聚合即可。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiMonthRange } from '@/server/tz';
import { mapStaffPerformance } from '@/server/mappers';
import { aggregatePerformance } from '@/server/addon-performance';

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
  await requireFeature(t.tenantId, 'BASIC_REPORT');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromIso = q.from ? taipeiDayIso(q.from) : month.fromIso;
  const toIso = q.to ? taipeiDayIso(q.to, 1) : month.toIso;

  const [{ data: staffRows, error: e1 }, { data: bookingRows, error: e2 },
    { data: bookingAddonRows, error: e3 }, { data: tourAddonRows, error: e4 }] = await Promise.all([
    t.supabase.from('staff').select('id, name')
      .eq('tenant_id', t.tenantId).eq('active', true),
    t.supabase.from('bookings').select('id, staff_id, status, final_price')
      .eq('tenant_id', t.tenantId).gte('start_at', fromIso).lt('start_at', toIso),
    t.supabase.from('booking_addons').select('booking_id, applied_amount, performance_mode, performance_staff_id')
      .eq('tenant_id', t.tenantId),
    t.supabase.from('tour_order_addons')
      .select('performance_staff_id, performance_amount, tour_orders!inner(status, updated_at)')
      .eq('tenant_id', t.tenantId).eq('tour_orders.status', 'COMPLETED')
      .gte('tour_orders.updated_at', fromIso).lt('tour_orders.updated_at', toIso),
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

  const rows = (staffRows ?? [])
    .map((s) => {
      const agg = byStaff.get(s.id)!;
      return {
        staff_id: s.id,
        staff_name: s.name,
        booking_count: agg.bookingCount,
        completion_rate: agg.bookingCount > 0
          ? Math.round((agg.completed / agg.bookingCount) * 1000) / 10
          : 0,
        revenue: agg.revenue,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.booking_count - a.booking_count)
    .slice(0, 5);

  return ok(rows.map(mapStaffPerformance));
});
