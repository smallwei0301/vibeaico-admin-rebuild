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
    // issue #33 之後這一頁同時接了 csv 與 xlsx 兩支 service，import 改為具名兩個，
    // 實際呼叫哪一支由 `exportFormat` 決定，所以下面改斷言那個分派點。
    expect(page).toContain("from '@/services/inventory-export';");
    expect(page).toContain('exportInventoryCsv');
    expect(page).toContain('exportInventoryXlsx');
    expect(page).toContain("const download = exportFormat === 'xlsx' ? exportInventoryXlsx : exportInventoryCsv;");
    expect(page).toContain('const result = await download({');
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

  /* issue #246：本條原本叫 `keeps the bounded slice CSV-only`，鎖的是
     `if (format !== 'csv')` 且 route 不得出現 `.xlsx`。那個前提是 #150 當時
     刻意收斂範圍，但 14-GAP-AUDIT §8.5 的擁有者裁示是「庫存匯出 CSV 與 Excel
     兩者都做」——裁示從未落地，這條鎖便一直把「只有一半」鎖成正確狀態。

     不刪這條鎖。它真正要守的是兩件事，兩件都保留並加強：
     ① format 走白名單，不得放行任意字串；② CSV 分支的回應慣例一字未改。
     另外補上 xlsx 分支必須是真的 xlsx MIME，而不是換個副檔名的 CSV。 */
  it('whitelists formats and keeps the CSV response contract untouched', () => {
    expect(route).toContain("const SUPPORTED_FORMATS = ['csv', 'xlsx'] as const;");
    expect(route).toContain(
      'if (!(SUPPORTED_FORMATS as readonly string[]).includes(format))',
    );
    // 白名單之外一律 400，而不是落到某個預設分支。
    expect(route).toContain('ERR.VALIDATION');

    expect(route).toContain("'Content-Type': 'text/csv; charset=utf-8'");
    expect(route).toContain("'Cache-Control': 'no-store'");
    // String.raw：要比對的是原始碼裡的跳脫序列本身，不是它代表的字元。
    expect(route).toContain(
      String.raw`const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';`,
    );
    expect(route).toContain('filename="inventory-${taipeiTodayDateString()}.csv"');
  });

  it('serves the Excel half of the §8.5 decision as a real workbook', () => {
    expect(route).toContain("import { buildXlsx, xlsxResponse");
    expect(route).toContain("if (format === 'xlsx')");
    expect(route).toContain('`inventory-${taipeiTodayDateString()}.xlsx`');
    // MIME 由共用工具提供，這裡順帶鎖住它不是隨手寫的字串。
    const xlsx = read('src/server/xlsx.ts');
    expect(xlsx).toContain(
      "'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
    );
    expect(xlsx).toContain("import ExcelJS from 'exceljs';");
    // 兩種格式共用同一份攤平結果，避免欄位在兩條路徑上各自漂移。
    expect(route).toContain('const cells: XlsxCell[][] = rows.map((log) => [');
  });

  it('pages through large result sets instead of silently trusting one response', () => {
    expect(route).toContain('const EXPORT_PAGE_SIZE = 1000;');
    expect(route).toContain('for (let from = 0; ; from += EXPORT_PAGE_SIZE)');
    expect(route).toContain('.order(\'id\', { ascending: false })');
    expect(route).toContain('.range(from, from + EXPORT_PAGE_SIZE - 1)');
    expect(route).toContain('if (pageRows.length < EXPORT_PAGE_SIZE) break;');
  });
});
