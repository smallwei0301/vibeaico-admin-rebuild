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
  /**
   * tsconfig 的 `jsx: "preserve"` 是 Next.js 需要的（由 Next 自己編譯 JSX），
   * 但 vitest（Vite 8 / oxc）直接讀 .tsx 會因此 parse 失敗
   * （`Failed to parse source for import analysis … make sure to not set jsx to preserve`）。
   * 這裡對測試用的轉換明確指定 automatic runtime，
   * 讓單元測試能用 `react-dom/server` 把元件渲染成字串來驗**畫面上真正的字**
   * （issue #34：「開店進度未知時不得印出任何百分比」這種事，只讀原始碼驗不準）。
   * 仍然沒有 jsdom：能渲染不代表能測互動，互動一律走 Playwright 實測。
   */
  oxc: { jsx: { runtime: 'automatic' } },
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
