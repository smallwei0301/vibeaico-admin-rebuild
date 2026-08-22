import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Vitest 設定（整合測試）— 見 docs/integration/12-TESTING-TDD.md §1.4
 * -----------------------------------------------------------------------------
 * 與單元測試分成兩份設定的理由：
 *   globalSetup 會「重置 TEST 資料庫 + 啟動 next dev:3100」。這對整合測試是必要的，
 *   但單元測試（§3 規定不得碰網路/DB）絕不能觸發它。Vitest 的 globalSetup 是設定層級、
 *   不分檔案，所以唯一乾淨的隔離方式就是各自一份設定檔。
 *
 * 對應 npm script：
 *   test:integration → vitest run tests/integration --config vitest.integration.config.mts --no-file-parallelism
 *   （--no-file-parallelism：整合測試共用同一個 TEST 資料庫，必須串行，見 §1.5）
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    // next dev 首次編譯 + 資料庫重置都可能偏慢，放寬單一測試逾時
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
