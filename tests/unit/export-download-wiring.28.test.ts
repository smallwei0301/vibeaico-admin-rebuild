/**
 * 三處匯出鈕的接線與「檔名從哪來」靜態鎖 — issue #28 ③④⑤
 * -----------------------------------------------------------------------------
 * 修改前這三顆鈕**什麼都沒下載**：
 *   bookings  `onClick={() => { setExportOpen(false); toast.show(t.messages.exported) }}`
 *   customers `toast.show('顧客匯出成功 顧客清單_20260825.xlsx')`
 *   inventory `toast.show('異動記錄匯出成功 庫存異動_20260825.csv')`
 * 後兩者更嚴重：**憑空報出一個具體檔名**，而伺服器實際送出的是
 * `customers-2026-08-25.csv`——連副檔名都不同。那是 CLAUDE.md「絕不用貌似
 * 合理的佔位值」的教科書案例。
 *
 * 本檔鎖三件事：
 *   ① `fileNameFromContentDisposition()` 真的從標頭解析檔名（純函式，直接呼叫）
 *   ② 三頁的匯出 handler 都 `await` 了對應的 service 函式，成功訊息排在它之後
 *   ③ i18n 字典裡不再有「前端自組檔名」的產生器，也沒有任何頁面自行拼檔名
 *
 * ⚠️ ② ③ 用靜態原始碼比對：vitest 跑在 node 環境、專案沒有 jsdom 也沒有
 * @testing-library/react，掛載元件不可行（同 ops-pages-wiring.07 等既有作法，
 * 14 分冊 §7.2）。真的有沒有下載檔案由 Playwright 實測（scripts/verify/）。
 *
 * 變異驗證（實跑確認會轉紅，輸出貼在 issue #28 留言）：
 *   - 把 customers 的 `await exportCustomersExcel()` 拿掉、改回只 toast → ② 紅
 *   - 把 `fileNameFromContentDisposition` 改成回傳前端自組的日期檔名 → ① 紅
 *   - 把 inventory i18n 的 `exportFile.filename()` 加回來 → ③ 紅
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fileNameFromContentDisposition } from '@/lib/download';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，免得「解釋為什麼不能這樣寫」的說明被當成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGES = {
  bookings: 'src/app/tenant/bookings/page.tsx',
  customers: 'src/app/tenant/customers/page.tsx',
  inventory: 'src/app/tenant/inventory/page.tsx',
} as const;

const I18N = {
  bookings: 'src/i18n/zh-TW/pages/bookings.ts',
  customers: 'src/i18n/zh-TW/pages/customers.ts',
  inventory: 'src/i18n/zh-TW/pages/inventory.ts',
} as const;

/** 抓某個 `const <name> = async (…) => { … };`（頂層兩格縮排的收尾） */
function asyncFn(code: string, name: string): string | undefined {
  const re = new RegExp(`const ${name} = async \\([\\s\\S]*?\\n  \\};`);
  return code.match(re)?.[0];
}

/* ========================================================================== */
/* ① 檔名解析：唯一的檔名來源                                                   */
/* ========================================================================== */

