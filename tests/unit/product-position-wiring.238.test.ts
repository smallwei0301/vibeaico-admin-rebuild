import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #238 的 products 側在本機**完全沒有鎖**，是變異驗證實測出來的：
 * 把 `src/app/api/products/reorder/route.ts` 退回逐筆 `update({ sort_order: i })`，
 * 全套 1715 條測試依然全綠。唯一會抓到的是
 * `tests/integration/api/product-positions.238.test.ts`，而那支只在 CI 帶 TEST 時才跑。
 *
 * portfolios 有 `portfolio-wiring.7.test.ts` 守著同一件事，products 沒有對應的——
 * 本檔補上，讓兩側的鎖對稱。
 *
 * 鎖的是什麼：POST 與 reorder 都必須走 `src/server/product-position.ts` 的共用 helper，
 * 不得各自回到「自己算 max+1」或「逐筆 update」。那兩種寫法正是 #238 修掉的缺陷：
 *
 *   - 自己算 `sort_order = max+1` 且完全不給 `line_sort_order`（column default 0）
 *     → 在有 `products_tenant_line_sort_order_uq` 的資料庫上第二筆就 500；
 *       在沒有該索引的正式庫不會 500，但「LINE 商品排序」等於沒有作用——
 *       店家拖曳、存檔、沒報錯，顧客看到的順序卻不是他排的。
 *   - 逐筆 `update({ sort_order: i })` → 第一次迭代把某筆設成 0 時，原本就是 0 的
 *     那筆還在 → 23505 → 500。
 */
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const PER_ROW_LOOP = /for \(let i = 0; i < b\.ids\.length; i\+\+\)/;
const SELF_COMPUTED_MAX = /order\('sort_order', \{ ascending: false \}\)/;

describe('#238 products/portfolios 取號與重排一律走共用 helper', () => {
  it('helper 是唯一的取號與重排實作，且兩個 lane 一起配號', () => {
    const helper = read('src/server/product-position.ts');
    expect(helper).toContain("rpc('reserve_catalog_positions'");
    expect(helper).toContain("rpc('reorder_catalog_items'");
    // 兩個 lane 必須一起回，只給 sort_order 就是 #238 的缺陷本體
    expect(helper).toContain('sortOrder');
    expect(helper).toContain('lineSortOrder');
  });

  it('products 的 POST 走 helper，不自己算 max+1', () => {
    const route = read('src/app/api/products/route.ts');
    expect(route).toContain('insertProductWithPositions');
    expect(route).not.toMatch(SELF_COMPUTED_MAX);
  });

  it('portfolios 的 POST 走 helper，不自己算 max+1', () => {
    const route = read('src/app/api/portfolios/route.ts');
    expect(route).toContain('insertPortfolioWithPositions');
    expect(route).not.toMatch(SELF_COMPUTED_MAX);
  });

  it('products 的 reorder 走 helper，逐筆 update 不得復活', () => {
    const route = read('src/app/api/products/reorder/route.ts');
    expect(route).toContain('reorderProducts(t.supabase, t.tenantId, b.ids');
    expect(route).not.toMatch(PER_ROW_LOOP);
    expect(route).not.toMatch(/\.update\(\{ sort_order:/);
  });

  it('三支 route 都保留 MANAGER 與 feature 閘門', () => {
    for (const [path, feature] of [
      ['src/app/api/products/route.ts', 'PRODUCT_SALES'],
      ['src/app/api/products/reorder/route.ts', 'PRODUCT_SALES'],
      ['src/app/api/portfolios/reorder/route.ts', 'PORTFOLIO_SHOWCASE'],
    ] as const) {
      const route = read(path);
      expect(route, path).toContain("requireTenant('MANAGER')");
      expect(route, path).toContain(`requireFeature(t.tenantId, '${feature}')`);
    }
  });
});
