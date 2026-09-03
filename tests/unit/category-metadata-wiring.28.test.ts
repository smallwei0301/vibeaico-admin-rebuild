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
    expect(page).toContain('await updateServiceCategory(c.id, { active: nextActive })');
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
    expect(page).toContain('await updateProductCategory(c.id, { active: nextActive })');
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
    expect(products.indexOf('await createProductCategory')).toBeLessThan(
      products.indexOf('onChange(['),
    );
    expect(products.indexOf('await updateProductCategory')).toBeLessThan(
      products.indexOf('onChange(categories.map'),
    );
  });
});
