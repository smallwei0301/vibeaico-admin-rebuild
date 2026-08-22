// tests/integration/global-setup.ts
//
// Vitest globalSetup for `npm run test:integration` — 見
// docs/integration/12-TESTING-TDD.md §1.4：
//   「Vitest globalSetup：跑 reset-db → 以 .env.test 的變數 +
//    NEXT_PUBLIC_USE_MOCK=false spawn `next dev -p 3100` → 輪詢
//    http://localhost:3100 就緒 → teardown 時殺掉。」
//
// ⚠️ 這個檔案目前**還沒有被接進 vitest.config.ts**（`test.globalSetup`
// 欄位）——依任務分工，vitest.config.ts 由主導者統一改動，這裡只把
// globalSetup 模組本身寫好。要接上的話在 vitest.config.ts 的 `test` 區塊加：
//   globalSetup: ['tests/integration/global-setup.ts']
//
// ⚠️ 現況（2026-08 撰寫時）：`/api/**` 路由（Phase 2 起）都還不存在，
// reset-db 對業務表的 truncate/seed 也會因為 Phase 1 尚未建表而被跳過
// （見 scripts/test/reset-db.mjs、scripts/test/seed.mjs 開頭說明）。
// `next dev -p 3100` 仍然可以正常啟動並回應 HTTP（首頁 / 或任一靜態路由），
// 所以本檔案「起真伺服器＋輪詢就緒」這部分現在就可以驗證；一旦 Phase 1–2
// 完成，不需要再改這個檔案。

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * 輪詢上限說明（12 分冊 §2.3「禁用 sleep 等待：輪詢條件（間隔 ≤200ms、
 * 上限 10s）」）：那條規則管的是**測試斷言**裡的輪詢（等某個狀態變化，
 * 屬於測試邏輯，卡住代表測試本身有問題，10s 內該有結果）。這裡輪詢的是
 * `next dev` 這個開發伺服器的**第一次啟動 + 首次編譯**，冷啟動明顯可能
 * 超過 10s（尤其是第一次跑、檔案系統快取是空的）。所以刻意把上限放寬到
 * 60s —— 這是「等外部行程啟動」，不是「等測試條件成立」，性質不同，
 * 放寬不違反 §2.3 的精神。間隔仍維持在 ≤200ms（這裡用 200ms）。
 */
const SERVER_READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 200;

let serverProcess: ChildProcess | undefined;

async function resetTestDatabase(): Promise<void> {
  console.log('[global-setup] 執行 reset-db（含 seed）…');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(REPO_ROOT, 'scripts/test/reset-db.mjs')], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`[global-setup] reset-db.mjs 以非零狀態碼結束：${code}`));
      }
    });
  });
}

function loadEnvTestIfPresent(): void {
  const envTestPath = resolve(REPO_ROOT, '.env.test');
  if (!existsSync(envTestPath)) {
    console.warn(`[global-setup] 找不到 .env.test（${envTestPath}），略過載入 —— 假設變數已由外部注入。`);
    return;
  }
  // Node >=20.12 內建；已存在的 process.env 變數不會被覆蓋（同
  // scripts/test/_supabase-admin.mjs 的行為，見安全鎖實測）。
  process.loadEnvFile(envTestPath);
}

async function waitForServerReady(): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      // next dev 對首頁的回應不論是 200 或轉址後的頁面，只要「有回 HTTP
      // 回應」就代表伺服器已經接受連線並跑起來了。
      if (res.status > 0) {
        console.log(`[global-setup] ${BASE_URL} 已就緒（status ${res.status}）。`);
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `[global-setup] 等待 ${BASE_URL} 就緒逾時（${SERVER_READY_TIMEOUT_MS}ms）。最後錯誤：${String(lastError)}`,
  );
}

function spawnNextDevServer(): ChildProcess {
  console.log(`[global-setup] 啟動 next dev -p ${PORT}（NEXT_PUBLIC_USE_MOCK=false）…`);
  // ⚠️ 兩個刻意的選擇，兩者都是為了「teardown 一定殺得乾淨」：
  //
  // 1. 直接執行 node_modules/.bin/next，不要走 `npx next`。
  //    `npx` 會再 spawn 一層，真正的 next dev 變成孫行程；對 npx 送 SIGTERM
  //    殺不到孫行程，它會變成孤兒繼續佔著 3100 與繼承來的 stdio 管線，
  //    導致 vitest 結束後管線不關閉、整個 CI job 永久卡住。
  //
  // 2. detached: true —— 讓子行程自成一個 process group，teardown 才能用
  //    process.kill(-pid) 一次終止「整棵樹」（next dev 自己也會 fork worker）。
  const child = spawn(resolve(REPO_ROOT, 'node_modules/.bin/next'), ['dev', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    detached: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_USE_MOCK: 'false',
    },
  });
  child.on('error', (err) => {
    console.error('[global-setup] next dev 啟動失敗：', err);
  });
  return child;
}

/**
 * 終止整個 process group（next dev 會自己 fork worker，只殺 pid 會留下孤兒）。
 * 回傳是否成功送出訊號 —— 行程已不存在時 process.kill 會丟 ESRCH，視為已結束。
 */
function killProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal); // 負號 = 對整個 process group
    return true;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  loadEnvTestIfPresent();
  await resetTestDatabase();

  serverProcess = spawnNextDevServer();
  await waitForServerReady();

  return async function teardown() {
    const proc = serverProcess;
    if (!proc?.pid) return;
    console.log('[global-setup] teardown：關閉 next dev server…');

    // ⚠️ 不要用 proc.killed 判斷「行程是否已結束」——那個旗標在**訊號送出**時
    //    就變 true，跟行程有沒有真的死掉無關。用自己的 exit 事件旗標才正確。
    let exited = false;
    proc.once('exit', () => { exited = true; });

    await new Promise<void>((done) => {
      const finish = () => { clearInterval(poll); clearTimeout(hardKill); done(); };

      killProcessTree(proc.pid!, 'SIGTERM');

      // 輪詢真正的結束狀態（間隔 100ms），而不是相信送訊號就等於結束。
      const poll = setInterval(() => { if (exited) finish(); }, 100);

      // 保險：SIGTERM 收不掉就整組 SIGKILL，避免 teardown 卡住讓 CI 永久掛著。
      const hardKill = setTimeout(() => {
        if (!exited) {
          console.warn('[global-setup] SIGTERM 逾時，改用 SIGKILL 終止整個 process group。');
          killProcessTree(proc.pid!, 'SIGKILL');
        }
        finish();
      }, 5_000);
    });
  };
}
