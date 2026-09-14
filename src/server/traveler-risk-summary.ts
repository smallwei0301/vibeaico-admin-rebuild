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
//   - `REFUND_DISPUTED` 仍然不會被產生：`tour_payment_status` 沒有「退款爭議」
//     這個中間狀態，那屬於更後面的退款流程（18 分冊 §9），不在 #41 0108 的
//     範圍內。
//   - ⚠️ `REFUND_PENDING` 這一條在 #41 0108（`supabase/migrations/
//     0108_issue_41_payment_state_model.sql`）之後**已經可以出現**——
//     `tour_payment_status` 補上了 PARTIAL／REFUND_PENDING 兩個標籤。下面的
//     `TourOrderRiskRow.payment_status` 型別與 `mapTourOrderRowToRiskFact()`
//     已同步更新，不再假設只有 UNPAID/PAID/REFUNDED 三種值（Final Risk
//     claude-fable-5-1，2026-09-14 指出這裡原本仍是舊契約，且 `REFUND_PENDING`
//     搭配 `status=CANCELLED` 時會誤落進 `CANCELLED` 分支，見下方函式內註解）。

/** `loadTravelerRiskSummary()` 需要的 `tour_orders` 欄位子集。 */
type TourOrderRiskRow = {
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  payment_status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED';
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
  // ⚠️ 這條必須排在 `status === 'CANCELLED'` 之前。#41 0108 之後
  // REFUND_PENDING 訂單常見的真實形狀是「先取消、再進入退款流程」
  // （status=CANCELLED, payment_status=REFUND_PENDING）；退款事實優先於單純的
  // 取消事實，理由與上面 REFUNDED 完全一樣——不與取消／未付款失效重複計算
  // （Issue #44 §1）。Final Risk（claude-fable-5-1，2026-09-14）指出修正前
  // 這種列會落進下面的 `status === 'CANCELLED'` 分支、被誤記為單純取消，
  // 退款中的事實整筆遺失。
  if (row.payment_status === 'REFUND_PENDING') {
    return { kind: 'REFUND_PENDING', occurredAt };
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
