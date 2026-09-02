import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogPosition } from '@/lib/catalog-order';

export type CatalogTable = 'services' | 'products' | 'portfolios';

/**
 * Atomically reserve both lanes in the database. Create/duplicate endpoints use
 * this server-authoritative allocator; callers cannot inject a public-only rank
 * and concurrent MAX+1 readers cannot receive the same pair.
 */
export async function nextCatalogPositions(
  supabase: SupabaseClient,
  tenantId: string,
  table: CatalogTable,
): Promise<CatalogPosition> {
  const { data, error } = await supabase.rpc('reserve_catalog_positions', {
    p_tenant_id: tenantId,
    p_resource: table,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { sort_order?: number; line_sort_order?: number }
    | null;
  if (!row || !Number.isInteger(row.sort_order) || !Number.isInteger(row.line_sort_order)) {
    throw new Error('reserve_catalog_positions returned an invalid result');
  }
  const sortOrder = row.sort_order as number;
  const lineSortOrder = row.line_sort_order as number;
  return { sortOrder, lineSortOrder };
}

type CatalogInsertResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

/** The database allocator serializes the pair; a failed insert is not retried with a guessed rank. */
export async function insertCatalogWithPositions<T>(
  supabase: SupabaseClient,
  tenantId: string,
  table: CatalogTable,
  insert: (positions: CatalogPosition) => PromiseLike<CatalogInsertResult<T>> | CatalogInsertResult<T>,
): Promise<{ data: T; positions: CatalogPosition }> {
  const positions = await nextCatalogPositions(supabase, tenantId, table);
  const result = await insert(positions);
  if (!result.error && result.data) return { data: result.data, positions };
  if (result.error) throw result.error;
  throw new Error('catalog insert returned no row');
}
