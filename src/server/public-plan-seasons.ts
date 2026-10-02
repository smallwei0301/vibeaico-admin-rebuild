/**
 * 預約／申請頁共用：讀取單一方案的啟用季節並依出發日解析單價（規則見 src/lib/public-season-price.ts，
 * 與 canonical 0132 create_tour_order 一致）。查詢條件與詳情 loader 一致：tenant_id、plan_id、active，
 * 上限 1000 列；達上限或查詢失敗視為資料可能不完整，fail-closed：不輸出 unitPrice（但仍標 seasonalPricing）。
 */
import type { createAdminSupabase } from '@/server/supabase';
import { resolveSeasonUnitPrice, type PublicSeasonRow } from '@/lib/public-season-price';

const SEASON_PAGE_SIZE = 1000;
const MAX_SEASON_PAGES = 5;

export type LoadedPlanSeasons = { seasons: PublicSeasonRow[]; incomplete: boolean };

export type PlanSeasonsReader = {
  byPlan: Map<string, PublicSeasonRow[]>;
  /** 該方案的季節資料是否可能不完整（查詢失敗，或落在分頁截斷點及之後）。 */
  isIncomplete: (planId: string) => boolean;
};

function mapSeasonRow(r: Record<string, unknown>): PublicSeasonRow {
  return {
    id: r.id as string,
    startMonth: Number(r.start_month),
    startDay: Number(r.start_day),
    endMonth: Number(r.end_month),
    endDay: Number(r.end_day),
    priceOverride: r.price_override === null || r.price_override === undefined ? null : Number(r.price_override),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

/**
 * 讀一批方案的啟用季節：依 plan_id、id 排序，每頁 1000 列，最多 5 頁。
 * 讀完 5 頁仍是滿頁（可能還有剩）時，只有「最後一筆的 plan_id（含）及排序在它之後」的方案視為不完整；
 * 排序在它之前的方案資料已完整（沒有季節的方案不會被誤標）。查詢失敗：全部視為不完整（降級，不 throw）。
 */
export async function readPlanSeasons(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  planIds: string[],
): Promise<PlanSeasonsReader> {
  const byPlan = new Map<string, PublicSeasonRow[]>();
  if (planIds.length === 0) return { byPlan, isIncomplete: () => false };
  let cutoff: string | null = null;
  for (let page = 0; page < MAX_SEASON_PAGES; page += 1) {
    const from = page * SEASON_PAGE_SIZE;
    const { data, error } = await admin.from('trip_plan_seasons')
      .select('id, plan_id, start_month, start_day, end_month, end_day, price_override, sort_order')
      .eq('tenant_id', tenantId)
      .in('plan_id', planIds)
      .eq('active', true)
      .order('plan_id', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + SEASON_PAGE_SIZE - 1);
    if (error) {
      // 降級而不是 throw：實際金額由 create_tour_order RPC 自己計算，季節資料只用於顯示。季節查詢壞掉不能讓
      // 預約頁、申請頁、詳情頁與送出流程跟著失敗。
      console.warn('public plan seasons query failed; degrading to no unit prices');
      return { byPlan: new Map(), isIncomplete: () => true };
    }
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const r of rows) {
      const list = byPlan.get(r.plan_id as string) ?? [];
      list.push(mapSeasonRow(r));
      byPlan.set(r.plan_id as string, list);
    }
    if (rows.length < SEASON_PAGE_SIZE) return { byPlan, isIncomplete: () => false };
    if (page === MAX_SEASON_PAGES - 1) cutoff = String(rows[rows.length - 1].plan_id).toLowerCase();
  }
  const limit = cutoff;
  return { byPlan, isIncomplete: (planId) => limit !== null && planId.toLowerCase() >= limit };
}

export async function loadPlanSeasons(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  planId: string,
): Promise<LoadedPlanSeasons> {
  const reader = await readPlanSeasons(admin, tenantId, [planId]);
  return { seasons: reader.byPlan.get(planId) ?? [], incomplete: reader.isIncomplete(planId) };
}

/** 有（完整的）季節時回傳該出發日的單價；否則 undefined（沿用基本價）。 */
export function seasonUnitPriceFor(
  loaded: LoadedPlanSeasons,
  departsOn: string,
  basePrice: number,
): number | undefined {
  if (loaded.seasons.length === 0 || loaded.incomplete) return undefined;
  return resolveSeasonUnitPrice(departsOn, loaded.seasons, basePrice);
}

export function hasSeasonalPricing(loaded: LoadedPlanSeasons): boolean {
  return loaded.seasons.length > 0 || loaded.incomplete;
}
