import type { SupabaseClient } from '@supabase/supabase-js';
import { nextOrderValue, type CatalogPosition } from '@/lib/catalog-order';

export type CatalogTable = 'services' | 'products' | 'portfolios';

/**
 * Read both lanes from the same catalog query.  Create/duplicate endpoints use
 * these server-authoritative tails; callers cannot inject a public-only rank.
 */
export async function nextCatalogPositions(
  supabase: SupabaseClient,
  tenantId: string,
  table: CatalogTable,
): Promise<CatalogPosition> {
  const { data, error } = await supabase
    .from(table)
    .select('sort_order, line_sort_order')
    .eq('tenant_id', tenantId);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    sort_order?: number | null;
    line_sort_order?: number | null;
  }>;
  return {
    sortOrder: nextOrderValue(rows.map((row) => row.sort_order)),
    lineSortOrder: nextOrderValue(rows.map((row) => row.line_sort_order)),
  };
}
