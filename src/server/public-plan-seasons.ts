/**
 * 預約／申請頁共用：讀取單一方案的啟用季節並依出發日解析單價（規則見 src/lib/public-season-price.ts，
 * 與 canonical 0132 create_tour_order 一致）。查詢條件與詳情 loader 一致：tenant_id、plan_id、active，
 * 上限 1000 列；達上限視為資料可能不完整，fail-closed：不輸出 unitPrice（但仍標 seasonalPricing）。
 */
import type { createAdminSupabase } from '@/server/supabase';
import { resolveSeasonUnitPrice, type PublicSeasonRow } from '@/lib/public-season-price';

const SEASON_QUERY_LIMIT = 1000;

export type LoadedPlanSeasons = { seasons: PublicSeasonRow[]; incomplete: boolean };

export async function loadPlanSeasons(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  planId: string,
): Promise<LoadedPlanSeasons> {
  const { data, error } = await admin.from('trip_plan_seasons')
    .select('id, plan_id, start_month, start_day, end_month, end_day, price_override, sort_order')
    .eq('tenant_id', tenantId)
    .eq('plan_id', planId)
    .eq('active', true)
    .order('id', { ascending: true })
    .range(0, SEASON_QUERY_LIMIT - 1);
  if (error) throw new Error('PUBLIC_BOOKING_QUERY_FAILED:trip_plan_seasons', { cause: error });
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  return {
    incomplete: rows.length >= SEASON_QUERY_LIMIT,
    seasons: rows.map((r) => ({
      id: r.id as string,
      startMonth: Number(r.start_month),
      startDay: Number(r.start_day),
      endMonth: Number(r.end_month),
      endDay: Number(r.end_day),
      priceOverride: r.price_override === null || r.price_override === undefined ? null : Number(r.price_override),
      sortOrder: Number(r.sort_order ?? 0),
    })),
  };
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
