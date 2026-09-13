import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * products 的排序取號與重排，走 migration 提供的 catalog 函式。
 *
 * issue #238：products 原本自己算 `sort_order = max+1`、而且**完全沒有處理
 * `line_sort_order`**（於是每筆都是 column default 0）。canonical TEST 上有
 * `products_tenant_line_sort_order_uq`，所以新增第二個商品就 500；正式庫沒有
 * 該索引所以不會 500，但 line_sort_order 全是 0，代表「LINE 商品排序」根本
 * 沒有作用——店家拖曳、存檔、沒報錯，顧客看到的順序卻不是他排的。
 *
 * 這裡照 src/server/service-position.ts 的作法，不另外發明一套：#128 已經把
 * 「唯一排序 + 重新排序」解過一次，函式與 catalog_position_counters 也早就
 * 為 'products' 預留（check 寫的是 services/products/portfolios）。
 */
export type CatalogPositions = {
  sortOrder: number;
  lineSortOrder: number;
};

type DbError = { code?: string; message?: string };
type InsertResult<T> = { data: T | null; error: DbError | null };

const MAX_INSERT_ATTEMPTS = 3;

function parsePositions(data: unknown): CatalogPositions {
  const row = (Array.isArray(data) ? data[0] : data) as {
    sort_order?: unknown;
    line_sort_order?: unknown;
  } | null | undefined;
  if (!row || !Number.isInteger(row.sort_order) || !Number.isInteger(row.line_sort_order)) {
    throw new Error('reserve_catalog_positions returned invalid product positions');
  }
  return {
    sortOrder: row.sort_order as number,
    lineSortOrder: row.line_sort_order as number,
  };
}

/** 兩個 lane 在 counter row 鎖定期間一起配號，併發新增不會拿到同一個位置。 */
export async function reserveProductPositions(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CatalogPositions> {
  return reserveCatalogPositions(supabase, tenantId, 'products');
}

/** portfolios 與 products 是同一個缺陷、同一支函式，只差 resource 名稱。 */
export async function reservePortfolioPositions(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CatalogPositions> {
  return reserveCatalogPositions(supabase, tenantId, 'portfolios');
}

async function reserveCatalogPositions(
  supabase: SupabaseClient,
  tenantId: string,
  resource: 'products' | 'portfolios',
): Promise<CatalogPositions> {
  const { data, error } = await supabase.rpc('reserve_catalog_positions', {
    p_tenant_id: tenantId,
    p_resource: resource,
  });
  if (error) throw error;
  return parsePositions(data);
}

function isPositionCollision(error: DbError | null | undefined): boolean {
  return error?.code === '23505'
    && /(?:products|portfolios)_tenant_(?:sort_order|line_sort_order)_uq/i.test(error.message ?? '');
}

/** 只重試「預期中的位置碰撞」，其他 DB 錯誤一律往上拋，不吞掉。 */
export async function insertProductWithPositions<T>(
  supabase: SupabaseClient,
  tenantId: string,
  insert: (positions: CatalogPositions) => PromiseLike<InsertResult<T>> | InsertResult<T>,
): Promise<{ data: T; positions: CatalogPositions }> {
  return insertWithPositions(supabase, tenantId, 'products', insert);
}

export async function insertPortfolioWithPositions<T>(
  supabase: SupabaseClient,
  tenantId: string,
  insert: (positions: CatalogPositions) => PromiseLike<InsertResult<T>> | InsertResult<T>,
): Promise<{ data: T; positions: CatalogPositions }> {
  return insertWithPositions(supabase, tenantId, 'portfolios', insert);
}

async function insertWithPositions<T>(
  supabase: SupabaseClient,
  tenantId: string,
  resource: 'products' | 'portfolios',
  insert: (positions: CatalogPositions) => PromiseLike<InsertResult<T>> | InsertResult<T>,
): Promise<{ data: T; positions: CatalogPositions }> {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const positions = await reserveCatalogPositions(supabase, tenantId, resource);
    const result = await insert(positions);
    if (!result.error && result.data) return { data: result.data, positions };
    if (!result.error || !isPositionCollision(result.error) || attempt === MAX_INSERT_ATTEMPTS - 1) {
      if (result.error) throw result.error;
      throw new Error(`${resource} insert returned no row`);
    }
  }
  throw new Error(`${resource} position allocation retry exhausted`);
}

/**
 * 走 atomic reorder RPC。對外的 API 允許只送一部分 id，所以先把沒送到的
 * 商品依現有順序接在後面，再呼叫「必須是完整集合」的 RPC，它們的相對順序
 * 保持不變。
 */
export async function reorderProducts(
  supabase: SupabaseClient,
  tenantId: string,
  ids: string[],
): Promise<void> {
  return reorderCatalog(supabase, tenantId, 'products', 'public', ids);
}

/** portfolios 有兩條 lane：公開頁（sort_order）與 LINE（line_sort_order）。 */
export async function reorderPortfolios(
  supabase: SupabaseClient,
  tenantId: string,
  ids: string[],
  lane: 'public' | 'line' = 'public',
): Promise<void> {
  return reorderCatalog(supabase, tenantId, 'portfolios', lane, ids);
}

async function reorderCatalog(
  supabase: SupabaseClient,
  tenantId: string,
  resource: 'products' | 'portfolios',
  lane: 'public' | 'line',
  ids: string[],
): Promise<void> {
  const orderColumn = lane === 'line' ? 'line_sort_order' : 'sort_order';
  const { data: existing, error: listError } = await supabase
    .from(resource)
    .select(`id, ${orderColumn}`)
    .eq('tenant_id', tenantId);
  if (listError) throw listError;

  const existingRows = (existing ?? []) as Array<Record<string, unknown> & { id: string }>;
  const existingIds = existingRows.map((row) => row.id);
  const requested = new Set(ids);
  if (requested.size !== ids.length) {
    throw new Error('catalog reorder must not contain duplicate items');
  }
  if (ids.some((id) => !existingIds.includes(id))) {
    throw new Error('catalog reorder contains an unknown tenant item');
  }
  const currentOrder = [...existingRows]
    .sort((a, b) =>
      (Number(a[orderColumn] ?? 0)) - (Number(b[orderColumn] ?? 0)) || a.id.localeCompare(b.id))
    .map((row) => row.id);
  const orderedIds = [...ids, ...currentOrder.filter((id) => !requested.has(id))];

  const { error } = await supabase.rpc('reorder_catalog_items', {
    p_tenant_id: tenantId,
    p_resource: resource,
    p_lane: lane,
    p_ids: orderedIds,
  });
  if (error) throw error;
}
