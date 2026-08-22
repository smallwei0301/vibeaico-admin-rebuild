import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Vitest 設定（單元測試）— 見 docs/integration/12-TESTING-TDD.md §1
 * -----------------------------------------------------------------------------
 * 單元測試（tests/unit）：純函式，不碰網路/DB（§3），coverage 對 src/server ≥80%。
 *
 * ⚠️ 這份設定**刻意不含 globalSetup**。整合測試的 globalSetup 會重置 TEST 資料庫
 *    並啟動 next dev，單元測試絕不能觸發它 —— 整合測試用 vitest.integration.config.mts。
 *
 * 副檔名是 .mts 而非 .ts：Vite 會把 .ts 設定當 CJS 載入並對 ESM 語法發出警告
 *    （未來主版本會變成錯誤），.mts 明確以 ESM 載入，故此處用 import.meta.dirname。
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/server/**'],
      thresholds: { lines: 80, functions: 80, statements: 80 },
    },
  },
});
