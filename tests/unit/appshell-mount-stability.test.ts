/**
 * AppShell 頁面掛載穩定性 — 不可回歸測試
 * -----------------------------------------------------------------------------
 * 守的 bug：`<main>` 用 `current.id` 當 key（切換店家要重新掛載頁面，這是刻意的），
 * 但 real 模式第一次 render 時 `/api/auth/my-tenants` 還沒回來，`current.id` 是
 * 空字串；清單一回來 id 變成真的 tenant id → key 改變 → 整個頁面 subtree 重新
 * 掛載 → 使用者填到一半的表單、開著的確認視窗被清空。慢網路下打字快一點必踩。
 *
 * 因此本檔同時守住兩件互相拉扯的事：
 *   ① key 必須留著（拿掉 key＝切到同業態的示範店家時頁面不重掛載，舊 bug 復活）；
 *   ② 有 key 就必須有「店家身分定案前不掛載頁面」的閘門，否則載入過渡會被
 *      當成一次假的店家切換。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有 jsdom、也沒有
 *    @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件
 *    （既有的 tests/unit/honest-not-built-*.test.ts 也記了同一個限制）。
 *    這一層測的是「原始碼中不存在未經閘門就掛載頁面的路徑」；
 *    實際互動層的證據見 scripts/verify/appshell-mount-stability.cjs
 *    （對真的跑起來的站台實測「載入完成不會清空對話框／表單」）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { common } from '@/i18n/zh-TW/common';

const SOURCE = 'src/components/layout/AppShell.tsx';

/** 去掉註解，避免「解釋為什麼不能這樣寫」的註解被當成程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const raw = readFileSync(fileURLToPath(new URL(`../../${SOURCE}`, import.meta.url)), 'utf-8');
const code = withoutComments(raw);

/** <main> ... </main> 這一段（頁面實際被掛載的地方） */
const mainBlock = (() => {
  const m = code.match(/<main[\s\S]*?<\/main>/);
  if (!m) throw new Error(`${SOURCE} 找不到 <main> 區塊`);
  return m[0];
})();

/** 閘門變數名（`{旗標 ? children : …}` 中的旗標），由原始碼推得而非寫死 */
const gateName = (() => {
  const m = mainBlock.match(/\{\s*(\w+)\s*\?\s*children\b/);
  return m?.[1] ?? '';
})();

describe('AppShell：tenant 載入完成不得重新掛載頁面', () => {
  it('<main> 仍以 current.id 當 key（切換店家重新掛載的行為必須保留）', () => {
    expect(mainBlock).toMatch(/key=\{\s*current\.id/);
  });

  it('children 只在店家身分定案後才掛載，不得無條件渲染', () => {
    // 修好之前這裡是 <main …>{children}</main>：一律先掛上去，key 之後才變。
    expect(code).not.toContain('{children}');
    expect(gateName, '<main> 內找不到 `{旗標 ? children : …}` 形式的掛載閘門').not.toBe('');
    expect(mainBlock).toContain('children');
  });

  it('閘門旗標初值為 false —— real 模式不得在 my-tenants 回來前就掛頁面', () => {
    expect(code).toMatch(
      new RegExp(`const \\[${gateName}, set\\w+\\] = React\\.useState\\(false\\)`),
    );
  });

  it('my-tenants 無論成功或失敗都會放行，不會永遠卡在載入中', () => {
    const setter = code.match(new RegExp(`const \\[${gateName}, (set\\w+)\\]`))?.[1] ?? '';
    expect(setter).not.toBe('');
    // 失敗路徑也要開閘：只寫在 .then() 裡的話，帳號沒有店（403）就整頁空白。
    expect(code).toMatch(new RegExp(`\\.finally\\(\\(\\) => ${setter}\\(true\\)\\)`));
  });

  it('載入文案取自 i18n，元件內不得出現中文字面量', () => {
    expect(mainBlock).toContain('common.loading');
    expect(common.loading.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/[一-鿿]/);
  });
});
