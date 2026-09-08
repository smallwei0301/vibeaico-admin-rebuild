import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { csvCell } from '../../src/server/export-bookings';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const shared = read('src/server/export-bookings.ts');
const plainRoute = read('src/app/api/export/bookings/route.ts');
const formatRoute = read('src/app/api/export/bookings/[format]/route.ts');
const inventoryRoute = read('src/app/api/export/inventory/[format]/route.ts');

describe('issue #33③: /api/export/bookings/:format', () => {
  it('both routes delegate to one shared implementation, not two copies', () => {
    for (const route of [plainRoute, formatRoute]) {
      expect(route).toContain("from '@/server/export-bookings'");
      expect(route).toContain('buildBookingsCsvResponse');
      // 匯出邏輯不得在 route 裡再寫一份
      expect(route).not.toContain('bookings_view');
      expect(route).not.toContain('\\uFEFF');
    }
  });

  it('the format whitelist matches inventory/[format]: csv + xlsx, everything else 400', () => {
    expect(formatRoute).toContain("const SUPPORTED_FORMATS = ['csv', 'xlsx'] as const");
    expect(formatRoute).toContain('ApiHttpError(400');
    expect(formatRoute).toContain('ERR.VALIDATION');
    // 與既有前例同一個判斷形狀，且白名單內容也對齊
    expect(inventoryRoute).toContain('ApiHttpError(400');
    expect(inventoryRoute).toContain("const SUPPORTED_FORMATS = ['csv', 'xlsx'] as const");
  });

  /**
   * 這一組原本斷言的是相反的事：白名單只有 csv、且**不准**出現任何 xlsx 痕跡。
   * 當時的理由是「本專案沒有安裝任何 xlsx 產生器，把 CSV 命名成 .xlsx 是謊報
   * 檔案格式」。前半句在 #246 之後不成立了（`exceljs` 已安裝、`src/server/xlsx.ts`
   * 已有共用產生器），**後半句仍然成立**——所以現在鎖的是「產的是真的活頁簿」，
   * 而不是「不准有 xlsx」。
   */
  it('the excel branch produces a real workbook, not a renamed CSV', () => {
    // 走共用產生器，不在這裡自己拼一份
    expect(shared).toContain("from '@/server/xlsx'");
    expect(shared).toContain('buildXlsx(');
    expect(shared).toContain('xlsxResponse(');
    // xlsx 回應不得帶 CSV 的痕跡：沒有 BOM、沒有 text/csv
    const xlsxFn = shared.slice(shared.indexOf('export async function buildBookingsXlsxResponse'));
    expect(xlsxFn).not.toContain('text/csv');
    expect(xlsxFn).not.toContain('\\uFEFF');
    expect(xlsxFn).not.toContain('csvCell');
  });

  it('csv 與 xlsx 共用同一次查詢與同一份欄位，不各查一遍', () => {
    // 兩個 response builder 都必須走 fetchBookingCells，否則欄位會在兩條路徑上漂移
    const csvFn = shared.slice(
      shared.indexOf('export async function buildBookingsCsvResponse'),
      shared.indexOf('export async function buildBookingsXlsxResponse'),
    );
    const xlsxFn = shared.slice(shared.indexOf('export async function buildBookingsXlsxResponse'));
    for (const [name, fn] of [['csv', csvFn], ['xlsx', xlsxFn]] as const) {
      expect(fn, `${name} 沒有走共用的 fetchBookingCells`).toContain('fetchBookingCells(');
      expect(fn, `${name} 自己又查了一次 bookings_view`).not.toContain('bookings_view');
    }
    // 表頭只有一份
    expect((shared.match(/BOOKING_EXPORT_HEADERS = \[/g) ?? []).length).toBe(1);
  });

  it('公式防護只套在 CSV，不套在 xlsx（套了會把資料改壞）', () => {
    // exceljs 寫進去的字串就是字串，不會被當公式求值；在 xlsx 前置單引號只會讓
    // 店家在 Excel 裡看到多出來的符號。這個分工與 inventory/[format] 的前例一致。
    const cells = shared.slice(
      shared.indexOf('async function fetchBookingCells'),
      shared.indexOf('export async function buildBookingsCsvResponse'),
    );
    expect(cells, 'fetchBookingCells 不該做 CSV 跳脫').not.toContain('csvCell(');
    expect(shared).toContain('只對 CSV 正確');
  });

  it('the CSV is a real file response, not a { success, data } envelope', () => {
    expect(shared).toContain("'Content-Type': 'text/csv; charset=utf-8'");
    expect(shared).toContain("attachment; filename=");
    expect(shared).toContain("'Cache-Control': 'no-store'");
    expect(shared).toContain("'\\uFEFF' + lines.join('\\r\\n')");
    expect(shared).not.toContain('ok(');
  });
});

/**
 * 顧客姓名／電話／服務名稱都可能是顧客自己填的。以 = + - @ 開頭的儲存格會被
 * Excel 與 Google Sheets 當公式求值，所以匯出前必須讓它以文字顯示。
 * 這段防護原本只有 inventory 匯出有，預約匯出漏掉了。
 */
describe('issue #33③: CSV 公式注入防護（本輪順帶補上）', () => {
  it.each(['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)'])('%s 這種攻擊者可控字串會被前置單引號', (payload) => {
    expect(csvCell(payload)).toBe(`'${payload}`);
  });

  it('前面有空白或 tab 也擋得住（Excel 會忽略前導空白再求值）', () => {
    expect(csvCell('  =1+1')).toBe("'  =1+1");
    expect(csvCell('\t@foo')).toBe("'\t@foo");
  });

  it('一般字串不動它', () => {
    expect(csvCell('林美麗')).toBe('林美麗');
    expect(csvCell('0912-345-678')).toBe('0912-345-678');
  });

  it('數字維持數字，不會因為負數被加上引號', () => {
    expect(csvCell(-250)).toBe('-250');
    expect(csvCell(1200)).toBe('1200');
  });

  it('逗號／引號／換行照樣正確跳脫，且與防護疊加時不互相破壞', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=a,b')).toBe(`"'=a,b"`);
  });
});
