/**
 * 整合測試骨架煙霧測試 — 見 docs/integration/12-TESTING-TDD.md 本冊驗收：
 *   「`npm run test:integration` 可從零跑起（globalSetup 起 server、跑完清掉）」
 *
 * 這支測試驗的是**測試骨架本身**，不是任何業務邏輯：
 *   tests/integration/global-setup.ts 是否真的跑過 reset-db、把 next dev 起在 3100、
 *   並輪詢到就緒。骨架壞掉時，後續所有 Phase 的整合測試都會以難以理解的方式失敗，
 *   所以值得有一支專門盯著它的測試。
 *
 * ⚠️ 為什麼 Phase 0 就要有這支測試（而不是等 Phase 2 有真正的 API 測試再說）：
 *    12 分冊 §2.4 禁止 `--passWithNoTests` 進版。若 tests/integration/ 一支測試都沒有，
 *    `npm run test:integration` 會以非零結束、CI 的 integration job 直接紅燈，
 *    無法滿足「CI 兩個 job 上線且 main 綠燈」的驗收條件。用一支真正有意義的
 *    骨架測試來滿足它，而不是放寬指令。
 *
 * Phase 2 起會有真正的 API 整合測試（tests/integration/api/*.test.ts），
 * 這支測試仍應保留 —— 它是骨架的回歸測試。
 */
import { describe, it, expect } from 'vitest';

const BASE_URL = 'http://localhost:3100';

describe('整合測試骨架（12 分冊 §1.4）', () => {
  it('globalSetup 已把 next dev 起在 3100 並可回應請求', async () => {
    const res = await fetch(`${BASE_URL}/tenant/login`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('.env.test 的變數有被載入子行程（TEST 專案而非正式專案）', () => {
    // globalSetup 會先 loadEnvFile('.env.test')，故此處讀得到。
    // 斷言指向 TEST 專案，是防止「測試不小心接到正式資料庫」的最後一道防線
    // —— 同一個意圖在 scripts/test/_supabase-admin.mjs 的安全鎖有更強的版本。
    const testUrl = process.env.TEST_SUPABASE_URL;
    expect(testUrl).toBeTruthy();
    expect(testUrl).not.toContain('egehnijjpgijmccagxac');
  });
});
