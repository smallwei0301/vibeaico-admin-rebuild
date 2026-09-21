/**
 * tests/unit/line-settings-richmenu-wiring.47.test.ts
 * -----------------------------------------------------------------------------
 * 靜態守 `src/app/tenant/line-settings/page.tsx` 的「建立 Rich Menu」按鈕真的呼叫
 * `publishRichMenu()`（打 `POST /api/settings/line/rich-menu/create`），不是只呼叫
 * `saveLineSettings()` 就假裝已經建立並發布。
 *
 * 為什麼這條線容易假裝成功：`saveLineSettings()` 只是把 richMenuTheme／
 * richMenuBgImageUrl 等欄位寫進 `tenant_settings`，是一次成功的 DB 寫入，很容易
 * 被誤當成「Rich Menu 已建立」。真正會呼叫 LINE 官方 API（建立→傳圖→設為預設）
 * 的是既有、早就實作好卻沒有任何頁面呼叫的 `/api/settings/line/rich-menu/create`
 * （見 `src/app/api/settings/line/rich-menu/create/route.ts`）。修正前，這顆按鈕
 * 100% 顯示「已建立並發布」成功 toast，但 LINE 那邊從未真的被呼叫過。
 *
 * 本專案沒有安裝 @testing-library/react、vitest 跑在 node 環境（無法掛載 React
 * 元件），所以這裡讀原始碼守「create handler 呼叫哪個函式」這條靜態不變條件，
 * 同 `tests/unit/line-settings-disconnect-wiring.47.test.ts` 的作法。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGE = 'src/app/tenant/line-settings/page.tsx';
const SERVICE = 'src/services/settings.ts';

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

describe('line-settings 頁：建立 Rich Menu 真的打 publishRichMenu（Issue #47）', () => {
  const code = withoutComments(src(PAGE));

  it('頁面 import 了 publishRichMenu', () => {
    expect(code).toMatch(/import\s*\{[^}]*publishRichMenu[^}]*\}\s*from\s*'@\/services\/settings'/s);
  });

  it('createRichMenu handler 呼叫 publishRichMenu()，且成功／失敗都以它為準', () => {
    const body = handlerBody(code, 'createRichMenu');
    expect(body, 'createRichMenu() 沒有呼叫 publishRichMenu()').toMatch(/await publishRichMenu\(\)/);

    // setRichMenuPublished(true) 必須在 publishRichMenu() 之後才呼叫，
    // 否則存欄位一成功就會假裝「已發布」，回到修正前的假成功。
    const publishIndex = body.indexOf('await publishRichMenu()');
    const publishedFlagIndex = body.indexOf('setRichMenuPublished(true)');
    expect(publishedFlagIndex, 'createRichMenu() 沒有設定 richMenuPublished').toBeGreaterThan(-1);
    expect(
      publishedFlagIndex,
      'setRichMenuPublished(true) 必須排在 await publishRichMenu() 之後，否則存欄位成功就會假裝已發布',
    ).toBeGreaterThan(publishIndex);
  });

  it('publishRichMenu 真的呼叫 /api/settings/line/rich-menu/create', () => {
    const serviceCode = withoutComments(src(SERVICE));
    const start = serviceCode.indexOf('export const publishRichMenu');
    expect(start, '找不到 publishRichMenu 定義').toBeGreaterThan(-1);
    const body = serviceCode.slice(start, start + 600);
    expect(body).toMatch(/\/api\/settings\/line\/rich-menu\/create/);
  });
});
