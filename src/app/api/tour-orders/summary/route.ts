import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiTodayDateString } from '@/server/tz';

/**
 * GET /api/tour-orders/summary — 旅遊訂單頁上方四張統計卡的數字。
 *
 * ⚠️ 這支端點存在的理由，就是那四張卡以前算錯的方式：頁面拿**當前這一頁**
 * 的 20 筆去 filter/reduce，然後把結果標成「待處理 / 待收款 / 近 7 天出團 /
 * 本月營收」。第 2 頁以後的訂單完全不在計算裡，數字看起來像全店統計、
 * 其實只是這一頁的統計——而畫面上沒有任何東西透露這件事。
 *
 * 四個數字的定義（與畫面標籤逐一對應）：
 *   pending      status = PENDING
 *   unpaid       payment_status = UNPAID 且 status ≠ CANCELLED（取消的不算待收）
 *   upcoming     status = CONFIRMED 且團次日期落在 今天 ~ 今天+7 天
 *   monthRevenue payment_status = PAID 且成立於本月（台北月份）的 total_amount 總和
 *
 * monthRevenue 用「取回金額欄位後在記憶體加總」而不是 SQL sum()：PostgREST 沒有
 * 直接的聚合語法，而「一個導遊一個月的已付款訂單」是幾十筆等級。
 * 若日後量級改變，改成 DB view 或 rpc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const today = taipeiTodayDateString();
  const in7 = new Date(`${today}T00:00:00Z`);
  in7.setUTCDate(in7.getUTCDate() + 7);
  const in7Date = in7.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [pending, unpaid, upcoming, paid] = await Promise.all([
    t.supabase.from('tour_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('status', 'PENDING'),
    t.supabase.from('tour_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('payment_status', 'UNPAID').neq('status', 'CANCELLED'),
    // !inner：只留下真的 join 到團次、且日期落在區間內的訂單
    t.supabase.from('tour_orders')
      .select('id, trip_departures!inner(departs_on)', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('status', 'CONFIRMED')
      .gte('trip_departures.departs_on', today)
      .lte('trip_departures.departs_on', in7Date),
    t.supabase.from('tour_orders')
      .select('total_amount')
      .eq('tenant_id', t.tenantId).eq('payment_status', 'PAID')
      .gte('created_at', `${monthStart}T00:00:00+08:00`),
  ]);

  for (const r of [pending, unpaid, upcoming, paid]) if (r.error) throw r.error;

  return ok({
    pending: pending.count ?? 0,
    unpaid: unpaid.count ?? 0,
    upcoming: upcoming.count ?? 0,
    monthRevenue: (paid.data ?? []).reduce((sum, r: any) => sum + Number(r.total_amount ?? 0), 0),
  });
});
