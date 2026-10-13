import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiMonthRange, taipeiTodayDateString } from '@/server/tz';

/** 台北日曆日加減天數（YYYY-MM-DD，純字串運算，與時區無關） */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const PAGE = 1000;
/** 防禦性上限：單月已付款訂單超過此數時不再讀取，避免無界掃描（超過時回 422 由 handle 轉成錯誤）。 */
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
  const departuresQ = t.supabase.from('trip_departures').select('id')
    .eq('tenant_id', t.tenantId).gte('departs_on', today).lte('departs_on', in7);

  const [pendingRes, awaitingRes, depRes] = await Promise.all([pendingQ, awaitingQ, departuresQ]);
  if (pendingRes.error) throw pendingRes.error;
  if (awaitingRes.error) throw awaitingRes.error;
  if (depRes.error) throw depRes.error;

  const departureIds = ((depRes.data ?? []) as { id: string }[]).map((r) => r.id);
  let upcoming7d = 0;
  if (departureIds.length > 0) {
    const { count, error } = await t.supabase.from('tour_orders').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('status', 'CONFIRMED').in('departure_id', departureIds);
    if (error) throw error;
    upcoming7d = count ?? 0;
  }

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
    if (page.length < PAGE || scanned >= MAX_REVENUE_ROWS) break;
  }

  return ok({
    pending: pendingRes.count ?? 0,
    awaitingPayment: awaitingRes.count ?? 0,
    upcoming7d,
    monthRevenue,
  });
});
