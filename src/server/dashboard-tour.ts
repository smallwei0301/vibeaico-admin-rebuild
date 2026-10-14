// GUIDE（reportingMode = 'GUIDE_TOUR'）首頁統計的 tour_orders 口徑（Issue #942）。
// 導遊的訂單寫在 tour_orders，不是 bookings；首頁數字必須與收件匣（api/guide/action-inbox）
// 與團體訂單報表（server/guide-report）同一份定義：
//  - 今日預約＝今日（Asia/Taipei）出發團次的非取消團體訂單數（trip_departures.departs_on）。
//  - 待確認＝status PENDING 且方案 sales_mode REQUEST（待導遊接受／拒絕的申請，同收件匣 TOUR_REQUEST）。
//  - 本月營收＝本月建立的訂單實收 Σ max(0, paid_amount − refunded_amount)（同 guide-report netReceived）。
import { taipeiMonthRange, taipeiTodayDateString } from '@/server/tz';
import { ApiHttpError, ERR } from '@/server/http';
import type { requireTenant } from '@/server/tenant';

type Db = Awaited<ReturnType<typeof requireTenant>>['supabase'];

export function countTodayTourDepartureOrders(db: Db, tenantId: string) {
  return db.from('tour_orders')
    .select('id, trip_departures!inner(departs_on)', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .neq('status', 'CANCELLED')
    .eq('trip_departures.departs_on', taipeiTodayDateString())
    // 已取消的團次（departure_status = CANCELLED）不算今日預約。
    .neq('trip_departures.status', 'CANCELLED');
}

export function countPendingTourRequests(db: Db, tenantId: string) {
  return db.from('tour_orders')
    .select('id, trip_plans!inner(sales_mode)', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'PENDING')
    .eq('trip_plans.sales_mode', 'REQUEST');
}

const PAGE = 1000;
/** 防禦性上限：同 /api/tour-orders/summary，超過就拒絕，絕不靜默少算營收。 */
const MAX_RECEIPT_ROWS = 50_000;

type ReceiptRow = { paid_amount: unknown; refunded_amount: unknown };

/**
 * 本月實收原始列，分頁撈完（PostgREST max_rows=1000 會靜默截短單次回應）。
 * 與 /api/tour-orders/summary 同一套：穩定排序（id）＋range，以「實際回傳筆數」推進 offset、遇空頁才停。
 * 回傳形狀 `{ data, error }` 供 route 的 Promise.all 沿用。
 */
export async function selectMonthTourReceipts(
  db: Db, tenantId: string,
): Promise<{ data: ReceiptRow[]; error: { message: string } | null }> {
  const { fromIso, toIso } = taipeiMonthRange();
  const all: ReceiptRow[] = [];
  let scanned = 0;
  for (;;) {
    const { data, error } = await db.from('tour_orders').select('paid_amount, refunded_amount')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromIso).lt('created_at', toIso)
      .order('id', { ascending: true })
      .range(scanned, scanned + PAGE - 1);
    if (error) return { data: all, error };
    const page = (data ?? []) as ReceiptRow[];
    if (page.length === 0) break;
    all.push(...page);
    scanned += page.length;
    if (scanned > MAX_RECEIPT_ROWS) {
      throw new ApiHttpError(422, '區間內訂單過多，請縮短日期區間', ERR.REPORT_RANGE_TOO_LARGE);
    }
  }
  return { data: all, error: null };
}

export function sumNetReceived(rows: { paid_amount: unknown; refunded_amount: unknown }[] | null): number {
  return (rows ?? []).reduce((sum, r) => {
    const net = Number(r.paid_amount ?? 0) - Number(r.refunded_amount ?? 0);
    return sum + (Number.isFinite(net) ? Math.max(0, net) : 0);
  }, 0);
}
