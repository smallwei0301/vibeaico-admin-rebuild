import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fileNameFromContentDisposition } from '../../src/services/inventory-export';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/inventory/page.tsx');
const route = read('src/app/api/export/inventory/[format]/route.ts');
const listRoute = read('src/app/api/inventory/logs/route.ts');
const copy = read('src/i18n/zh-TW/pages/inventory.ts');

describe('inventory export slice #150', () => {
  it('uses the same mapper for the page list and export route', () => {
    expect(route).toContain("from '@/server/inventory-log'");
    expect(listRoute).toContain("import { mapInventoryLog } from '@/server/inventory-log';");
    expect(listRoute).not.toContain('function mapInventoryLog');
  });

  it('waits for a real download result before showing success', () => {
    expect(page).toContain("import { exportInventoryCsv } from '@/services/inventory-export';");
    expect(page).toContain('const result = await exportInventoryCsv({');
    expect(page).toContain('if (!result.downloaded)');
    expect(page).toContain('t.messages.exportedAs(result.fileName)');
    expect(page).not.toContain('t.exportFile.filename');
    expect(copy).not.toContain('exportFile:');
  });

  it('takes the filename from Content-Disposition without inventing one', () => {
    expect(fileNameFromContentDisposition(
      'attachment; filename="inventory-2026-09-03.csv"',
    )).toBe('inventory-2026-09-03.csv');
    expect(fileNameFromContentDisposition(
      "attachment; filename*=UTF-8''inventory-%E6%B8%AC%E8%A9%A6.csv",
    )).toBe('inventory-測試.csv');
    expect(fileNameFromContentDisposition(null)).toBe('');
  });

  it('keeps the bounded slice CSV-only', () => {
    expect(route).toContain("if (format !== 'csv')");
    expect(route).toContain("'Content-Type': 'text/csv; charset=utf-8'");
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).not.toContain('.xlsx');
  });

  it('pages through large result sets instead of silently trusting one response', () => {
    expect(route).toContain('const EXPORT_PAGE_SIZE = 1000;');
    expect(route).toContain('for (let from = 0; ; from += EXPORT_PAGE_SIZE)');
    expect(route).toContain('.order(\'id\', { ascending: false })');
    expect(route).toContain('.range(from, from + EXPORT_PAGE_SIZE - 1)');
    expect(route).toContain('if (pageRows.length < EXPORT_PAGE_SIZE) break;');
  });
});
