/**
 * 公開下單的金額鎖定（issue #749）：旅客在頁面上看到並確認的總額（expectedTotal），
 * 必須等於實際建立的 `tour_orders.total_amount`。
 *
 * 本檔是「送出當下的伺服器端重新報價比對」：有 expectedTotal 時，於呼叫 create_tour_order 前，
 * 重新讀取 `trip_plans` 的方案價（price_per_person／price_type）並與季節價（loadPlanSeasons）並行讀取，
 * 以與顯示頁相同的規則（seasonUnitPriceFor + resolveBookingTotal）用這次讀到的值算出現價；
 * 不符就回 PRICE_CHANGED（帶現價 quote）、不建單；相符才呼叫既有 create_tour_order。
 * 讀取失敗或找不到方案一律 PRICE_UNVERIFIABLE（不建單）。
 *
 * 限制（刻意不宣稱原子）：比對使用建單前一刻重新讀取的值，剩餘空窗為「這兩次讀取到 create_tour_order
 * 執行之間」（一次網路往返等級），店家若恰在此區間改價仍可能漏接，故仍非原子。
 * 原子保證由後續 migration 0137（建單同一交易內比對）＋ ACTIVATE 收斂；本 PR 不依賴任何新 schema。
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
    const [seasons, planRead] = await Promise.all([
      loadPlanSeasons(admin, ctx.plan.tenantId, ctx.plan.planId),
      admin.from('trip_plans').select('price_per_person, price_type')
        .eq('id', ctx.plan.planId).eq('tenant_id', ctx.plan.tenantId).maybeSingle(),
    ]);
    const planRow = planRead.error ? null : (planRead.data as { price_per_person?: unknown; price_type?: unknown } | null);
    // 方案價讀取失敗／找不到，或季節資料不完整：無法確認目前價格，不能放行也不能誤報金額。
    if (!planRow || seasons.incomplete) return { data: null, error: { message: PRICE_UNVERIFIABLE_MESSAGE } };
    const pricePerPerson = Number(planRow.price_per_person ?? 0);
    const priceType = planRow.price_type === 'PER_GROUP' ? 'PER_GROUP' : 'PER_PERSON';
    const unitPrice = seasonUnitPriceFor(seasons, ctx.departsOn, pricePerPerson);
    const current = resolveBookingTotal({ unitPrice }, { pricePerPerson, priceType }, ctx.partySize);
    if (current && current.total !== expectedTotal) {
      return { data: null, error: { message: PRICE_CHANGED_MESSAGE }, quote: current };
    }
  }
  return admin.rpc('create_tour_order', args) as unknown as Promise<QuotedRpcResult>;
}
