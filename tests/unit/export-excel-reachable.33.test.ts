import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const bookingsPage = read('src/app/tenant/bookings/page.tsx');
const inventoryPage = read('src/app/tenant/inventory/page.tsx');
const reportsService = read('src/services/reports.ts');
const inventoryService = read('src/services/inventory-export.ts');

/**
 * issue #33：後端做得出 Excel，但**沒有任何呼叫端**——路由存在、單元測試也綠，
 * 使用者卻按不到。這是 PB-027 的「路由存在 ≠ 功能可用」。
 *
 * 所以這一組刻意不斷言「service 裡有 xlsx 字樣」，而是斷言**頁面真的呼叫得到它**：
 * 從按鈕 → handler → service → 帶格式段的端點，整條鏈每一環都要在。
 */
describe('匯出 Excel 真的按得到（#33）', () => {
  it('service 打的是帶格式段的端點（沒有格式段的舊路徑等於那支路由沒人用）', () => {
    expect(stripComments(reportsService)).toContain('/api/export/bookings/${format}');
    expect(stripComments(inventoryService)).toContain('/api/export/inventory/xlsx');
  });

  it('service 用共用的 downloadAttachment，不自己再寫一份下載邏輯', () => {
    const executable = stripComments(reportsService);
    expect(executable).toContain('downloadAttachment(');
    // 自己建 anchor、自己解析 content-disposition 就是第三份複製（見 services/download.ts 檔頭）
    expect(executable, 'reports.ts 又自己建了一次 anchor').not.toMatch(/createElement\('a'\)/);
    expect(executable, 'reports.ts 又自己解析了一次 content-disposition')
      .not.toMatch(/content-disposition/i);
  });

  it('兩頁都有 Excel 按鈕，且各自接到 xlsx service', () => {
    const bookings = stripComments(bookingsPage);
    expect(bookings).toContain('exportBookingsXlsx');
    expect(bookings).toContain('common.exportExcel');
    expect(bookings).toContain("runExport('xlsx')");
    expect(bookings, 'CSV 按鈕不能因此消失').toContain("runExport('csv')");

    const inventory = stripComments(inventoryPage);
    expect(inventory).toContain('exportInventoryXlsx');
    expect(inventory).toContain('t.actions.exportXlsx');
    expect(inventory).toContain("setExportFormat('xlsx')");
    expect(inventory, 'CSV 按鈕不能因此消失').toContain("setExportFormat('csv')");
  });

  it('預約頁的成功訊息用後端回的檔名，不自組', () => {
    const executable = stripComments(bookingsPage);
    expect(executable).toContain('result.fileName');
    expect(executable, '頁面自己組了檔名').not.toContain('t.messages.exportFileName');
  });

  it('庫存的確認框標題會跟著格式走（兩顆按鈕共用一個確認框）', () => {
    const executable = stripComments(inventoryPage);
    expect(executable).toContain('t.confirm.exportTitle(');
    // 寫死成 CSV 的話，按了 Excel 的人會看到一個講錯格式的確認框
    expect(executable).not.toMatch(/title=\{t\.confirm\.exportTitle\}/);
  });
});
