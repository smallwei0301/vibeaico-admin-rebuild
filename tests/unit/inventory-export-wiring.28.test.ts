import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exportInventoryLogs } from '@/services/reports';
import { fileNameFromContentDisposition } from '@/lib/download';

const read = (path: string) => readFileSync(
  fileURLToPath(new URL(`../../${path}`, import.meta.url)),
  'utf-8',
);
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('inventory export: honest endpoint and page wiring', () => {
  const page = withoutComments(read('src/app/tenant/inventory/page.tsx'));
  const route = withoutComments(read('src/app/api/export/inventory/[format]/route.ts'));
  const reports = withoutComments(read('src/services/reports.ts'));

  it('uses the real inventory endpoint and sends both current filters', () => {
    expect(reports).toMatch(/export const exportInventoryLogs/);
    expect(reports).toMatch(/\/api\/export\/inventory\/\$\{format\}/);
    expect(reports).toMatch(/if \(q\?\.productId\) params\.set\('productId', q\.productId\)/);
    expect(reports).toMatch(/if \(q\?\.type\) params\.set\('type', q\.type\)/);
    expect(page).toMatch(/import \{ exportInventoryLogs \} from '@\/services\/reports'/);
    expect(page).toMatch(/await exportInventoryLogs\(exportFormat, \{/);
    expect(page).toMatch(/productId: productFilter \|\| undefined/);
    expect(page).toMatch(/type: typeFilter \|\| undefined/);
  });

  it('does not claim mock mode downloaded a file or fabricate a filename', async () => {
    await expect(exportInventoryLogs('csv')).resolves.toEqual({ downloaded: false, fileName: '' });
    expect(page).toMatch(/if \(!downloaded\) toast\.show\(t\.messages\.exportNotDownloaded/);
    expect(page).toMatch(/fileName \? t\.messages\.exportedAs\(fileName\) : t\.messages\.exported/);
    expect(page).not.toContain('t.exportFile');
    expect(page).not.toMatch(/const today =/);
  });

  it('accepts only csv/excel and returns a direct CSV attachment response', () => {
    expect(route).toMatch(/new Set\(\['csv', 'excel'\]\)/);
    expect(route).toMatch(/不支援的匯出格式/);
    expect(route).toMatch(/ERR\.VALIDATION/);
    expect(route).toMatch(/'Content-Type': 'text\/csv; charset=utf-8'/);
    expect(route).toMatch(/'Content-Disposition': `attachment;/);
    expect(route).toContain("const csv = '\\uFEFF'");
    expect(route).toMatch(/return new Response\(csv/);
    expect(route).not.toMatch(/return ok\(/);
  });

  it('prefers the server-provided extended filename and never needs a guessed one', () => {
    expect(fileNameFromContentDisposition(
      "attachment; filename=old.csv; filename*=UTF-8''%E5%BA%AB%E5%AD%98.csv",
    )).toBe('庫存.csv');
    expect(fileNameFromContentDisposition('attachment; filename="inventory.csv"'))
      .toBe('inventory.csv');
    expect(fileNameFromContentDisposition(undefined)).toBe('');
  });
});
