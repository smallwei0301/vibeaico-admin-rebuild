import type { SupabaseClient } from '@supabase/supabase-js';

export type ServicePositions = {
  sortOrder: number;
  lineSortOrder: number;
};

type DbError = {
  code?: string;
  message?: string;
};

type InsertResult<T> = {
  data: T | null;
  error: DbError | null;
};

const MAX_INSERT_ATTEMPTS = 3;
function parsePositions(data: unknown): ServicePositions {
  const row = (Array.isArray(data) ? data[0] : data) as {
    sort_order?: unknown;
    line_sort_order?: unknown;
  } | null | undefined;
  if (!row || !Number.isInteger(row.sort_order) || !Number.isInteger(row.line_sort_order)) {
    throw new Error('reserve_catalog_positions returned invalid service positions');
  }
  return {
    sortOrder: row.sort_order as number,
    lineSortOrder: row.line_sort_order as number,
  };
}

/**
 * Use the migration-provided atomic catalog allocator.  Both lanes are
 * reserved while the counter row is locked, so concurrent creates cannot
 * receive the same public or LINE position.
 */
export async function reserveServicePositions(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ServicePositions> {
  const { data, error } = await supabase.rpc('reserve_catalog_positions', {
    p_tenant_id: tenantId,
    p_resource: 'services',
  });
  if (error) throw error;
  return parsePositions(data);
}

function isServicePositionCollision(error: DbError | null | undefined): boolean {
  return error?.code === '23505'
    && /services_tenant_(?:sort_order|line_sort_order)_uq/i.test(error.message ?? '');
}

/** Retry only an expected unique-position collision; never hide another DB error. */
export async function insertServiceWithPositions<T>(
  supabase: SupabaseClient,
  tenantId: string,
  insert: (positions: ServicePositions) => PromiseLike<InsertResult<T>> | InsertResult<T>,
): Promise<{ data: T; positions: ServicePositions }> {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const positions = await reserveServicePositions(supabase, tenantId);
    const result = await insert(positions);
    if (!result.error && result.data) return { data: result.data, positions };
    if (!result.error || !isServicePositionCollision(result.error) || attempt === MAX_INSERT_ATTEMPTS - 1) {
      if (result.error) throw result.error;
      throw new Error('service insert returned no row');
    }
  }
  throw new Error('service position allocation retry exhausted');
}

/**
 * Use the atomic reorder RPC.  The public API accepts a partial list, so
 * append untouched tenant services in their current order before calling the
 * complete-collection RPC.  Their relative order is preserved.
 */
export async function reorderServices(
  supabase: SupabaseClient,
  tenantId: string,
  ids: string[],
): Promise<void> {
  const { data: existing, error: listError } = await supabase
    .from('services')
    .select('id, sort_order')
    .eq('tenant_id', tenantId);
  if (listError) throw listError;

  const existingRows = (existing ?? []) as Array<{ id: string; sort_order?: number | null }>;
  const existingIds = existingRows.map((row) => row.id);
  const requested = new Set(ids);
  if (requested.size !== ids.length) {
    throw new Error('catalog reorder must not contain duplicate items');
  }
  if (ids.some((id) => !existingIds.includes(id))) {
    throw new Error('catalog reorder contains an unknown tenant item');
  }
  const currentOrder = [...existingRows]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id))
    .map((row) => row.id);
  const orderedIds = [...ids, ...currentOrder.filter((id) => !requested.has(id))];

  const { error } = await supabase.rpc('reorder_catalog_items', {
    p_tenant_id: tenantId,
    p_resource: 'services',
    p_lane: 'public',
    p_ids: orderedIds,
  });
  if (error) throw error;
}
