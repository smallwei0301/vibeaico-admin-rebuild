#!/usr/bin/env node
//
// scripts/ci/preview-url-policy.mjs
//
// Issue #27 驗收工作流（.github/workflows/issue-27-preview-acceptance.yml）的
// 目標網址前置檢查。
// -----------------------------------------------------------------------------
// 為什麼還要這一層：真正的保證仍然是 tests/e2e-target-guard.ts —— 它在瀏覽器
// 登入之後，把「目標站台當下實際連的是哪一個 Supabase 專案」讀回來比對，不是
// TEST 就硬失敗。那一層才是不可繞過的。
//
// 但 `workflow_dispatch` 的輸入框是自由文字，任何有 write 權限的人都能填任何
// 網址。與其讓一個明顯填錯的目標（例如正式站別名）跑完 npm ci + 安裝 Chromium
// 才在登入後被攔下，不如在瀏覽器啟動之前就用幾條便宜的規則擋掉，並且把「為什麼
// 被擋」講清楚。這是縱深防禦的外層，不是取代內層。
//
// 判定規則（全部都要成立才算通過）：
//   1. 協定必須是 https:（http: 明文一律拒絕）
//   2. 不得帶帳號密碼、不得指定埠號、不得帶 query 或 fragment，路徑只能是空或 /
//   3. 主機名稱必須整串吻合本專案 Vercel preview 部署的形狀：
//        vibeaico-admin-rebuild-<suffix>-smallwei0301s-projects.vercel.app
//      其中 <suffix> 是部署雜湊（5rmpsuh0k）或分支別名（git-previe-5d731e）。
//      整串錨定比對，所以「只是包含專案名稱」的相似網域不會過。
//   4. 正式站別名 vibeaico-admin-rebuild-smallwei0301s-projects.vercel.app
//      （沒有 suffix）與 -git-main- 分支別名，各自以專屬訊息明確拒絕。

import { pathToFileURL } from 'node:url';

/** 本專案在 Vercel 上的專案名稱 */
export const PROJECT_SLUG = 'vibeaico-admin-rebuild';

/** 本專案所屬的 Vercel scope（個人 team）後綴 */
export const PROJECT_SCOPE_SUFFIX = 'smallwei0301s-projects.vercel.app';

/** 正式（Production）別名 —— 沒有 suffix 的那一個，絕對不可以是 E2E 目標 */
export const PRODUCTION_ALIAS_HOST = `${PROJECT_SLUG}-${PROJECT_SCOPE_SUFFIX}`;

/** 預設分支（main）的分支別名 suffix —— 指向的是正式內容，同樣拒絕 */
export const MAIN_BRANCH_ALIAS_SUFFIX = 'git-main';

/**
 * preview 主機名稱形狀：
 *   <project>-<suffix>-<scope>
 * suffix 只允許小寫英數與連字號，且不得以連字號開頭或結尾。
 */
const PREVIEW_HOST = new RegExp(
  `^${PROJECT_SLUG}-([a-z0-9]+(?:-[a-z0-9]+)*)-${PROJECT_SCOPE_SUFFIX.replaceAll('.', '\\.')}$`,
);

/**
 * 驗證 workflow_dispatch 傳進來的 Preview 網址。
 *
 * 純函式，不碰網路、不碰檔案系統，方便單元測試。
 *
 * @param {unknown} input 使用者填入的字串
 * @returns {{ valid: boolean, host: string | null, reason: string, message: string }}
 *   valid=false 時 reason 是機器可讀的代號，message 是給人看的中文說明。
 */
export function validatePreviewUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : '';

  if (!raw) {
    return fail('EMPTY', '沒有提供 preview_url —— 這個工作流必須有一個實際在跑的 Preview 站台才有意義。');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail('NOT_A_URL', `「${raw}」不是一個合法的網址。`);
  }

  if (url.protocol !== 'https:') {
    return fail('NOT_HTTPS', `只接受 https:// 的網址，收到的是「${url.protocol}//」。`);
  }
  if (url.username || url.password) {
    return fail('HAS_CREDENTIALS', '網址不得內嵌帳號密碼。');
  }
  if (url.port) {
    return fail('HAS_PORT', `網址不得指定埠號（收到 :${url.port}）；Vercel Preview 一律走 443。`);
  }
  if (url.search || url.hash) {
    return fail('HAS_QUERY_OR_HASH', '網址不得帶 query string 或 fragment，請只填站台根網址。');
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    return fail('HAS_PATH', `網址必須是站台根路徑，收到的是「${url.pathname}」。`);
  }

  const host = url.hostname;

  if (host === PRODUCTION_ALIAS_HOST) {
    return fail(
      'PRODUCTION_ALIAS',
      `「${host}」是**正式（Production）別名**，一律拒絕：這份驗收 spec 會寫入資料（改預約時間、存 AI 提示詞、建立商品訂單），對正式站執行的破壞不可逆。請改填某一次 Preview 部署的網址。`,
      host,
    );
  }

  const matched = PREVIEW_HOST.exec(host);
  if (!matched) {
    return fail(
      'NOT_PROJECT_PREVIEW_HOST',
      `「${host}」不是本專案的 Vercel Preview 主機。必須整串吻合 ${PROJECT_SLUG}-<部署代碼或 git-<分支>>-${PROJECT_SCOPE_SUFFIX}（僅僅包含專案名稱的相似網域不算）。`,
      host,
    );
  }

  const suffix = matched[1];
  if (suffix === MAIN_BRANCH_ALIAS_SUFFIX) {
    return fail(
      'MAIN_BRANCH_ALIAS',
      `「${host}」是預設分支（main）的分支別名，內容等同正式線上版本，一律拒絕。請改填要驗收的那一條分支／那一次部署的 Preview 網址。`,
      host,
    );
  }

  return {
    valid: true,
    host,
    reason: suffix.startsWith('git-') ? 'BRANCH_ALIAS' : 'DEPLOYMENT_URL',
    message: `${host} 通過前置檢查（仍會由 tests/e2e-target-guard.ts 在登入後確認實際連到的是 TEST 專案）。`,
  };
}

function fail(reason, message, host = null) {
  return { valid: false, host, reason, message };
}

/**
 * 檢查不過就丟例外（給 CI 用）。
 * @param {unknown} input
 * @returns {string} 通過時回主機名稱
 */
export function assertPreviewUrl(input) {
  const result = validatePreviewUrl(input);
  if (!result.valid) {
    throw new Error([
      '',
      '================================================================',
      '  ⛔ Preview 網址前置檢查：已攔下本次執行',
      '================================================================',
      `  原因代號：${result.reason}`,
      `  ${result.message}`,
      '',
      `  可接受的例子：https://${PROJECT_SLUG}-5rmpsuh0k-${PROJECT_SCOPE_SUFFIX}`,
      `              　https://${PROJECT_SLUG}-git-previe-5d731e-${PROJECT_SCOPE_SUFFIX}`,
      `  一律拒絕　：https://${PRODUCTION_ALIAS_HOST}（正式別名）`,
      `              　https://${PROJECT_SLUG}-${MAIN_BRANCH_ALIAS_SUFFIX}-${PROJECT_SCOPE_SUFFIX}（main 分支別名）`,
      '================================================================',
      '',
    ].join('\n'));
  }
  return result.host;
}

function cli() {
  const input = process.argv[2] ?? process.env.PREVIEW_URL ?? '';
  const host = assertPreviewUrl(input);
  console.log(`[preview-url-policy] OK host=${host}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  try {
    cli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
