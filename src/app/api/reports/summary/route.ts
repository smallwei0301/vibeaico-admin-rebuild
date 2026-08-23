// GET /api/reports/summary?from&to — 營運總覽四格（04 分冊 §B-6）。
// 回應形狀對齊前端 reports 頁 mock 的 `ReportData['summary']`
// （src/app/tenant/reports/page.tsx）：
//   { totalBookings, totalRevenue, completedBookings, newCustomers }
//
// 口徑（比照 /api/reports/dashboard 既有實作）：
//   - totalBookings：區間內全部預約（不分狀態），對齊 mock 的 daily.bookings 加總。
//   - totalRevenue：僅 status='COMPLETED' 的 final_price 加總（COMPLETED 才算營收）。
//   - completedBookings：區間內 COMPLETED 筆數。
//   - newCustomers：區間內建立且 active=true 的顧客數（軟刪不計，同 dashboard）。
// 區間：?from&to 為 YYYY-MM-DD（台北時區日界線，固定 +08:00），含 to 當天
// （半開區間 [from 00:00, to+1 00:00)）；缺省時預設「本月」（同 staff-performance）。
// 店家量級小：整段區間的預約一次查回、Node 端聚合即可，不寫 SQL 聚合 view。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiMonthRange } from '@/server/tz';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

/** YYYY-MM-DD（台北）當天 00:00 對應的 UTC ISO（offset 天可位移，to 用 +1 做半開區間） */
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

  const [{ data: bookingRows, error: e1 }, { count: newCustomers, error: e2 }] = await Promise.all([
    t.supabase.from('bookings').select('status, final_price')
      .eq('tenant_id', t.tenantId).gte('start_at', fromIso).lt('start_at', toIso),
    t.supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('active', true)
      .gte('created_at', fromIso).lt('created_at', toIso),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  let totalRevenue = 0;
  let completedBookings = 0;
  for (const b of bookingRows ?? []) {
    if (b.status === 'COMPLETED') {
      completedBookings += 1;
      totalRevenue += Number(b.final_price);
    }
  }

  return ok({
    totalBookings: (bookingRows ?? []).length,
    totalRevenue,
    completedBookings,
    newCustomers: newCustomers ?? 0,
  });
});
