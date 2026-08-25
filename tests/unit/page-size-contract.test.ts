/**
 * 「頁面送出的 size 不得超過端點收得下的上限」靜態鎖
 * -----------------------------------------------------------------------------
 * 來由：2026-08-25 Preview 站頁面層實測（`scripts/verify/preview-*.cjs`）抓到
 * `/tenant/bookings` 與 `/tenant/points` 在部署環境**整頁死掉**——
 * `load()` 送 `size: 200`，端點各自寫死 `.max(100)`，於是清單永遠是空的，
 * 畫面顯示「目前沒有預約 / 共 0 筆」外加一則紅字
 * 「載入預約失敗:Number must be less than or equal to 100」。資料庫裡明明有資料。
 *
 * 為什麼三層測試全部沒抓到（這才是重點）：
 *   - 單元測試不涵蓋頁面
 *   - 整合測試直接打端點，而且用**合法的** size，所以永遠綠
 *   - e2e 只跑測試矩陣點名的頁面
 * 這個 bug 活在「頁面送什麼」與「端點收什麼」之間的縫隙，而那條縫不屬於任何一層。
 *
 * 所以修法不是把兩個數字改成一樣（下次還是會漂），而是讓它們**沒有機會不一樣**：
 * 端點一律用 `pageSizeSchema()`、頁面一律不得超過 `MAX_PAGE_SIZE`，由這支測試鎖住。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { MAX_PAGE_SIZE } from '@/server/paging';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const apiFiles = walk(resolve(ROOT, 'src/app/api'));
const pageFiles = walk(resolve(ROOT, 'src/app/tenant'));

describe('分頁 size 的契約（頁面送的 ≤ 端點收的）', () => {
  it('沒有任何端點自己寫死 size 的上限——一律走 pageSizeSchema()', () => {
    const offenders: string[] = [];
    for (const f of apiFiles) {
      const src = readFileSync(f, 'utf8');
      // 找 `size:` 後面直接接 z.coerce…max(…) 的寫法
      const m = src.match(/size:\s*z\.coerce\.number\(\)[^,\n]*\.max\(\s*\d+\s*\)/g);
      if (m) offenders.push(`${relative(ROOT, f)} → ${m.join(' / ')}`);
    }
    expect(offenders, `這些端點自己寫死了 size 上限，會與頁面漂掉：\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('每一頁送出的 size 都在 MAX_PAGE_SIZE 之內', () => {
    const offenders: string[] = [];
    for (const f of pageFiles) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/size:\s*(\d+)/g)) {
        const n = Number(m[1]);
        if (n > MAX_PAGE_SIZE) offenders.push(`${relative(ROOT, f)} → size: ${n}`);
      }
    }
    expect(offenders, `這些頁面送出的 size 超過端點上限 ${MAX_PAGE_SIZE}，清單會整頁載不出來：\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('MAX_PAGE_SIZE 至少要容得下頁面實際在送的最大值（否則是常數訂太小）', () => {
    let biggest = 0;
    let where = '';
    for (const f of pageFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(/size:\s*(\d+)/g)) {
        if (Number(m[1]) > biggest) { biggest = Number(m[1]); where = relative(ROOT, f); }
      }
    }
    expect(MAX_PAGE_SIZE, `頁面 ${where} 送 ${biggest}，但 MAX_PAGE_SIZE 只有 ${MAX_PAGE_SIZE}`)
      .toBeGreaterThanOrEqual(biggest);
  });
});

/**
 * 同一次 Preview 實測抓到的第二件事：編輯預約視窗的說明文字，與 issue #27 依
 * §8.7／§8.10 做出來的行為互相矛盾——視窗先告知「一定會通知顧客」，送出後卻
 * 依實際情況顯示「未送出顧客通知」。同一個畫面自相矛盾，比單純講錯還糟。
 */
describe('編輯預約視窗的說明與實際行為一致（§8.7／§8.10）', () => {
  const dict = readFileSync(resolve(ROOT, 'src/i18n/zh-TW/pages/bookings.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('不再宣稱「一定會通知」，也不再用「通知顧客」這種已送達的說法', () => {
    expect(dict).not.toContain('系統將自動發送 LINE 通知給顧客');
    expect(dict).not.toContain('此備註會透過 LINE 通知顧客');
  });

  it('說明文字有講出「只改備註不送通知」這個實際行為', () => {
    expect(dict).toMatch(/只調整備註則不會送出通知/);
  });
});
