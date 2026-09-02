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
const TEMP_SORT_ORDER_BASE = -1_000_000_000;

function isMissingRpc(error: DbError | null | undefined, functionName: string): boolean {
  if (!error) return false;
  return error.code === 'PGRST202'
    || new RegExp(`(?:function|rpc)[^\\n]*${functionName}|${functionName}[^\\n]*(?:function|rpc)`, 'i')
      .test(error.message ?? '');
}

function nextOrderValue(values: readonly (number | null | undefined)[]): number {
  const maximum = values.reduce<number>((current, value) => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : -1;
    return Math.max(current, numeric);
  }, -1);
  return Math.floor(maximum) + 1;
}

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

async function readNextServicePositions(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ServicePositions> {
  const { data, error } = await supabase
    .from('services')
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

/**
 * Use the already-deployed atomic catalog allocator when available.  The
 * fallback keeps fresh local runners usable while the historical TEST schema
 * is being reconciled into the canonical migration ledger.
 */
export async function reserveServicePositions(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ServicePositions> {
  const { data, error } = await supabase.rpc('reserve_catalog_positions', {
    p_tenant_id: tenantId,
    p_resource: 'services',
  });
  if (!error) return parsePositions(data);
  if (!isMissingRpc(error, 'reserve_catalog_positions')) throw error;
  return readNextServicePositions(supabase, tenantId);
}

function isServicePositionCollision(error: DbError | null | undefined): boolean {
  return error?.code === '23505'
    && /services_tenant_(?:sort_order|line_sort_order)_uq/i.test(error.message ?? '');
}

/**
 * A local runner may not yet have the historical allocator RPC.  Its unique
 * indexes still make a concurrent MAX+1 race observable; retry only that
 * expected collision and never turn another database error into a retry.
 */
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
 * Use the existing atomic reorder RPC.  The public API historically accepts a
 * partial list, so append untouched tenant services in their current order
 * before calling the RPC.  The local fallback stages each row at a distinct
 * temporary rank before applying the complete ordering.
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
  if (!error) return;
  if (!isMissingRpc(error, 'reorder_catalog_items')) throw error;

  for (const [index, id] of orderedIds.entries()) {
    const { error: stageError } = await supabase
      .from('services')
      .update({ sort_order: TEMP_SORT_ORDER_BASE - index })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (stageError) throw stageError;
  }

  for (const [index, id] of orderedIds.entries()) {
    const { error: finalError } = await supabase
      .from('services')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (finalError) throw finalError;
  }
}
