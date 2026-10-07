/**
 * 公開下單的金額鎖定（issue #749）：旅客在頁面上看到並確認的總額（expectedTotal），
 * 必須等於實際建立的 `tour_orders.total_amount`。
 *
 * 正式路徑：呼叫 0137 的 `create_tour_order_quoted`——在建單同一個交易內比對，
 * 不符就 raise PRICE_CHANGED（P0004）使整筆 RPC（含 reserve_seats 鎖位）回滾，原子、無 TOCTOU 空窗。
 *
 * 過渡 fallback（非原子）：Production 尚未套用 0137（#755 受控 release）時，PostgREST 會回
 * PGRST202／42883／"Could not find the function"。此時改由 server 端先以與顯示頁相同的規則
 * （loadPlanSeasons + resolveSeasonUnitPrice）預檢目前金額，再呼叫舊 `create_tour_order`。
 * 這條路徑「不是」原子的：預檢到建單之間店家仍可能改價（極小視窗），所以只是 0137 套用前的降級，
 * 0137 套用後永遠走原子路徑。
 */
import { resolveBookingTotal } from '@/lib/public-booking-price';
import { loadPlanSeasons, seasonUnitPriceFor } from '@/server/public-plan-seasons';
import type { createAdminSupabase } from '@/server/supabase';

export type PriceQuote = { unitPrice: number; total: number };

type RpcError = { message?: string; code?: string; details?: string | null } | null;
export type QuotedRpcResult = { data: unknown; error: RpcError };

export type QuotePlan = {
  tenantId: string;
  planId: string;
  pricePerPerson: number;
  priceType: 'PER_PERSON' | 'PER_GROUP';
};

export function isMissingFunctionError(error: RpcError): boolean {
  if (!error) return false;
  const message = String(error.message ?? '');
  return error.code === 'PGRST202' || error.code === '42883' || message.includes('Could not find the function');
}

/** 從 RPC 錯誤的 details（JSON：unitPrice、total）解析現價；解析失敗回 undefined。 */
export function parsePriceChangedQuote(error: RpcError): PriceQuote | undefined {
  try {
    const parsed = JSON.parse(String(error?.details ?? '')) as { unitPrice?: unknown; total?: unknown };
    const unitPrice = Number(parsed.unitPrice);
    const total = Number(parsed.total);
    if (parsed.unitPrice == null || parsed.total == null || !Number.isFinite(unitPrice) || !Number.isFinite(total)) return undefined;
    return { unitPrice, total };
  } catch {
    return undefined;
  }
}

export const PRICE_UNVERIFIABLE_MESSAGE = 'PRICE_UNVERIFIABLE';

/**
 * 依有無 expectedTotal 選 RPC。回傳形狀同 supabase rpc（{ data, error }）；價格不符時 error.message 含
 * PRICE_CHANGED（details 為 JSON 現價），無法確認時 error.message 為 PRICE_UNVERIFIABLE。
 */
export async function createTourOrderWithQuote(
  admin: ReturnType<typeof createAdminSupabase>,
  args: Record<string, unknown>,
  ctx: { expectedTotal?: number; plan: QuotePlan; departsOn: string; partySize: number },
): Promise<QuotedRpcResult> {
  const { expectedTotal } = ctx;
  if (expectedTotal === undefined) return admin.rpc('create_tour_order', args) as unknown as Promise<QuotedRpcResult>;

  const quoted = (await admin.rpc('create_tour_order_quoted', { ...args, p_expected_total: expectedTotal })) as unknown as QuotedRpcResult;
  if (!isMissingFunctionError(quoted.error)) return quoted;

  console.warn('create_tour_order_quoted unavailable; using non-atomic price precheck');
  const seasons = await loadPlanSeasons(admin, ctx.plan.tenantId, ctx.plan.planId);
  // 季節資料不完整：無法確認目前價格，不能放行也不能誤報金額。
  if (seasons.incomplete) return { data: null, error: { message: PRICE_UNVERIFIABLE_MESSAGE } };
  const unitPrice = seasonUnitPriceFor(seasons, ctx.departsOn, ctx.plan.pricePerPerson);
  const current = resolveBookingTotal({ unitPrice }, { pricePerPerson: ctx.plan.pricePerPerson, priceType: ctx.plan.priceType }, ctx.partySize);
  if (current && current.total !== expectedTotal) {
    return { data: null, error: { code: 'P0004', message: 'PRICE_CHANGED', details: JSON.stringify(current) } };
  }
  return admin.rpc('create_tour_order', args) as unknown as Promise<QuotedRpcResult>;
}
