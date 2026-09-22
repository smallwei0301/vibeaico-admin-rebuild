// tests/e2e-target-guard.ts
//
// 「這一輪 E2E 到底打到哪一個資料庫」的安全鎖（Issue #27 驗收）。
// -----------------------------------------------------------------------------
// 為什麼要有這個檔：驗收 spec 會**寫入**資料（改預約時間、存 AI 提示詞、建立
// 商品訂單）。playwright.config.ts 加上 E2E_BASE_URL 之後，同一份 spec 可以
// 指向任何一個部署 —— 包含 Production。一旦指錯，破壞是不可逆的。
//
// 所以「別指到正式站」這件事不能留在人的自律裡，必須寫進程式：spec 在做任何
// 動作之前先把目標專案 ref 讀回來，不是 TEST 就硬失敗。
//
// ============================================================================
// 怎麼把「目標專案」讀回來（實測結論，不是推測）
// ============================================================================
// 交派任務時的假設是「NEXT_PUBLIC_SUPABASE_URL 是 client-visible，所以前端
// bundle 會露出專案 ref」。**在這個 repo 不成立**，實測如下：
//
//   1. `src/config/env.ts` 是 `serverSchema.parse(process.env)` —— 整包丟給 zod，
//      沒有任何一處寫成 `process.env.NEXT_PUBLIC_SUPABASE_URL` 的靜態成員存取，
//      而 Next 只會把靜態成員存取 inline 進 client bundle。
//   2. 這個專案「頁面不 fetch」（鐵則 1），Supabase client 只在 `src/server/*`
//      與 `src/middleware.ts` 建立，前端沒有 `createBrowserClient`。
//   3. 實跑 `NEXT_PUBLIC_SUPABASE_URL=<TEST> npm run build` 後
//      `grep -rl <ref> .next/static/` → **0 個檔案**（`.next/server/` 有 126 個）。
//
// 也就是說：前端 bundle 根本沒有專案 ref 可以讀，照原假設寫會得到一個永遠
// 「讀不到」的安全鎖 —— 那比沒有還糟（會被改成略過）。
//
// 真正可靠的來源是**登入後的 session cookie 名稱**：
//
//   supabase-js 的 `SupabaseClient` 建構子（node_modules/@supabase/supabase-js/
//   src/SupabaseClient.ts）寫死
//       const defaultStorageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`
//   而 `@supabase/ssr` 的 `createServerClient` 直接沿用這個 storageKey 當 cookie
//   名稱。本專案的 `src/server/supabase.ts` / `src/middleware.ts` 都用預設值
//   （沒有傳 `cookieOptions.name`）。
//
// 所以 `sb-<ref>-auth-token` 這個 cookie 名稱，是**執行中的伺服器**用它當下真正
// 在用的 `NEXT_PUBLIC_SUPABASE_URL` 算出來、再自己吐回瀏覽器的。它不是建置產物、
// 不是設定檔、也不是我們自己算的猜測值 —— 是目標站台對「我連的是哪個專案」的
// 第一手自述，而且與它之後所有 Supabase 流量共用同一個 URL。
//
// 代價：要先登入才讀得到（登入本身只做驗證、不寫任何業務資料；打到別的專案
// 也只會失敗，不會留下痕跡）。讀不到就是「目標不明」，同樣硬失敗 —— 絕不在
// 不確定目標的情況下往下跑。

/** TEST 專案（唯一允許被 E2E 寫入的目標） */
export const TEST_SUPABASE_PROJECT_REF = 'nmwhwngojosmagjuvxol';

/** 正式（Production）專案 —— 出現在這裡只為了讓失敗訊息能指名道姓 */
export const PRODUCTION_SUPABASE_PROJECT_REF = 'egehnijjpgijmccagxac';

/**
 * Remote canonical TEST and disposable LOCAL_ISOLATED runs have different,
 * explicit target evidence. A local admission is never inferred from a ref:
 * it must prove the loopback URL plus the workflow-issued paired identities.
 */
export type E2eTargetEvidence = {
  testProfile?: string;
  testSupabaseUrl?: string;
  localProjectId?: string;
  testEnvId?: string;
};

export function targetEvidenceFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): E2eTargetEvidence {
  return {
    testProfile: env.TEST_PROFILE,
    testSupabaseUrl: env.TEST_SUPABASE_URL,
    localProjectId: env.LOCAL_PROJECT_ID,
    testEnvId: env.TEST_ENV_ID,
  };
}

/**
 * `sb-<ref>-auth-token`，以及 token 過大時 @supabase/ssr 會切成的
 * `sb-<ref>-auth-token.0` / `.1` … 分片。
 */
const AUTH_COOKIE_NAME = /^sb-([a-z0-9]+(?:-[a-z0-9]+)*)-auth-token(?:\.\d+)?$/;

