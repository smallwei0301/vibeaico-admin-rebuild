// GET /api/reports/top-services?from&to — 熱門服務 TOP 5（04 分冊 §B-6）。
// 回應形狀對齊前端 reports 頁 mock 的 `TopService[]`
// （src/app/tenant/reports/page.tsx）：{ name, bookings, revenue }[]
//
// 口徑（比照 /api/reports/dashboard）：
//   - bookings：區間內該服務的全部預約筆數（不分狀態，對齊 mock 的
//     serviceDistribution → topServices 都以「預約數」計）。
//   - revenue：僅 COMPLETED 的 final_price 加總（COMPLETED 才算營收）。
// 排序：bookings desc，取前 5（mock `.slice(0, 5)`）。
// 資料源：bookings_view（0007，已 join services 取 service_name）。
// 區間：?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，含 to 當天），缺省預設本月。
// 店家量級小：一次查回、Node 端聚合即可。
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

  const { data: rows, error } = await t.supabase.from('bookings_view')
    .select('service_id, service_name, status, final_price')
    .eq('tenant_id', t.tenantId).gte('start_at', fromIso).lt('start_at', toIso);
  if (error) throw error;

  const byService = new Map<string, { name: string; bookings: number; revenue: number }>();
  for (const b of rows ?? []) {
    let agg = byService.get(b.service_id);
    if (!agg) {
      agg = { name: b.service_name, bookings: 0, revenue: 0 };
      byService.set(b.service_id, agg);
    }
    agg.bookings += 1;
    if (b.status === 'COMPLETED') agg.revenue += Number(b.final_price);
  }

  const top = [...byService.values()]
    .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
    .slice(0, 5);
  return ok(top);
});
