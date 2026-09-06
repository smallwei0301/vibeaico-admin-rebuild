import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/customers/page.tsx');
const copy = read('src/i18n/zh-TW/pages/customers.ts');

describe('customer export #28④', () => {
  it('connects the customer page to the existing server export service', () => {
    expect(page).toContain("import { exportCustomersExcel } from '@/services/reports';");
    expect(page).toContain('void exportCustomersExcel().catch(() => {');
    expect(page).toContain("toast.show(t.messages.exportFailed, 'danger')");
  });

  it('does not construct a fabricated client-side filename', () => {
    expect(page).not.toContain('t.exportFile.filename');
    expect(page).not.toContain('顧客清單_');
    expect(copy).not.toContain('exportFile:');
    expect(copy).not.toContain("exported: '顧客匯出成功'");
    expect(copy).not.toContain('.xlsx');
  });
});
