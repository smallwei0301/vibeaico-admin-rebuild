// GET /api/reports/hourly?from&to — 預約時段分布（04 分冊 §B-6）。
// 回應形狀對齊前端 reports 頁 mock 的 `HourlyPoint[]`
// （src/app/tenant/reports/page.tsx）：{ hourLabel: 'HH:00', count, isPeak }[]
//
// 口徑：以預約 start_at 的「台北牆上時鐘小時」分桶，計全部狀態的預約筆數
// （時段分布看的是來客尖峰，不是營收，故不限 COMPLETED）。
// 輸出範圍：mock 固定回 10:00–20:00；真實資料改回「最早有預約的小時 ～ 最晚
// 有預約的小時」的連續區段（中間補 0），營業時間各店不同，寫死 10–20 反而會
// 把清晨/深夜的預約切掉。區間內完全沒有預約時回空陣列（頁面已有 EmptyState）。
// isPeak：count 等於最大值者為尖峰（同 mock：並列最大值都標尖峰）。
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

  const { data: rows, error } = await t.supabase.from('bookings')
    .select('start_at')
    .eq('tenant_id', t.tenantId).gte('start_at', fromIso).lt('start_at', toIso);
  if (error) throw error;

  const counts = new Array<number>(24).fill(0);
  for (const b of rows ?? []) {
    const hour = new Date(Date.parse(b.start_at) + TAIPEI_OFFSET_MS).getUTCHours();
    counts[hour] += 1;
  }

  const firstHour = counts.findIndex((c) => c > 0);
  if (firstHour === -1) return ok([]);
  let lastHour = 23;
  while (counts[lastHour] === 0) lastHour -= 1;
  const peak = Math.max(...counts);

  const hourly = [];
  for (let h = firstHour; h <= lastHour; h += 1) {
    hourly.push({
      hourLabel: `${String(h).padStart(2, '0')}:00`,
      count: counts[h],
      isPeak: counts[h] === peak,
    });
  }
  return ok(hourly);
});
