// playwright.config.ts
//
// 見 docs/integration/12-TESTING-TDD.md §1.5：
//   「Playwright webServer 設定同 §1.4 的啟動方式（reuseExistingServer: true）。」
//
// 測試目錄：tests/e2e（12 分冊 §4 每 Phase 的 E2E 旅程清單都放這裡，例如
// tests/e2e/auth.spec.ts、tests/e2e/tour-admin.spec.ts）。
//
// Chromium 執行檔：不寫死絕對路徑，交給環境變數
// PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers（已在環境設好）—— Playwright
// 用 `channel`/`browserName` 正常解析瀏覽器時，本來就會用這個環境變數找
// 已安裝的瀏覽器，不需要在設定檔裡另外指定路徑。
//
// ⚠️ 現況（2026-08 撰寫時）：`/api/**`、`/tenant/**` 需要的登入流程等
// Phase 2 才會存在，tests/e2e/ 目前是空的（見 §7 CI 說明與本次任務範圍）。
// webServer 的啟動方式先寫好，供之後的 E2E 測試直接使用。

import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 載入 .env.test（同 tests/integration/global-setup.ts）：webServer 底下的
// `env` 只會覆寫/新增列出的鍵，其餘鍵仍繼承自目前的 process.env，所以
// TEST_SUPABASE_URL 等變數要在這裡先進到 process.env，next dev 子行程才吃得到。
const envTestPath = resolve(__dirname, '.env.test');
if (existsSync(envTestPath)) {
  // Node >=20.12 內建；已存在的 process.env 變數不會被覆蓋。
  process.loadEnvFile(envTestPath);
}

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 本開發環境預裝 chromium-1194 於 /opt/pw-browsers（見 CLAUDE.md），
        // 專案的 @playwright/test 版本 pin 的 build（如 headless_shell-1234）
        // 不在其中，且環境規範禁止 `playwright install` 重新下載。
        // 環境有預裝瀏覽器時（PLAYWRIGHT_BROWSERS_PATH 指向處存在
        // chromium symlink）就用 executablePath 指過去；CI 等有跑
        // `playwright install --with-deps chromium` 的環境則不設，
        // 讓 Playwright 用自己下載的版本。
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH &&
        existsSync(`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`)
          ? { launchOptions: { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` } }
          : {}),
      },
    },
  ],

  // 同 tests/integration/global-setup.ts 的啟動方式（12 分冊 §1.4）：
  // .env.test 的變數 + NEXT_PUBLIC_USE_MOCK=false，起 next dev -p 3100。
  // reuseExistingServer: true —— 如果 `npm run test:integration` 或手動起的
  // dev server 已經在跑，直接沿用，不重複啟動。
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    // next dev 首次編譯可能較久，給足時間再判定失敗（理由同
    // tests/integration/global-setup.ts 的 SERVER_READY_TIMEOUT_MS 註解）。
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_USE_MOCK: 'false',
      // ⚠️ 安全關鍵（實跑抓到，勿刪）：Playwright 的 webServer 沒有
      // NODE_ENV=test，next dev 會照常載入 .env.local —— 那裡指向**正式**
      // 專案。不顯式傳 TEST 值的話，E2E 會直接對正式資料庫打。
      // process env 優先權高於 .env 檔，這裡顯式覆蓋成 TEST 專案。
      NEXT_PUBLIC_SUPABASE_URL: process.env.TEST_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.TEST_SUPABASE_ANON_KEY ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? '',
      NEXT_PUBLIC_APP_URL: BASE_URL,
    },
  },
});
