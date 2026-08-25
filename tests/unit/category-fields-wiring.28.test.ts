/**
 * 服務／商品分類欄位接線的不可回歸測試（GitHub issue #28 第 ⑨ 筆）
 * -----------------------------------------------------------------------------
 * 修改前：分類管理 modal 收「說明」（服務）與「排序／啟用」（商品），新增後
 * 顯示「分類已新增」並把值列進表格——但 service 層 `createServiceCategory(name)`
 * 只送 name，端點 `createSchema = z.object({ name })` 也只 insert name + sort_order。
 * 服務頁載入時甚至硬補 `{ ...c, description: '', active: true }`，等於把剛存的值
 * 抹掉；商品端點的 GET 直接硬回 `active: true`（route.ts 的註解自己寫「已回報」）。
 * 使用者填的說明與啟用重新整理就消失。
 *
 * 欄位是否真的落到資料庫，由整合測試
 * tests/integration/api/category-fields.28.test.ts 驗（新增後 service role 直查）。
 * 這裡驗的是三段鏈路（頁面 → service → 端點 body）沒有任何一段把欄位丟掉。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('服務分類：說明欄位從頁面一路送到 insert（issue #28 第 ⑨ 筆）', () => {
  const page = withoutComments(src('src/app/tenant/services/page.tsx'));
  const service = withoutComments(src('src/services/catalog.ts'));
  const route = withoutComments(src('src/app/api/service-categories/route.ts'));

  it('頁面 create() 把 description 帶進 createServiceCategory', () => {
    expect(page).toMatch(/createServiceCategory\(\{\s*name: trimmed,\s*description: trimmedDescription/);
    // 修改前的樣子：createServiceCategory(trimmed)
    expect(page).not.toMatch(/createServiceCategory\(trimmed\)/);
  });

  it('頁面載入時不再把後端回的 description/active 覆寫成預設值', () => {
    // 修改前的樣子：setCategories(list.map((c) => ({ ...c, description: '', active: true })))
    expect(page).not.toMatch(/list\.map\(\(c\) => \(\{ \.\.\.c,/);
    expect(page).toMatch(/if \(list\) setCategories\(list\)/);
  });

  it('service 層 body 帶 description/active，端點 schema 也收', () => {
    expect(service).toMatch(/ServiceCategoryInput = \{[\s\S]*description\?: string;[\s\S]*active\?: boolean;/);
    expect(service).toMatch(/request<\{ id: string; sortOrder: number \}>\('\/api\/service-categories'/);
    expect(route).toMatch(/const createSchema = z\.object\(\{[\s\S]*description: z\.string\(\)[\s\S]*active: z\.boolean\(\)/);
  });

  it('端點 insert 真的寫入 description/active，GET 也真的讀回來', () => {
    expect(route).toMatch(/\.insert\(\{[\s\S]*description: b\.description \?\? '',[\s\S]*active: b\.active \?\? true,/);
    expect(route).toMatch(/description: \(r\.description \?\? ''\) as string/);
    expect(route).toMatch(/active: \(r\.active \?\? true\) as boolean/);
  });
});

describe('商品分類：排序與啟用從頁面一路送到 insert（issue #28 第 ⑨ 筆）', () => {
  const page = withoutComments(src('src/app/tenant/products/page.tsx'));
  const service = withoutComments(src('src/services/products.ts'));
  const route = withoutComments(src('src/app/api/product-categories/route.ts'));

  it('頁面 create() 把 active/sortOrder 帶進 createProductCategory', () => {
    expect(page).toMatch(/createProductCategory\(\{[\s\S]*name: name\.trim\(\),[\s\S]*active,[\s\S]*sortOrder:/);
    // 修改前的樣子：createProductCategory(name.trim())
    expect(page).not.toMatch(/createProductCategory\(name\.trim\(\)\)/);
  });

  it('頁面用後端回的 sortOrder，不自己猜一個顯示', () => {
    expect(page).toMatch(/sortOrder: savedSortOrder/);
    expect(page).not.toMatch(/sortOrder: Number\(sortOrder\) \|\| categories\.length \+ 1/);
  });

  it('service 層 body 帶 active/sortOrder，端點 schema 也收', () => {
    expect(service).toMatch(/ProductCategoryInput = \{[\s\S]*active\?: boolean;[\s\S]*sortOrder\?: number;/);
    expect(route).toMatch(/active: z\.boolean\(\)\.optional\(\)/);
    expect(route).toMatch(/sortOrder: z\.number\(\)\.int\(\)\.optional\(\)/);
  });

  it('GET 不再硬回 active: true（修改前 mapper 寫死的假值）', () => {
    expect(route).not.toMatch(/active: true,\s*sortOrder: r\.sort_order/);
    expect(route).toMatch(/active: \(r\.active \?\? true\) as boolean/);
  });

  it('端點 insert 真的寫入 active，sortOrder 有帶就照收', () => {
    expect(route).toMatch(/\.insert\(\{[\s\S]*active: b\.active \?\? true,[\s\S]*sort_order: b\.sortOrder \?\? \(last\?\.sort_order \?\? 0\) \+ 1,/);
  });
});