describe('fileNameFromContentDisposition：檔名只能從伺服器標頭來', () => {
  it('標準的 attachment; filename="…"', () => {
    expect(fileNameFromContentDisposition('attachment; filename="bookings-2026-08-25.csv"'))
      .toBe('bookings-2026-08-25.csv');
  });

  it('沒有引號的 filename=…', () => {
    expect(fileNameFromContentDisposition('attachment; filename=inventory-2026-08-25.csv'))
      .toBe('inventory-2026-08-25.csv');
  });

  it('RFC 5987 的 filename*=UTF-8\'\'… 優先，且百分比編碼會解回中文', () => {
    const header = 'attachment; filename="fallback.csv"; '
      + "filename*=UTF-8''%E9%A0%90%E7%B4%84%E6%B8%85%E5%96%AE.csv";
    expect(fileNameFromContentDisposition(header)).toBe('預約清單.csv');
  });

  it('沒有標頭 / 沒有 filename → 空字串（不編一個看起來合理的檔名）', () => {
    expect(fileNameFromContentDisposition(null)).toBe('');
    expect(fileNameFromContentDisposition('attachment')).toBe('');
  });

  it('src/lib/download.ts 不得自行組檔名：沒有任何日期字串樣板', () => {
    const code = withoutComments(src('src/lib/download.ts'));
    expect(code).not.toMatch(/new Date\(/);
    expect(code).toContain("res.headers.get('Content-Disposition')");
  });
});

/* ========================================================================== */
/* ② 三頁真的打端點，成功訊息排在 await 之後                                    */
/* ========================================================================== */

describe('三頁的匯出 handler 都 await 了 service，成功訊息不早於它（鐵則 12）', () => {
  const cases = [
    { key: 'bookings', fn: 'runExport', service: 'exportBookingsCsv' },
    { key: 'customers', fn: 'exportExcel', service: 'exportCustomersExcel' },
    { key: 'inventory', fn: 'runExport', service: 'exportInventoryLogs' },
  ] as const;

  for (const c of cases) {
    it(`${c.key}：await ${c.service}(...) 在成功 toast 之前`, () => {
      const code = withoutComments(src(PAGES[c.key]));
      expect(code, `${PAGES[c.key]} 沒有 import ${c.service}`)
        .toMatch(new RegExp(`import \\{[^}]*${c.service}[^}]*\\} from '@/services/reports'`));

      const handler = asyncFn(code, c.fn);
      expect(handler, `${PAGES[c.key]} 找不到 ${c.fn} handler`).toBeTruthy();

      const awaitAt = handler!.indexOf(`await ${c.service}(`);
      const toastAt = handler!.indexOf('exportedAs');
      expect(awaitAt, `${c.key}：handler 內沒有 await ${c.service}(`).toBeGreaterThan(-1);
      expect(toastAt, `${c.key}：handler 內沒有成功訊息`).toBeGreaterThan(-1);
      expect(awaitAt).toBeLessThan(toastAt);
    });

    it(`${c.key}：downloaded 為 false（示範資料模式）時顯示未匯出，不顯示成功`, () => {
      const handler = asyncFn(withoutComments(src(PAGES[c.key])), c.fn)!;
      expect(handler).toContain('if (!downloaded)');
      expect(handler).toContain('exportNotDownloaded');
    });
  }

  it('services/reports.ts 的匯出改走 downloadAttachment，不再用導頁式下載', () => {
    const code = withoutComments(src('src/services/reports.ts'));
    expect(code).not.toContain('window.location.assign');
    for (const fn of ['exportCustomersExcel', 'exportBookingsCsv', 'exportInventoryLogs', 'exportReports']) {
      expect(code, `${fn} 沒有走 downloadAttachment`).toMatch(
        new RegExp(`export const ${fn} =[\\s\\S]*?downloadAttachment\\(`),
      );
    }
  });
});

/* ========================================================================== */
/* ③ 前端不得自組檔名                                                          */
/* ========================================================================== */

describe('捏造的檔名已經清掉，且沒有任何地方重新長出來', () => {
  it('i18n：三頁都沒有「用日期拼檔名」的產生器', () => {
    for (const [key, path] of Object.entries(I18N)) {
      const code = src(path);
      expect(code, `${path} 仍有 exportFile.filename()`).not.toMatch(/exportFile:\s*\{/);
      expect(code, `${path} 仍有 exportFileName()`).not.toMatch(/exportFileName:/);
      expect(code, `${key} 的字典裡仍有捏造檔名樣板`).not.toMatch(/`[^`]*_\$\{date\}\.(xlsx|csv)`/);
    }
  });

  it('頁面：三頁都沒有把日期塞進檔名的字串拼接', () => {
    for (const [key, path] of Object.entries(PAGES)) {
      const code = withoutComments(src(path));
      expect(code, `${key} 仍在自組檔名`).not.toMatch(/exportFile\.filename/);
      expect(code, `${key} 仍有 .xlsx 字面量`).not.toMatch(/\.xlsx/);
    }
  });

  it('顧客頁的成功訊息用的是回傳的 fileName，不是任何本地變數', () => {
    const handler = asyncFn(withoutComments(src(PAGES.customers)), 'exportExcel')!;
    expect(handler).toContain('const { downloaded, fileName } = await exportCustomersExcel()');
    expect(handler).toContain('t.messages.exportedAs(fileName)');
  });
});
