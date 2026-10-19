/**
 * 公開下單的金額鎖定（issue #749）：旅客在頁面上看到並確認的總額（expectedTotal），
 * 必須等於實際建立的 `tour_orders.total_amount`。
 *
 * - 沒帶 expectedTotal（舊頁面快取）：維持舊路徑，直接呼叫 `create_tour_order`。
 * - 有帶 expectedTotal：呼叫 migration 0137 的 `create_tour_order_quoted`（多一個 p_expected_total）。
 *   RPC 在「建單同一交易」內比對 total_amount，不符就 raise PRICE_CHANGED（errcode P0004，
 *   detail 為 JSON `{unitPrice,total}`）並整筆回滾（不留錯價訂單、不佔名額）。**RPC 是唯一的真相來源**，
 *   沒有 TOCTOU 空窗；本檔把 P0004 轉成既有的 PRICE_CHANGED＋quote，route 層回同一個 409 TOUR_003。
 * - 呼叫 RPC 前保留先前（#813）的伺服器端重讀比對作為 fast path：價格明顯已變時不必進交易、
 *   也不必先佔再放名額；季節資料不完整仍回 PRICE_UNVERIFIABLE（TOUR_004，不建單）。
 *   fast path 通過不代表放行，最終仍以 RPC 為準。
 * - 若 DB 尚未套用 0137（PGRST202／42883），RPC 錯誤原樣拋出（fail-closed，不退回非原子路徑）；
 *   因此本程式必須在 0137 套用到該環境之後才能部署。
 */
import { resolveBookingTotal } from '@/lib/public-booking-price';
import { loadPlanSeasons, seasonUnitPriceFor } from '@/server/public-plan-seasons';
import type { createAdminSupabase } from '@/server/supabase';

export type PriceQuote = { unitPrice: number; total: number; priceType: 'PER_PERSON' | 'PER_GROUP' };

type RpcError = { message?: string; code?: string; details?: string | null } | null;
/** 形狀同 supabase rpc；價格不符時 error.message 為 PRICE_CHANGED 且 quote 為現價。 */
export type QuotedRpcResult = { data: unknown; error: RpcError; quote?: PriceQuote };

export type QuotePlan = {
  tenantId: string;
  planId: string;
};

export const PRICE_UNVERIFIABLE_MESSAGE = 'PRICE_UNVERIFIABLE';
export const PRICE_CHANGED_MESSAGE = 'PRICE_CHANGED';
/** create_tour_order_quoted（0137）價格不符的 Postgres errcode。 */
export const PRICE_CHANGED_CODE = 'P0004';

export async function createTourOrderWithQuote(
  admin: ReturnType<typeof createAdminSupabase>,
  args: Record<string, unknown>,
  ctx: { expectedTotal?: number; plan: QuotePlan; departsOn: string; partySize: number },
): Promise<QuotedRpcResult> {
  const { expectedTotal } = ctx;
  let priceType: PriceQuote['priceType'] = 'PER_PERSON';
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
    priceType = planRow.price_type === 'PER_GROUP' ? 'PER_GROUP' : 'PER_PERSON';
    const unitPrice = seasonUnitPriceFor(seasons, ctx.departsOn, pricePerPerson);
    const current = resolveBookingTotal({ unitPrice }, { pricePerPerson, priceType }, ctx.partySize);
    if (current && current.total !== expectedTotal) {
      return { data: null, error: { message: PRICE_CHANGED_MESSAGE }, quote: { unitPrice: current.unitPrice, total: current.total, priceType } };
    }
  }
  if (expectedTotal === undefined) {
    return admin.rpc('create_tour_order', args) as unknown as Promise<QuotedRpcResult>;
  }
  const result = await admin.rpc('create_tour_order_quoted', { ...args, p_expected_total: expectedTotal }) as unknown as QuotedRpcResult;
  const err = result.error;
  if (err && (err.code === PRICE_CHANGED_CODE || String(err.message ?? '').includes(PRICE_CHANGED_MESSAGE))) {
    // RPC detail 只帶 unitPrice／total；fast path 之後店家可能又改了計價方式，
    // 這裡重讀 price_type，避免把交易內的現價標上過期的計價方式（讀取失敗則沿用先前值）。
    const freshPriceType = await rereadPriceType(admin, ctx.plan);
    return { data: null, error: { ...err, message: PRICE_CHANGED_MESSAGE }, quote: parseQuoteDetail(err.details, freshPriceType ?? priceType) };
  }
  return result;
}

/** 重讀方案計價方式；失敗或找不到回 null，由呼叫端 fallback。 */
async function rereadPriceType(
  admin: ReturnType<typeof createAdminSupabase>,
  plan: QuotePlan,
): Promise<PriceQuote['priceType'] | null> {
  try {
    const { data, error } = await admin.from('trip_plans').select('price_type')
      .eq('id', plan.planId).eq('tenant_id', plan.tenantId).maybeSingle();
    if (error || !data) return null;
    return (data as { price_type?: unknown }).price_type === 'PER_GROUP' ? 'PER_GROUP' : 'PER_PERSON';
  } catch {
    return null;
  }
}

/** 解析 RPC detail（`{"unitPrice":..,"total":..}`）；格式不符回 undefined（route 仍回 TOUR_003，只是不帶 quote）。 */
function parseQuoteDetail(details: string | null | undefined, priceType: PriceQuote['priceType']): PriceQuote | undefined {
  if (!details) return undefined;
  try {
    const d = JSON.parse(details) as { unitPrice?: unknown; total?: unknown };
    const unitPrice = Number(d.unitPrice);
    const total = Number(d.total);
    if (d.unitPrice == null || d.total == null || !Number.isFinite(unitPrice) || !Number.isFinite(total)) return undefined;
    return { unitPrice, total, priceType };
  } catch {
    return undefined;
  }
}
