// issue #246 —— 兩個不變量的靜態鎖：
//   ① 「匯出 Excel」的出口必須真的產 xlsx，不得回 CSV。
//   ② 匯出檔名一律來自後端 Content-Disposition，前端不得自組。
//
// ② 之所以需要一條鎖：報表頁先前是 `t.export.fileName(todayFileDate(), ext)`，
// 自己用本機日期拼出「營運報表_YYYYMMDD.xlsx」，而端點回的其實是
// customers-….csv——連副檔名都對不上。那是 14-GAP-AUDIT §7 判準要抓的「捏造檔名」，
// 而它躲在一個真的會下載檔案的按鈕後面，靠「有沒有下載」那一層判準抓不到。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (relative: string) => readFileSync(`${root}${relative}`, 'utf8');

/* 「不得出現」的斷言一律針對去註解後的原始碼。註解裡本來就會提到被移除的舊寫法
   （說明為什麼移除），若不去註解，這種鎖會逼人把解釋刪掉才能通過——那會讓下一個
   人失去知道「這裡為什麼不能寫成那樣」的唯一線索。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const customersRoute = read('src/app/api/export/customers/excel/route.ts');
const inventoryRoute = read('src/app/api/export/inventory/[format]/route.ts');
const download = read('src/services/download.ts');
const reportsService = read('src/services/reports.ts');
const reportsPage = read('src/app/tenant/reports/page.tsx');
const reportsCopy = read('src/i18n/zh-TW/pages/reports.ts');
const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(next, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(next);
  }
  return out;
}

describe('#246 匯出格式與檔名的誠實性', () => {
  it('14-GAP-AUDIT §8.3 裁示的 exceljs 真的裝了', () => {
    expect(pkg.dependencies?.exceljs).toBeTruthy();
  });

  it('顧客名單匯出回 xlsx MIME 與 .xlsx 檔名，不再是 CSV', () => {
    expect(customersRoute).toContain("import { buildXlsx, xlsxResponse");
    expect(customersRoute).toContain('`customers-${taipeiTodayDateString()}.xlsx`');
    // 舊行為的三個指紋都必須消失。
    expect(stripComments(customersRoute)).not.toContain("'Content-Type': 'text/csv; charset=utf-8'");
    expect(stripComments(customersRoute)).not.toContain('.csv"');
    expect(stripComments(customersRoute)).not.toContain('function csvCell');
  });

  it('庫存匯出同時提供 csv 與 xlsx（§8.5 的兩半）', () => {
    expect(inventoryRoute).toContain("const SUPPORTED_FORMATS = ['csv', 'xlsx'] as const;");
    expect(inventoryRoute).toContain("if (format === 'xlsx')");
    expect(inventoryRoute).toContain('`inventory-${taipeiTodayDateString()}.xlsx`');
  });

  it('下載工具只從 Content-Disposition 取檔名', () => {
    expect(download).toContain("response.headers.get('Content-Disposition')");
    expect(download).toContain('if (fileName) anchor.download = fileName;');
    // 沒有任何「組出一個名字」的後路。
    expect(stripComments(download)).not.toMatch(/anchor\.download\s*=\s*[`'"]/);
  });

  it('顧客名單匯出改走同一支下載工具，拿得到真實檔名', () => {
    expect(reportsService).toContain("from '@/services/download'");
    expect(reportsService).toContain(
      'downloadAttachment(`${API_BASE}/api/export/customers/excel`)',
    );
    // window.location.assign 拿不到回應標頭，正是報表頁只能自己編檔名的原因。
    expect(stripComments(reportsService)).not.toContain('window.location.assign');
  });

  it('報表頁顯示後端給的檔名，沒有檔名就只報成功', () => {
    expect(reportsPage).toContain('t.export.successAs(result.fileName)');
    expect(reportsPage).toContain('result?.fileName ?');
    expect(stripComments(reportsPage)).not.toContain('todayFileDate');
    // 字典裡不得再有任何「組出一個檔名」的樣板；successAs 只是把後端給的名字
    // 放進句子裡，所以它的參數叫 fileName 是可以的——這裡鎖的是副檔名樣板。
    expect(stripComments(reportsCopy)).not.toMatch(/`[^`]*\$\{[^`]*\}\.(csv|xlsx|xls|\$\{ext\})/);
  });

  it('全 src 沒有任何一處自組匯出檔名', () => {
    // 抓「字串裡直接寫死副檔名並帶變數」這個形狀，例如 `營運報表_${date}.${ext}`。
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const source = stripComments(read(file));
      for (const line of source.split('\n')) {
        // 兩種形狀都算：寫死副檔名（`…${date}.csv`）與變數副檔名（`…${date}.${ext}`）。
        // 後者原本漏掉了——`bookings.ts` 的 exportFileName 就是這個形狀，它零呼叫端
        // 地躺在字典裡，而「字典裡不得再有任何組出檔名的樣板」是本 issue 自己的規則。
        if (/`[^`]*\$\{[^`]*\}\.(csv|xlsx|xls|\$\{\w+\})`/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    // 後端產檔名是正確位置——route（`src/app/api/`）與 route 共用的 server 模組
    // （`src/server/`，例如 export-bookings.ts 的 `bookings-${date}.xlsx`）都算。
    // 本條要鎖的是**前端自組檔名**：那才是 #246 的缺陷，因為前端組出來的名字與
    // 後端 Content-Disposition 實際送出的名字會各走各的、遲早不一致。
    const BACKEND_PREFIXES = ['src/app/api/', 'src/server/'];
    const frontend = offenders.filter(
      (entry) => !BACKEND_PREFIXES.some((prefix) => entry.startsWith(prefix)),
    );
    expect(frontend).toEqual([]);
  });
});
