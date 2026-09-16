/**
 * tests/unit/line-settings-disconnect-wiring.47.test.ts
 * -----------------------------------------------------------------------------
 * 靜態守 `src/app/tenant/line-settings/page.tsx` 的「解除連線」按鈕真的呼叫
 * `disconnectLine()`（打 `POST /api/settings/line/disconnect`），而不是
 * `saveLineSettings({ channelSecret: '', channelAccessToken: '' })`。
 *
 * 為什麼這條線容易假裝成功：`PUT /api/settings/line`（06 分冊鐵則 6）把空字串
 * 明確定義成「不動舊值」——這是給一般編輯表單用的（不用每次都重貼 Token），
 * 但套在「解除連線」上語意完全相反：呼叫端以為秘密已清空、UI 也顯示「已解除
 * 連線」，資料庫裡 `line_channel_secret_enc`／`line_channel_access_token_enc`
 * 其實原封不動。真正會清空這兩個欄位的是既有的
 * `POST /api/settings/line/disconnect`（見 `tests/unit/line-disconnect-route.47.test.ts`）。
 *
 * 本專案沒有安裝 @testing-library/react、vitest 跑在 node 環境（無法掛載 React
 * 元件），所以這裡讀原始碼守「disconnect handler 呼叫哪個函式」這條靜態不變
 * 條件，同 `tests/unit/keyword-replies-wiring.05.test.ts` 的作法。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGE = 'src/app/tenant/line-settings/page.tsx';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function handlerBody(code: string, name: string): string {
  const start = code.indexOf(`const ${name} =`);
  expect(start, `頁面找不到 handler：${name}`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const end = rest.indexOf('\n  const ');
  return rest.slice(0, end === -1 ? undefined : end);
}

describe('line-settings 頁：解除連線真的打 disconnectLine（Issue #47）', () => {
  const code = withoutComments(src(PAGE));

  it('頁面 import 了 disconnectLine', () => {
    expect(code).toMatch(/import\s*\{[^}]*disconnectLine[^}]*\}\s*from\s*'@\/services\/settings'/s);
  });

  it('disconnect handler 呼叫 disconnectLine()，不是 saveLineSettings()', () => {
    const body = handlerBody(code, 'disconnect');
    expect(body, 'disconnect() 沒有呼叫 disconnectLine()').toMatch(/await disconnectLine\(\)/);
    expect(
      body,
      'disconnect() 不該再用 saveLineSettings 假裝清空秘密（PUT /api/settings/line 對空字串的定義是「不動舊值」）',
    ).not.toMatch(/await saveLineSettings\(/);
  });
});
