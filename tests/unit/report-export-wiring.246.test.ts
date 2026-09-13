import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'src/app/tenant/reports/page.tsx'), 'utf8');
const service = readFileSync(resolve(process.cwd(), 'src/services/report-export.ts'), 'utf8');
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/export/reports/[format]/route.ts'),
  'utf8',
);

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('real report export wiring (#246 reopen repair)', () => {
  it('reports page calls report export, not customer or booking list exports', () => {
    const executable = stripComments(page);
    expect(page).toContain("import { exportReports } from '@/services/report-export';");
    expect(executable).toContain("ext === 'xlsx' ? 'excel' : 'csv'");
    expect(executable).toContain('rangeDates(range)');
    expect(executable).not.toContain('exportCustomersExcel');
    expect(executable).not.toContain('exportBookingsCsv');
  });

  it('download service uses the canonical reports endpoint and server filename', () => {
    expect(service).toContain('/api/export/reports/${format}');
    expect(service).toContain('downloadAttachment(');
    expect(service).toContain('NOT_DOWNLOADED');
    expect(service).not.toMatch(/\.download\s*=/);
  });

  it('route preserves the retained five report sections', () => {
    for (const section of [
      '營運總覽',
      '每日趨勢',
      '預約時段分布',
      '熱門服務 TOP 5',
      '熱門商品 TOP 10',
    ]) {
      expect(route).toContain(section);
    }
  });

  it('CSV uses current formula-neutralizing helper and Excel uses true xlsx helper', () => {
    expect(route).toContain("import { csvCell } from '@/server/export-bookings';");
    expect(route).toContain("import { buildXlsx, xlsxResponse");
    expect(route).toContain("format === 'excel'");
    expect(route).toContain('reports-${today}.xlsx');
    expect(route).toContain('reports-${today}.csv');
  });

  it('does not restore the historical excel-is-CSV compatibility lie', () => {
    const executable = stripComments(route);
    expect(executable).not.toMatch(/format\s*===\s*['"]excel['"][\s\S]{0,300}text\/csv/i);
    expect(executable).toContain('xlsxResponse(');
  });
});
