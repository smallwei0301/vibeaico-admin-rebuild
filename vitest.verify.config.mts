import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Vitest 設定（對外部真實服務的驗證資產）— 見 docs/integration/12-TESTING-TDD.md §3
 * -----------------------------------------------------------------------------
 * `tests/verify/**` 裡的檔案**會打真實的外部 API**（目前只有 LINE 官方驗證端點），
 * 所以它們刻意不叫 `*.test.ts`、也不放在 `tests/unit/`：
 *
 *   - `vitest.config.mts` 的 include 是 `tests/unit/**\/*.test.ts` —— §3 規定單元測試
 *     不得碰網路，這些檔案不能被 `npm test` 掃到。
 *   - `vitest.integration.config.mts` 的 include 是 `tests/integration/**` —— 那一層跑
 *     的是我們自己的伺服器與 TEST 資料庫，不是第三方。
 *
 * 因此 CI 不會跑這一層（它需要真實 channel token，那是 Drive 憑證不是 repo secret）。
 * 由人在需要時以 `npm run verify:flex-menu` 執行，輸出貼進對應 Issue 作為證據。
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/verify/**/*.check.ts'],
    // 打外部 API，網路來回比單元測試慢得多
    testTimeout: 60_000,
  },
});
