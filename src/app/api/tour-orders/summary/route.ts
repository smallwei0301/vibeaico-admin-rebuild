import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiMonthRange, taipeiTodayDateString } from '@/server/tz';

/** 台北日曆日加減天數（YYYY-MM-DD，純字串運算，與時區無關） */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const PAGE = 1000;
/** 防禦性上限：單月已付款訂單超過此數時拋 422（REPORT_RANGE_TOO_LARGE），絕不靜默少算營收；頁面端摘要失敗只顯示佔位，列表不受影響。 */
const MAX_REVENUE_ROWS = 50_000;

/**
 * GET /api/tour-orders/summary — 導遊訂單管理頁四張統計卡（#890）。
 *
 * 過去這四個數字由頁面用「目前這一頁（PAGE_SIZE 20、套用篩選後）」的列算出，卻掛著
 * 「整個店家」的標籤。這支唯讀路由改在伺服器端對整個租戶計數，與列表分頁／篩選無關。
 * 每個查詢都明確 `.eq('tenant_id', ...)`。
 *
 * - pending：status = PENDING
 * - awaitingPayment：status != CANCELLED 且 payment_status ∈ (UNPAID, PARTIAL)（同 `isAwaitingPayment`）
 * - upcoming7d：CONFIRMED 且團次出發日 `trip_departures.departs_on` 落在 [台北今天, 今天+7 天]
 *   （與列表 `departsOn` 同一個來源：`tour_orders.departure_id` → `trip_departures.departs_on`）
 * - monthRevenue：payment_status = PAID 且 created_at 落在台北本月的 total_amount 加總
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const today = taipeiTodayDateString();
  const in7 = addDaysYmd(today, 7);
  const month = taipeiMonthRange();

  const pendingQ = t.supabase.from('tour_orders').select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId).eq('status', 'PENDING');
  const awaitingQ = t.supabase.from('tour_orders').select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId).neq('status', 'CANCELLED').in('payment_status', ['UNPAID', 'PARTIAL']);
  // 與列表 `departsOn` 同一個來源：tour_orders.departure_id → trip_departures.departs_on；
  // 單一租戶範圍的 count（內嵌 inner 篩選），不經 id 清單，沒有 1000 列截斷與過長 URL 問題。
  const upcomingQ = t.supabase.from('tour_orders').select('id, trip_departures!inner(departs_on)', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId).eq('status', 'CONFIRMED')
    .gte('trip_departures.departs_on', today).lte('trip_departures.departs_on', in7);

  const [pendingRes, awaitingRes, upcomingRes] = await Promise.all([pendingQ, awaitingQ, upcomingQ]);
  if (pendingRes.error) throw pendingRes.error;
  if (awaitingRes.error) throw awaitingRes.error;
  if (upcomingRes.error) throw upcomingRes.error;
  const upcoming7d = upcomingRes.count ?? 0;

  let monthRevenue = 0;
  let scanned = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await t.supabase.from('tour_orders').select('total_amount')
      .eq('tenant_id', t.tenantId).eq('payment_status', 'PAID')
      .gte('created_at', month.fromIso).lt('created_at', month.toIso)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as { total_amount: number | string | null }[];
    for (const r of page) monthRevenue += Number(r.total_amount ?? 0);
    scanned += page.length;
    if (page.length < PAGE) break;
    if (scanned >= MAX_REVENUE_ROWS) throw new ApiHttpError(422, '區間內訂單過多，請縮短日期區間', ERR.REPORT_RANGE_TOO_LARGE);
  }

  return ok({
    pending: pendingRes.count ?? 0,
    awaitingPayment: awaitingRes.count ?? 0,
    upcoming7d,
    monthRevenue,
  });
});
