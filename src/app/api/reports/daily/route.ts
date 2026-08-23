// GET /api/reports/daily?from&to — 每日趨勢（04 分冊 §B-6）。
// 回應形狀對齊前端 reports 頁 mock 的 `DailyPoint[]`
// （src/app/tenant/reports/page.tsx）：{ label: 'MM/DD', bookings, revenue }[]
//
// 口徑（比照 /api/reports/dashboard）：
//   - bookings：該台北日全部預約筆數（不分狀態）。
//   - revenue：該台北日 COMPLETED 的 final_price 加總（COMPLETED 才算營收）。
// 區間：?from&to = YYYY-MM-DD（台北日界線，固定 +08:00，含 to 當天），
// 缺省預設「本月」。整段區間逐日輸出（無資料的日子補 0，長條圖才不會斷）。
// 店家量級小：區間內預約一次查回、Node 端分桶聚合即可。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
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

/** UTC 瞬間 → 台北牆上時鐘的 'MM/DD' 標籤（對齊 mock 的 label 格式） */
function taipeiLabel(ms: number): string {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  return `${String(t.getUTCMonth() + 1).padStart(2, '0')}/${String(t.getUTCDate()).padStart(2, '0')}`;
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const month = taipeiMonthRange();
  const fromMs = q.from ? taipeiDayMs(q.from) : Date.parse(month.fromIso);
  const toMs = q.to ? taipeiDayMs(q.to, 1) : Date.parse(month.toIso);

  const { data: rows, error } = await t.supabase.from('bookings')
    .select('start_at, status, final_price')
    .eq('tenant_id', t.tenantId)
    .gte('start_at', new Date(fromMs).toISOString())
    .lt('start_at', new Date(toMs).toISOString());
  if (error) throw error;

  // 逐日建桶（台北日界線），再把預約落進對應的桶。
  const days: { label: string; bookings: number; revenue: number }[] = [];
  for (let ms = fromMs; ms < toMs; ms += DAY_MS) {
    days.push({ label: taipeiLabel(ms), bookings: 0, revenue: 0 });
  }
  for (const b of rows ?? []) {
    const idx = Math.floor((Date.parse(b.start_at) - fromMs) / DAY_MS);
    const bucket = days[idx];
    if (!bucket) continue;
    bucket.bookings += 1;
    if (b.status === 'COMPLETED') bucket.revenue += Number(b.final_price);
  }

  return ok(days);
});
