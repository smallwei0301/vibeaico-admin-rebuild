// GUIDE（reportingMode = 'GUIDE_TOUR'）首頁統計的 tour_orders 口徑（Issue #942）。
// 導遊的訂單寫在 tour_orders，不是 bookings；首頁數字必須與收件匣（api/guide/action-inbox）
// 與團體訂單報表（server/guide-report）同一份定義：
//  - 今日預約＝今日（Asia/Taipei）出發團次的非取消團體訂單數（trip_departures.departs_on）。
//  - 待確認＝status PENDING 且方案 sales_mode REQUEST（待導遊接受／拒絕的申請，同收件匣 TOUR_REQUEST）。
//  - 本月營收＝本月建立的訂單實收 Σ max(0, paid_amount − refunded_amount)（同 guide-report netReceived）。
import { taipeiMonthRange, taipeiTodayDateString } from '@/server/tz';
import type { requireTenant } from '@/server/tenant';

type Db = Awaited<ReturnType<typeof requireTenant>>['supabase'];

export function countTodayTourDepartureOrders(db: Db, tenantId: string) {
  return db.from('tour_orders')
    .select('id, trip_departures!inner(departs_on)', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .neq('status', 'CANCELLED')
    .eq('trip_departures.departs_on', taipeiTodayDateString());
}

export function countPendingTourRequests(db: Db, tenantId: string) {
  return db.from('tour_orders')
    .select('id, trip_plans!inner(sales_mode)', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'PENDING')
    .eq('trip_plans.sales_mode', 'REQUEST');
}

export function selectMonthTourReceipts(db: Db, tenantId: string) {
  const { fromIso, toIso } = taipeiMonthRange();
  return db.from('tour_orders').select('paid_amount, refunded_amount')
    .eq('tenant_id', tenantId)
    .gte('created_at', fromIso).lt('created_at', toIso);
}

export function sumNetReceived(rows: { paid_amount: unknown; refunded_amount: unknown }[] | null): number {
  return (rows ?? []).reduce((sum, r) => {
    const net = Number(r.paid_amount ?? 0) - Number(r.refunded_amount ?? 0);
    return sum + (Number.isFinite(net) ? Math.max(0, net) : 0);
  }, 0);
}
