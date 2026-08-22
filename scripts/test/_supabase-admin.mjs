// scripts/test/_supabase-admin.mjs
//
// 共用小工具，給 scripts/test/reset-db.mjs 與 scripts/test/seed.mjs 用。
// 見 docs/integration/12-TESTING-TDD.md §1.2 / §1.3。
//
// 責任：
//   1. 載入 .env.test（若尚未載入 —— 可獨立執行 `node scripts/test/reset-db.mjs`，
//      也可被 tests/integration/global-setup.ts 以已注入環境變數的方式呼叫）。
//   2. 安全鎖：擋掉「環境變數被誤設成正式專案」——這是本檔最重要的職責。
//   3. 建立 service role 的 Supabase client。
//
// ⚠️ 這個檔案本身不 truncate/seed 任何東西，只負責「安全地拿到一個接到
//    TEST 專案的 service role client」。

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * 正式（vibeaico backend）Supabase 專案 —— 絕對不可以被這組腳本動到。
 * 見任務指示 / docs/integration/02-SUPABASE-SCHEMA.md 導言、.env.example 註解
 * 「Supabase 專案：Vibe ai backend（production/dev 用，ref: egehnijjpgijmccagxac）」。
 */
const PRODUCTION_SUPABASE_HOSTNAME = 'egehnijjpgijmccagxac.supabase.co';

/**
 * 載入 .env.test（若相關變數還沒出現在 process.env）。
 * globalSetup 可能已經自己讀過 .env.test 並把變數注入子行程環境，此時這裡
 * 應該是 no-op；獨立執行 `node scripts/test/reset-db.mjs` 時則由這裡負責載入。
 */
export function loadTestEnv() {
  if (process.env.TEST_SUPABASE_URL && process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }
  const envTestPath = resolve(REPO_ROOT, '.env.test');
  if (!existsSync(envTestPath)) {
    console.error(
      `[test-db] 找不到 .env.test（預期路徑：${envTestPath}）。` +
        ' 請先依 docs/integration/12-TESTING-TDD.md §1.2 建立。',
    );
    process.exit(1);
  }
  // Node >=20.12 內建，不需要 dotenv 依賴（本專案未安裝 dotenv）。
  process.loadEnvFile(envTestPath);
}

/**
 * 安全鎖（12 分冊 §1.2）：
 *   「reset 腳本開頭檢查 URL 必須等於 TEST_SUPABASE_URL 且 hostname 不等於
 *    正式專案，否則直接 process.exit(1)。」
 *
 * 這裡刻意做兩層獨立檢查（不是同一個條件式的兩個分支寫法），因為它們防的
 * 是兩種不同的誤設：
 *   (a) TEST_SUPABASE_URL 本身沒設 / 格式壞掉 —— 腳本無法確認自己接的是哪裡。
 *   (b) TEST_SUPABASE_URL 被誤設成正式專案的網址 —— 最危險的情境，即使它
 *       「看起來」是合法的 URL 也要擋。
 *
 * 回傳驗證過的 TEST_SUPABASE_URL 字串，供呼叫端記錄/顯示。
 */
export function assertSafeTestUrl() {
  const rawUrl = process.env.TEST_SUPABASE_URL;

  if (!rawUrl) {
    console.error('[test-db] 安全鎖：TEST_SUPABASE_URL 未設定，拒絕執行。');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(`[test-db] 安全鎖：TEST_SUPABASE_URL 不是合法的 URL（"${rawUrl}"），拒絕執行。`);
    process.exit(1);
  }

  if (parsed.hostname === PRODUCTION_SUPABASE_HOSTNAME) {
    console.error(
      `[test-db] 安全鎖：TEST_SUPABASE_URL 指向正式專案（${PRODUCTION_SUPABASE_HOSTNAME}）！` +
        ' 絕對禁止對正式專案執行 reset/seed，拒絕執行。',
    );
    process.exit(1);
  }

  // 額外擋一個常見誤設來源：NEXT_PUBLIC_SUPABASE_URL（平台/正式環境變數，
  // 見 src/config/env.ts 週邊的 .env.local）意外被當成測試 URL 使用。
  const platformUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (platformUrl && platformUrl === rawUrl) {
    console.error(
      '[test-db] 安全鎖：TEST_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_URL（平台/正式環境變數）相同，' +
        ' 這代表測試環境變數極可能被誤設成正式專案，拒絕執行。',
    );
    process.exit(1);
  }

  return rawUrl;
}

/**
 * 建立 service role Supabase client，接到已通過安全鎖檢查的 TEST 專案。
 * 一定要先呼叫 assertSafeTestUrl()，這個函式本身不重複做安全檢查。
 */
export function createTestAdminClient() {
  const url = process.env.TEST_SUPABASE_URL;
  const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('[test-db] 安全鎖：TEST_SUPABASE_SERVICE_ROLE_KEY 未設定，拒絕執行。');
    process.exit(1);
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export { PRODUCTION_SUPABASE_HOSTNAME, REPO_ROOT };
