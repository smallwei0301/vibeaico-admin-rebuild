import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL('../../' + relative, import.meta.url)), 'utf-8');

describe('Issue #28 category metadata wiring', () => {
  it('keeps service category metadata in the API and UI path', () => {
    const route = read('src/app/api/service-categories/route.ts');
    const detailRoute = read('src/app/api/service-categories/[id]/route.ts');
    const service = read('src/services/catalog.ts');
    const page = read('src/app/tenant/services/page.tsx');

    expect(route).toContain('description: b.description ?? \'\'');
    expect(route).toContain('active: b.active ?? true');
    expect(route).toContain('description: (r.description ?? \'\') as string');
    expect(detailRoute).toContain('updates.description = b.description');
    expect(detailRoute).toContain('updates.active = b.active');
    expect(service).toContain('export type ServiceCategoryInput');
    expect(service).toContain('body: JSON.stringify(input)');
    expect(page).toContain('await createServiceCategory({');
    expect(page).toContain('description: categoryDescription');
    // issue #28 第 ⑭ 筆：編輯按鈕開真的表單，送出 name/description/active 三欄，
    // 不再只是把 active 取反（那顆假編輯鈕永遠改不了名稱與描述）。
    expect(page).toContain('await updateServiceCategory(editTarget.id, {');
    expect(page).toContain('name: trimmed, description: categoryDescription, active: editActive,');
  });

  it('keeps product category description, status and order persistent', () => {
    const route = read('src/app/api/product-categories/route.ts');
    const detailRoute = read('src/app/api/product-categories/[id]/route.ts');
    const service = read('src/services/products.ts');
    const page = read('src/app/tenant/products/page.tsx');

    expect(route).toContain('description: b.description ?? \'\'');
    expect(route).toContain('active: b.active ?? true');
    expect(route).toContain('sort_order: b.sortOrder ??');
    expect(detailRoute).toContain('updates.sort_order = b.sortOrder');
    expect(service).toContain('export type ProductCategoryInput');
    expect(service).toContain('body: JSON.stringify(input)');
    expect(page).toContain('id="catDescription"');
    expect(page).toContain('description: categoryDescription');
    expect(page).toContain('await updateProductCategory(editTarget.id, {');
    expect(page).toContain('name: trimmed, description: categoryDescription, active: editActive,');
  });

  it('updates visible category state only after the write resolves', () => {
    const services = read('src/app/tenant/services/page.tsx');
    const products = read('src/app/tenant/products/page.tsx');

    expect(services.indexOf('await createServiceCategory')).toBeLessThan(
      services.indexOf('onChange((list) => ['),
    );
    expect(services.indexOf('await reorderServiceCategories')).toBeLessThan(
      services.indexOf('onChange(next.map'),
    );
    expect(services.indexOf('await updateServiceCategory')).toBeLessThan(
      services.indexOf('onChange((list) => list.map'),
    );
    expect(products.indexOf('await createProductCategory')).toBeLessThan(
      products.indexOf('onChange(['),
    );
    expect(products.indexOf('await updateProductCategory')).toBeLessThan(
      products.indexOf('onChange(categories.map'),
    );
  });

  it('opens a real edit form (name + description + active) instead of a fake toggle', () => {
    const services = read('src/app/tenant/services/page.tsx');
    const products = read('src/app/tenant/products/page.tsx');

    for (const page of [services, products]) {
      // 舊的假編輯：點 pencil 只呼叫 `const nextActive = !c.active` 就送出——
      // 不應該再出現，否則代表編輯鈕又退回只切換啟用狀態。
      expect(page).not.toContain('const nextActive = !c.active');
      expect(page).toContain('const openEdit = (c: ');
      expect(page).toContain('setEditName(c.name)');
      expect(page).toContain('setEditDescription(c.description ?? \'\')');
      expect(page).toContain('setEditActive(c.active)');
      expect(page).toContain('onClick={() => openEdit(c)}');
      // 失敗時顯示真實錯誤訊息，不是假成功 toast。
      expect(page).toContain('setEditError(e instanceof Error ? e.message : t.messages.unknownError)');
    }
  });
});
