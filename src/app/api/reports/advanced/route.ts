// GET /api/reports/advanced?from&to — 進階報表（04 分冊 §B-6）。
// 回應形狀對齊前端 reports 頁 mock 的 `ReportData['advanced']`
// （src/app/tenant/reports/page.tsx）：
//   { totalCustomers, activeCustomers, avgVisitCycle, avgCustomerValue,
//     serviceTrends: { name, bookings, growth }[] }
//
// 口徑（營收比照 /api/reports/dashboard：COMPLETED 才算）：
//   - totalCustomers：全店 active=true 顧客數（軟刪不計，同 dashboard；頁面用它算回訪率分母）。
//   - activeCustomers：區間內有 COMPLETED 預約的「不重複」顧客數（實際有來訪才算活躍）。
//   - avgVisitCycle：區間內 COMPLETED 預約 ≥2 次的顧客，其相鄰兩次來訪間隔天數
//     的平均，再對顧客取平均、四捨五入為整數天；無此類顧客回 0。
//   - avgCustomerValue：區間 COMPLETED 營收 ÷ activeCustomers（四捨五入；同 mock 算式），
//     activeCustomers=0 時回 0。
//   - serviceTrends：取本區間預約數（不分狀態）前 5 名的服務；growth 為與「前一個
//     等長區間」預約數相比的百分比（一位小數）。前期 0、本期 >0 → 100；兩期皆 0 → 0。
// 區間：?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，含 to 當天），缺省預設本月。
// 店家量級小：本期＋前期預約一次查回、Node 端聚合即可，不寫 SQL 聚合 view。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiMonthRange } from '@/server/tz';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE_RE, 'from 需為 YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to 需為 YYYY-MM-DD').optional(),
});

function taipeiDayMs(ymd: string, offsetDays = 0): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d + offsetDays) - TAIPEI_OFFSET_MS;
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'BASIC_REPORT');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromMs = q.from ? taipeiDayMs(q.from) : Date.parse(month.fromIso);
  const toMs = q.to ? taipeiDayMs(q.to, 1) : Date.parse(month.toIso);
  // 前一個等長區間（serviceTrends 的成長率基期）
  const prevFromMs = fromMs - (toMs - fromMs);

  const [
    { count: totalCustomers, error: e1 },
    { data: currRows, error: e2 },
    { data: prevRows, error: e3 },
  ] = await Promise.all([
    t.supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('active', true),
    t.supabase.from('bookings_view')
      .select('customer_id, service_id, service_name, status, final_price, start_at')
      .eq('tenant_id', t.tenantId)
      .gte('start_at', new Date(fromMs).toISOString())
      .lt('start_at', new Date(toMs).toISOString()),
    t.supabase.from('bookings')
      .select('service_id')
      .eq('tenant_id', t.tenantId)
      .gte('start_at', new Date(prevFromMs).toISOString())
      .lt('start_at', new Date(fromMs).toISOString()),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  // ---- 活躍顧客 / 營收 / 回訪週期（COMPLETED 口徑） ----
  let totalRevenue = 0;
  const visitsByCustomer = new Map<string, number[]>();
  for (const b of currRows ?? []) {
    if (b.status !== 'COMPLETED') continue;
    totalRevenue += Number(b.final_price);
    const visits = visitsByCustomer.get(b.customer_id) ?? [];
    visits.push(Date.parse(b.start_at));
    visitsByCustomer.set(b.customer_id, visits);
  }
  const activeCustomers = visitsByCustomer.size;

  let cycleSum = 0;
  let cycleCount = 0;
  for (const visits of visitsByCustomer.values()) {
    if (visits.length < 2) continue;
    visits.sort((a, b) => a - b);
    // 該顧客的平均間隔 = 首尾跨距 / (次數-1)
    cycleSum += (visits[visits.length - 1] - visits[0]) / (visits.length - 1) / DAY_MS;
    cycleCount += 1;
  }
  const avgVisitCycle = cycleCount > 0 ? Math.round(cycleSum / cycleCount) : 0;
  const avgCustomerValue = activeCustomers > 0 ? Math.round(totalRevenue / activeCustomers) : 0;

  // ---- 服務趨勢（預約數不分狀態，對齊 mock 的 bookings 口徑） ----
  const currByService = new Map<string, { name: string; bookings: number }>();
  for (const b of currRows ?? []) {
    let agg = currByService.get(b.service_id);
    if (!agg) {
      agg = { name: b.service_name, bookings: 0 };
      currByService.set(b.service_id, agg);
    }
    agg.bookings += 1;
  }
  const prevByService = new Map<string, number>();
  for (const b of prevRows ?? []) {
    prevByService.set(b.service_id, (prevByService.get(b.service_id) ?? 0) + 1);
  }

  const serviceTrends = [...currByService.entries()]
    .sort((a, b) => b[1].bookings - a[1].bookings)
    .slice(0, 5)
    .map(([serviceId, { name, bookings }]) => {
      const prev = prevByService.get(serviceId) ?? 0;
      const growth = prev > 0
        ? Math.round(((bookings - prev) / prev) * 1000) / 10
        : bookings > 0 ? 100 : 0;
      return { name, bookings, growth };
    });

  return ok({
    totalCustomers: totalCustomers ?? 0,
    activeCustomers,
    avgVisitCycle,
    avgCustomerValue,
    serviceTrends,
  });
});
