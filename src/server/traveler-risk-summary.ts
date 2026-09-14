import { TOUR_ORDER_AUTO_EXPIRE_REASON } from './tour-orders';

export type TravelerRiskFact =
  | { kind: 'COMPLETED'; occurredAt: string }
  | { kind: 'CANCELLED'; actor: 'TRAVELER' | 'GUIDE' | 'SYSTEM' | 'UNKNOWN'; occurredAt: string }
  | { kind: 'NO_SHOW'; occurredAt: string }
  | { kind: 'UNPAID_EXPIRED'; occurredAt: string }
  | { kind: 'REFUND_PENDING'; occurredAt: string }
  | { kind: 'REFUND_DISPUTED'; occurredAt: string }
  | { kind: 'REFUNDED'; occurredAt: string };

export type TravelerRiskSummary = {
  completed: number;
  travelerCancelled: number;
  operatorOrSystemCancelled: number;
  noShow: number;
  unpaidExpired: number;
  refundPendingOrDisputed: number;
  refunded: number;
  lastOccurredAt: string | null;
};

/**
 * Summarizes factual fulfillment outcomes without assigning a score or
 * inferring blame for unclassified cancellations. Invalid timestamps are
 * excluded before they can affect a count or the latest occurrence.
 */
export function summarizeTravelerRiskFacts(facts: readonly TravelerRiskFact[]): TravelerRiskSummary {
  const summary: TravelerRiskSummary = {
    completed: 0,
    travelerCancelled: 0,
    operatorOrSystemCancelled: 0,
    noShow: 0,
    unpaidExpired: 0,
    refundPendingOrDisputed: 0,
    refunded: 0,
    lastOccurredAt: null,
  };
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const fact of facts) {
    const timestamp = Date.parse(fact.occurredAt);
    if (!Number.isFinite(timestamp)) continue;

    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      summary.lastOccurredAt = fact.occurredAt;
    }

    switch (fact.kind) {
      case 'COMPLETED':
        summary.completed += 1;
        break;
      case 'CANCELLED':
        if (fact.actor === 'TRAVELER') summary.travelerCancelled += 1;
        else if (fact.actor === 'GUIDE' || fact.actor === 'SYSTEM') summary.operatorOrSystemCancelled += 1;
        break;
      case 'NO_SHOW':
        summary.noShow += 1;
        break;
      case 'UNPAID_EXPIRED':
        summary.unpaidExpired += 1;
        break;
      case 'REFUND_PENDING':
      case 'REFUND_DISPUTED':
        summary.refundPendingOrDisputed += 1;
        break;
      case 'REFUNDED':
        summary.refunded += 1;
        break;
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// 真實讀取路徑（#44：把上面的純函式接到 tour_orders 真實資料）
// ---------------------------------------------------------------------------
//
// ⚠️ 範圍誠實聲明（不要在下一輪把這段刪掉才發現又要重寫一次）：
//
//   - `NO_SHOW` 目前**永遠不會被產生**。`public.tour_order_status` 只有
//     PENDING/CONFIRMED/COMPLETED/CANCELLED 四個值，現有 schema 沒有任何欄位
//     區分「旅客完全沒出現」與其他終態。這不是漏寫，是 issue #44 依賴的履約
//     出席狀態尚未存在——它屬於 #41 成團／出團生命週期的延伸，本輪邊界明文排除
//     #41。等該欄位落地，這裡補一個 `case` 即可，`TravelerRiskFact` 型別已經
//     預留了 `NO_SHOW`。
//   - `CANCELLED` 的 `actor` 目前只能分辨「系統因逾期未付款自動取消」
//     （`cancel_reason` 逐字等於 `TOUR_ORDER_AUTO_EXPIRE_REASON`）；其餘一律回
//     `UNKNOWN`——`tour_orders` 沒有任何欄位記錄「是導遊按的還是旅客按的」。
//     這不是妥協，是既有 kernel（PR #77 第二則 checkpoint）就明文選擇的設計：
//     「UNKNOWN cancellation 不猜責任」。之後 #41 若補上真正的取消者欄位，
//     `TRAVELER`／`GUIDE` 才會有真實資料可分辨，這裡不先猜。
//   - `REFUND_PENDING`／`REFUND_DISPUTED` 同樣不會被產生：`tour_payment_status`
//     只有 UNPAID/PAID/REFUNDED，沒有「待退款中」與「退款爭議」的中間狀態，
//     那同樣是 #41 的付款生命週期延伸。

/** `loadTravelerRiskSummary()` 需要的 `tour_orders` 欄位子集。 */
type TourOrderRiskRow = {
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  payment_status: 'UNPAID' | 'PAID' | 'REFUNDED';
  cancel_reason: string | null;
  updated_at: string;
};

/**
 * 純函式：把一筆真實 `tour_orders` 列的終態映射成至多一筆 `TravelerRiskFact`。
 * PENDING／CONFIRMED 尚未終結，不產生任何事實（不是「正常」也不是「風險」）。
 * 已退款（無論訂單本身是否也被取消）以 REFUNDED 為準，不與取消／未付款失效
 * 重複計算——Issue #44 §1 明文要求「待退款／已退款」與「爽約」分開，不得混算。
 */
export function mapTourOrderRowToRiskFact(row: TourOrderRiskRow): TravelerRiskFact | null {
  const occurredAt = row.updated_at;
  if (row.payment_status === 'REFUNDED') {
    return { kind: 'REFUNDED', occurredAt };
  }
  if (row.status === 'COMPLETED') {
    return { kind: 'COMPLETED', occurredAt };
  }
  if (row.status === 'CANCELLED') {
    if (row.cancel_reason === TOUR_ORDER_AUTO_EXPIRE_REASON) {
      return { kind: 'UNPAID_EXPIRED', occurredAt };
    }
    return { kind: 'CANCELLED', actor: 'UNKNOWN', occurredAt };
  }
  return null;
}

type AnyClient = { from: (table: string) => any };

/**
 * 真實讀取路徑：查一位旅客在本租戶底下所有 `tour_orders` 的終態，映射並彙總。
 *
 * ⚠️ 呼叫端必須傳入 RLS-respecting 的 session client（`createServerSupabase()`），
 * 而不是 admin client——租戶隔離的真正邊界是 `tour_orders` 既有的 RLS
 * （`is_tenant_member(tenant_id)`），這裡的 `.eq('tenant_id', …)` 只是縮小掃描
 * 範圍，不是安全邊界（與 `expire_tour_order` cron 那段 filter 的定位同理）。
 */
export async function loadTravelerRiskSummary(
  supabase: AnyClient,
  tenantId: string,
  customerId: string,
): Promise<TravelerRiskSummary> {
  const { data, error } = await supabase
    .from('tour_orders')
    .select('status, payment_status, cancel_reason, updated_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId);
  if (error) throw error;

  const facts: TravelerRiskFact[] = [];
  for (const row of (data ?? []) as TourOrderRiskRow[]) {
    const fact = mapTourOrderRowToRiskFact(row);
    if (fact) facts.push(fact);
  }
  return summarizeTravelerRiskFacts(facts);
}
