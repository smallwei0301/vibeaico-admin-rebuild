/**
 * 分類「編輯」鈕的接線不可回歸測試（GitHub issue #28 第 ⑭ 筆）
 * -----------------------------------------------------------------------------
 * 修改前（14 分冊 §6.4「由本輪衍生、尚未處理的三件」第 1 條）：
 *
 *   onClick={() => {
 *     onChange(categories.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
 *     toast.show(t.category.updated);   // 「分類已更新」
 *   }}
 *
 * 只切本地 React state 就宣告「分類已更新」，從未打
 * `PUT /api/{service,product}-categories/:id`——而那支路由的 bodySchema 當時也
 * 只有 `{ name }`，就算打了也收不到。commit 3aee55e（第 ⑨ 筆）把 description /
 * active 變成真的存得進資料庫的欄位之後，使用者更有理由相信這顆按鈕會被保存，
 * **補了一半反而提高誤導性**。
 *
 * 欄位是否真的落到資料庫，由整合測試
 * tests/integration/api/category-edit.28.test.ts 驗（PUT 後 service role 直查）。
 * 這裡驗的是三段鏈路（頁面 handler → services 函式 → 端點 body）沒有一段斷掉，
 * 且成功旗標（toast）排在 await 之後——00 分冊鐵則 12：副作用沒發生就不准報成功。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('服務分類「編輯」鈕真的呼叫端點（issue #28 第 ⑭ 筆）', () => {
  const page = withoutComments(src('src/app/tenant/services/page.tsx'));
  const service = withoutComments(src('src/services/catalog.ts'));
  const route = withoutComments(src('src/app/api/service-categories/[id]/route.ts'));

  it('編輯鈕 onClick 交給 toggleActive，不再是就地改 state 的 onChange', () => {
    expect(page).toMatch(/onClick=\{\(\) => void toggleActive\(c\)\}/);
    // 修改前的樣子（本筆缺陷本體）：onClick 內直接 onChange(...) 再 toast
    expect(page).not.toMatch(
      /onChange\(categories\.map\(\(x\) => \(x\.id === c\.id \? \{ \.\.\.x, active: !x\.active \} : x\)\)\)/,
    );
  });

  it('toggleActive 先 await updateServiceCategory，成功旗標與 toast 才執行', () => {
    const fn = page.match(/const toggleActive = async \(c: ServiceCategory\) => \{[\s\S]*?\n  \};/)?.[0];
    expect(fn).toBeDefined();
    expect(fn!).toMatch(/await updateServiceCategory\(c\.id, \{ active: next \}\)/);
    // 順序：await 在前、畫面更新與 toast 在後（鐵則 12）
    const awaitAt = fn!.indexOf('await updateServiceCategory');
    const toastAt = fn!.indexOf('toast.show(t.category.updated)');
    const stateAt = fn!.indexOf('onChange((list)');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
    expect(stateAt).toBeGreaterThan(awaitAt);
    // 失敗要說失敗，不可吞掉後照樣報成功
    expect(fn!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('service 層 updateServiceCategory 收 patch 物件並整包送出（不再只送 name）', () => {
    expect(service).toMatch(
      /ServiceCategoryUpdate = \{[\s\S]*name\?: string;[\s\S]*description\?: string;[\s\S]*active\?: boolean;/,
    );
    expect(service).toMatch(
      /updateServiceCategory = \(id: string, patch: ServiceCategoryUpdate\)/,
    );
    expect(service).toMatch(/method: 'PUT', body: JSON\.stringify\(patch\)/);
    // 修改前的樣子：(id: string, name: string) → body { name }
    expect(service).not.toMatch(/updateServiceCategory = \(id: string, name: string\)/);
  });

  it('PUT 端點 bodySchema 收 name/description/active 三欄，且不重複收 sortOrder', () => {
    expect(route).toMatch(/name: z\.string\(\)\.min\(1, '請輸入分類名稱'\)\.optional\(\)/);
    expect(route).toMatch(/description: z\.string\(\)\.max\(500\)\.optional\(\)/);
    expect(route).toMatch(/active: z\.boolean\(\)\.optional\(\)/);
    // 排序已有 reorder 端點，不得在這裡開第二條寫入路徑
    expect(route).not.toMatch(/sortOrder/);
  });

  it('PUT 只把有帶的欄位寫進 update（沒帶的維持現值，不重設）', () => {
    expect(route).toMatch(/if \(b\.name !== undefined\) patch\.name = b\.name;/);
    expect(route).toMatch(/if \(b\.description !== undefined\) patch\.description = b\.description;/);
    expect(route).toMatch(/if \(b\.active !== undefined\) patch\.active = b\.active;/);
    expect(route).toMatch(/\.update\(patch\)/);
  });
});

describe('商品分類「編輯」鈕真的呼叫端點（issue #28 第 ⑭ 筆）', () => {
  const page = withoutComments(src('src/app/tenant/products/page.tsx'));
  const service = withoutComments(src('src/services/products.ts'));
  const route = withoutComments(src('src/app/api/product-categories/[id]/route.ts'));

  it('編輯鈕 onClick 交給 toggleActive，不再是就地改 state 的 onChange', () => {
    expect(page).toMatch(/onClick=\{\(\) => void toggleActive\(c\)\}/);
    expect(page).not.toMatch(
      /onClick=\{\(\) => \{\s*onChange\(categories\.map\(\(x\) => \(x\.id === c\.id \? \{ \.\.\.x, active: !x\.active \} : x\)\)\)/,
    );
  });

  it('toggleActive 先 await updateProductCategory，成功旗標與 toast 才執行', () => {
    const fn = page.match(/const toggleActive = async \(c: ProductCategory\) => \{[\s\S]*?\n  \};/)?.[0];
    expect(fn).toBeDefined();
    expect(fn!).toMatch(/await updateProductCategory\(c\.id, \{ active: next \}\)/);
    const awaitAt = fn!.indexOf('await updateProductCategory');
    const toastAt = fn!.indexOf('toast.show(t.category.updated)');
    const stateAt = fn!.indexOf('onChange(categories.map');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(awaitAt);
    expect(stateAt).toBeGreaterThan(awaitAt);
    expect(fn!).toMatch(/catch \(e\) \{[\s\S]*'danger'/);
  });

  it('service 層 updateProductCategory 收 patch 物件並整包送出（不再只送 name）', () => {
    expect(service).toMatch(
      /ProductCategoryUpdate = \{[\s\S]*name\?: string;[\s\S]*description\?: string;[\s\S]*active\?: boolean;/,
    );
    expect(service).toMatch(
      /updateProductCategory = \(id: string, patch: ProductCategoryUpdate\)/,
    );
    expect(service).toMatch(/method: 'PUT', body: JSON\.stringify\(patch\)/);
    expect(service).not.toMatch(/updateProductCategory = \(id: string, name: string\)/);
  });

  it('PUT 端點 bodySchema 收 name/description/active 三欄，且不重複收 sortOrder', () => {
    expect(route).toMatch(/name: z\.string\(\)\.min\(1, '請輸入分類名稱'\)\.optional\(\)/);
    expect(route).toMatch(/description: z\.string\(\)\.max\(500\)\.optional\(\)/);
    expect(route).toMatch(/active: z\.boolean\(\)\.optional\(\)/);
    expect(route).not.toMatch(/sortOrder/);
  });

  it('PUT 只把有帶的欄位寫進 update（沒帶的維持現值，不重設）', () => {
    expect(route).toMatch(/if \(b\.name !== undefined\) patch\.name = b\.name;/);
    expect(route).toMatch(/if \(b\.description !== undefined\) patch\.description = b\.description;/);
    expect(route).toMatch(/if \(b\.active !== undefined\) patch\.active = b\.active;/);
    expect(route).toMatch(/\.update\(patch\)/);
  });
});
