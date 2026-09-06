// GET /api/reports/booking-sources?from&to — 本月（預設）預約來源分布。
// 回應形狀對齊 dashboard 頁 mock 的 `MonthSourcePoint[]`
// （src/app/tenant/dashboard/page.tsx）：{ source, count }[]，
// source 為 bookings.source 真實 enum（LINE|PUBLIC_PAGE|MANUAL|RECURRING）。
//
// 口徑（比照 /api/reports/daily／summary）：不分狀態，計「該區間內建立的預約」——
// 用 start_at 篩區間（與 daily/summary 一致，非 created_at），區間預設「本月」
// （台北時區固定 +08:00，含 to 當天）。沒有既有聚合 view，店家量級小，一次查回
// 區間內全部預約的 source 欄位、Node 端記憶體計數即可。
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

const SOURCES = ['LINE', 'PUBLIC_PAGE', 'MANUAL', 'RECURRING'] as const;

export const GET = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'BASIC_REPORT');
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromIso = q.from ? taipeiDayIso(q.from) : month.fromIso;
  const toIso = q.to ? taipeiDayIso(q.to, 1) : month.toIso;

  const { data: rows, error } = await t.supabase.from('bookings')
    .select('source')
    .eq('tenant_id', t.tenantId)
    .gte('start_at', fromIso).lt('start_at', toIso);
  if (error) throw error;

  const counts: Record<string, number> = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const b of rows ?? []) {
    if (b.source in counts) counts[b.source] += 1;
  }

  return ok(SOURCES.map((source) => ({ source, count: counts[source] })));
});
