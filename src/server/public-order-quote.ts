/**
 * 公開下單的金額鎖定（issue #749）：旅客在頁面上看到並確認的總額（expectedTotal），
 * 必須等於實際建立的 `tour_orders.total_amount`。
 *
 * 本檔是「送出當下的伺服器端重新報價比對」：有 expectedTotal 時，先以與顯示頁相同的規則
 * （loadPlanSeasons + seasonUnitPriceFor + resolveBookingTotal，方案基本價由呼叫端在同一請求內
 * 重新讀取）算出現價，不符就回 PRICE_CHANGED（帶現價 quote）、不建單；相符才呼叫既有 create_tour_order。
 *
 * 限制（刻意不宣稱原子）：預檢與 create_tour_order 之間仍有極小 TOCTOU 空窗（店家恰好在這幾毫秒內改價）。
 * 此空窗由後續 migration 0137（建單同一交易內原子比對，另一個 PR）收斂；本 PR 不依賴任何新 schema。
 */
import { resolveBookingTotal } from '@/lib/public-booking-price';
import { loadPlanSeasons, seasonUnitPriceFor } from '@/server/public-plan-seasons';
import type { createAdminSupabase } from '@/server/supabase';

export type PriceQuote = { unitPrice: number; total: number };

type RpcError = { message?: string; code?: string; details?: string | null } | null;
/** 形狀同 supabase rpc；價格不符時 error.message 為 PRICE_CHANGED 且 quote 為現價。 */
export type QuotedRpcResult = { data: unknown; error: RpcError; quote?: PriceQuote };

export type QuotePlan = {
  tenantId: string;
  planId: string;
  pricePerPerson: number;
  priceType: 'PER_PERSON' | 'PER_GROUP';
};

export const PRICE_UNVERIFIABLE_MESSAGE = 'PRICE_UNVERIFIABLE';
export const PRICE_CHANGED_MESSAGE = 'PRICE_CHANGED';

export async function createTourOrderWithQuote(
  admin: ReturnType<typeof createAdminSupabase>,
  args: Record<string, unknown>,
  ctx: { expectedTotal?: number; plan: QuotePlan; departsOn: string; partySize: number },
): Promise<QuotedRpcResult> {
  const { expectedTotal } = ctx;
  if (expectedTotal !== undefined) {
    const seasons = await loadPlanSeasons(admin, ctx.plan.tenantId, ctx.plan.planId);
    // 季節資料不完整：無法確認目前價格，不能放行也不能誤報金額。
    if (seasons.incomplete) return { data: null, error: { message: PRICE_UNVERIFIABLE_MESSAGE } };
    const unitPrice = seasonUnitPriceFor(seasons, ctx.departsOn, ctx.plan.pricePerPerson);
    const current = resolveBookingTotal({ unitPrice }, { pricePerPerson: ctx.plan.pricePerPerson, priceType: ctx.plan.priceType }, ctx.partySize);
    if (current && current.total !== expectedTotal) {
      return { data: null, error: { message: PRICE_CHANGED_MESSAGE }, quote: current };
    }
  }
  return admin.rpc('create_tour_order', args) as unknown as Promise<QuotedRpcResult>;
}
