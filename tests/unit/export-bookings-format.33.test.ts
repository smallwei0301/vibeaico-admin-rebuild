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

  it('the format whitelist matches inventory/[format]: csv only, everything else 400', () => {
    expect(formatRoute).toContain("const SUPPORTED_FORMATS = ['csv'] as const");
    expect(formatRoute).toContain('ApiHttpError(400');
    expect(formatRoute).toContain('ERR.VALIDATION');
    // 與既有前例同一個判斷形狀
    expect(inventoryRoute).toContain('ApiHttpError(400');
  });

  it('does not fake an excel branch by renaming a CSV', () => {
    // 只看程式碼，不看註解——「為什麼不做 excel」正是寫在註解裡的，
    // 直接掃全檔會把那段說明本身誤判成違規（本測試第一次就是這樣紅的）。
    const code = formatRoute.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\.xlsx/);
    expect(code).not.toContain("'excel'");
    expect(code).not.toMatch(/spreadsheetml/);
    // 必須把「為什麼不做」寫在檔案裡，而不是靜默省略
    expect(formatRoute).toContain('謊報檔案格式');
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