/**
 * 從瀏覽器 cookie 名稱清單推出目標 Supabase 專案 ref。
 *
 * 回 `null` 代表「無法判定」，有兩種情形，都同樣不可信：
 *   - 一個都沒找到（沒登入成功／目標站不是這個 app）
 *   - 找到兩個以上不同的 ref（殘留了別次執行的 cookie，自相矛盾）
 */
export function projectRefFromCookieNames(names: readonly string[]): string | null {
  const refs = new Set<string>();
  for (const name of names) {
    const matched = AUTH_COOKIE_NAME.exec(name);
    if (matched) refs.add(matched[1]);
  }
  return refs.size === 1 ? [...refs][0] : null;
}

/**
 * 從 Supabase URL 取專案 ref（`https://<ref>.supabase.co` → `<ref>`）。
 * 用來順手檢查 spec 自己那支 service-role admin client 的目標 —— 它繞過 app
 * 直接寫資料庫，指錯的後果和 app 指錯一模一樣。
 */
export function projectRefFromSupabaseUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const ref = host.split('.')[0];
    return ref ? ref : null;
  } catch {
    return null;
  }
}

function describeRef(ref: string): string {
  if (ref === PRODUCTION_SUPABASE_PROJECT_REF) return `${ref}（**正式 Production 資料庫**）`;
  if (ref === TEST_SUPABASE_PROJECT_REF) return `${ref}（TEST）`;
  return `${ref}（未知專案）`;
}

function hasPairedLocalIdentity(evidence: E2eTargetEvidence): boolean {
  const project = evidence.localProjectId ?? '';
  const environment = evidence.testEnvId ?? '';

  const prProject = /^vibeaico-(\d+)-([ab])$/.exec(project);
  const prEnvironment = /^local-pr-(\d+)-([ab])$/.exec(environment);
  if (prProject && prEnvironment) {
    return prProject[1] === prEnvironment[1] && prProject[2] === prEnvironment[2];
  }

  const schemaProject = /^schema-proof-(\d+)-(\d+)$/.exec(project);
  const schemaEnvironment = /^local-schema-(\d+)$/.exec(environment);
  return !!schemaProject && !!schemaEnvironment && schemaProject[1] === schemaEnvironment[1];
}

export function isAdmittedLocalIsolatedTarget(
  ref: string | null,
  evidence: E2eTargetEvidence,
): boolean {
  if (ref === PRODUCTION_SUPABASE_PROJECT_REF || evidence.testProfile !== 'LOCAL_ISOLATED') return false;
  if (!hasPairedLocalIdentity(evidence)) return false;

  try {
    const url = new URL(evidence.testSupabaseUrl ?? '');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash) return false;
    // The browser cookie/admin ref must agree with this exact loopback URL; do
    // not allow a local-looking environment to bless an unrelated target.
    return ref === projectRefFromSupabaseUrl(url.toString());
  } catch {
    return false;
  }
}

/**
 * 安全鎖本體：不是 TEST 專案就丟例外，讓這一輪立刻停住。
 *
 * @param ref     實測出來的目標專案 ref，判定不出來時傳 null
 * @param context 給人看的目標描述（base URL、或「service-role admin client」）
 */
export function assertTestSupabaseTarget(
  ref: string | null,
  context: string,
  evidence: E2eTargetEvidence = targetEvidenceFromEnvironment(),
): asserts ref is string {
  // Canonical TEST remains the original unconditional allowlist. Production is
  // rejected before the local branch, even if hostile environment fields claim
  // LOCAL_ISOLATED.
  if (ref === TEST_SUPABASE_PROJECT_REF) return;
  if (ref !== PRODUCTION_SUPABASE_PROJECT_REF && isAdmittedLocalIsolatedTarget(ref, evidence)) return;

  const headline = ref === null
    ? '本次執行「無法確定」打到哪一個資料庫，已中止 —— 目標不明時一律不往下跑。'
    : '本次執行被指向了「錯誤的資料庫」，已中止。';

  throw new Error([
    '',
    '================================================================',
    '  ⛔ E2E 目標資料庫安全鎖：已攔下本次執行',
    '================================================================',
    `  ${headline}`,
    '',
    `  目標站台　：${context}`,
    `  實測專案　：${ref === null ? '判定不出來（登入後找不到 sb-<ref>-auth-token cookie，或找到互相矛盾的多個）' : describeRef(ref)}`,
    `  唯一允許　：${TEST_SUPABASE_PROJECT_REF}（canonical TEST），或完整驗證的 LOCAL_ISOLATED loopback target`,
    '',
    '  這份驗收 spec 會寫入資料（改預約時間、存 AI 提示詞、建立商品訂單），',
    '  因此只准對 TEST 專案執行。請把 E2E_BASE_URL 指向 NEXT_PUBLIC_SUPABASE_URL',
    '  已設為 TEST 專案的 Preview 部署，再重跑一次。',
    '================================================================',
    '',
  ].join('\n'));
}
