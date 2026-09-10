import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readField } from './agent-wip-policy.mjs';

export const routing = JSON.parse(readFileSync(new URL('./model-routing.json', import.meta.url), 'utf8'));
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const meaningful = (s) => typeof s === 'string' && s.trim().length >= 8 && !/^(unknown|pending|none|n\/a|tbd)$/i.test(s.trim());
const FINAL_RISK_DEFERRED_LANE_STATES = new Set([
  'PARKED',
  'COMPLETE',
  'OWNER_BLOCKED',
  'HISTORICAL',
  'READY_FOR_PROMOTION',
]);

/**
 * Final Risk is a merge-readiness gate, not a liveness check for parked work.
 * Unknown lane states deliberately enforce the gate so malformed metadata cannot
 * turn a required review into an implicit approval.
 */
export function shouldEnforceFinalRisk({ pullRequestState = 'open', draft = false, laneState = '' } = {}) {
  if (String(pullRequestState).trim().toLowerCase() === 'closed') return false;
  if (draft === true) return false;
  return !FINAL_RISK_DEFERRED_LANE_STATES.has(String(laneState).trim().toUpperCase());
}

export function finalRiskGateStatus({ hasErrors = false, finalRiskRequired = false } = {}) {
  if (hasErrors) return 'failure';
  return finalRiskRequired ? 'success' : 'pending';
}

/**
 * 逐字比對的欄位。
 *
 * ⚠️ `baseSha` / `headSha` **刻意不在這裡**——它們仍必須出現在 attestation 裡
 * （下方單獨驗格式，供稽核追溯「當時審的是哪一顆」），但不再要求與當下的
 * base/head 相同。取而代之的是 `changeDigest`：綁的是**變更內容**，不是 commit 身分。
 * 理由見 `changeDigestOf()` 的檔頭。
 *
 * `testBaseline` 仍是 reviewer 當時實際採用的測試基線。純換底時不要把它改寫成新的
 * CI run id；新的 exact-head CI 是獨立的 merge evidence。這樣 semantic review 綁定的
 * 證據不被一個無內容變更的 CI 編號更新自行作廢。
 */
const fields = ['repository', 'policyVersion', 'testBaseline', 'schemaBaseline', 'changeDigest'];

/**
 * 這次候選變更的內容指紋。
 *
 * 取每一個 changed file 的（最終路徑、rename 前路徑、狀態、**head 上的 blob sha**），
 * 排序後 sha256。blob sha 由 GitHub 直接給出，代表那個檔案在 head 上的實際內容。
 *
 * ## 它解決什麼問題
 *
 * 原本的規則是「review 必須釘在當下的 head commit」。這在**純換底**時會失效：
 * rebase 只換 parent、不改任何檔案內容，卻產生一顆新的 commit sha，於是一份完全
 * 有效的評估被判定為「找不到本 head 的評估」。而 main 只要有別的 PR 合併，所有
 * 在途的高風險 PR 就都要重跑一次最後風險評估——PR #292 因此連跑了四輪，其中兩輪
 * 的差異只是換底。這讓高風險 PR 在活躍的 main 上難以收斂，而且每一輪重評都不是
 * 免費的。
 *
 * ## 它為什麼在換底時不變、在夾帶修改時會變
 *
 * rebase 不改檔案內容，同一組檔案在新 head 上的 blob sha 逐一相同，指紋因此不變。
 * 反過來，只要換底過程中有任何一個檔案被靜默合併、或有人趁機夾帶修改，該檔案的
 * blob sha 就變了，指紋跟著變，舊評估立刻失效。
 *
 * ## 安全性論證
 *
 * 指紋只涵蓋**變更過的檔案**，未變更的檔案來自 base。而 PR 的 base 是受保護的
 * 預設分支，它自己的每一次前進都通過同一道閘門。所以「舊評估 ＋ 新 base」＝
 * 「已審查過的檔案內容 ＋ 已受同一道閘門把關的基底」，兩邊都不是未經審查的東西。
 *
 * ⚠️ 這是一次**放寬**，所以每一環都 fail closed：`listFiles` 被截斷時呼叫端就先
 * 擋掉（`Incomplete changed-file inventory`）；任一欄缺漏就不產生指紋（回空字串，
 * 而不是產生一個比對得過、實際上沒涵蓋內容的值）；`changeDigest` 缺漏、格式不符、
 * 或與本次算出來的不同，一律 ASTRA_PENDING。
 *
 * ## 已知邊界（誠實記錄，不要當成它涵蓋了）
 *
 * 1. blob sha 不含檔案 mode，所以**已審檔案單純加減 exec bit**（100644↔100755）
 *    不會改變指紋。本 repo 不以 `./script` 形式執行任何受版控檔案，實質風險極低，
 *    但這是一條真實存在的縫隙。
 * 2. 指紋涵蓋的是「本 PR 改過的那些檔案的內容」，不是「合併後那棵樹」。若 main
 *    在評估後改了同一個檔案的另一段，git 自動合併出來的**組合結果**沒有被這道
 *    閘門看過；語意衝突（main 改了簽章、本 PR 呼叫舊簽章）同理。這兩種情況由
 *    CI 的 typecheck／測試把關，不是本閘門的職責——但「兩邊都審過」不等於
 *    「整合結果審過」，措辭不要放大。
 *
 * ## 排序為什麼不是 localeCompare
 *
 * `localeCompare` 不指定 locale 時採 process 的 ICU 預設，實測同一組路徑在
 * `da_DK` 下與在 `C.UTF-8` 下會排出不同順序，Unicode NFC／NFD 等價路徑更會回 0
 * 而讓順序取決於輸入。那只會造成誤擋（指紋對不上）而非放行，但一個放行條件不該
 * 依賴執行環境的 locale。改用 JS 原生的 `<` / `>` 之後，同一組輸入在任何機器上
 * 都是同一個值。
 *
 * ⚠️ 精確地說，那是**逐 UTF-16 code unit** 比較，不是逐 UTF-8 byte——BMP 以外的
 * 字元（surrogate pair）排出來的位置與 UTF-8 byte 序不同。這不影響這裡要的性質：
 * 我們需要的是「一個與執行環境無關的**全序**」，不是「與 code point 序一致」。
 * 名字寫成 byte-wise 會讓人以為是後者，所以不那樣叫。
 */
const codeUnitWise = (a, b) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export function changeDigestOf(files = []) {
  const rows = (Array.isArray(files) ? files : [])
    .map((f) => [
      String(f?.filename ?? ''),
      String(f?.previous_filename ?? ''),
      String(f?.status ?? ''),
      String(f?.sha ?? ''),
    ])
    .sort(codeUnitWise);
  if (!rows.length || rows.some((r) => !r[0] || !r[2] || !r[3])) return '';
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

const allowedFinalRiskModels = (policy) => {
  const configured = policy.models?.finalRiskAllowedModels;
  const catalog = policy.models?.finalRiskModelCatalog;
  const validList = (models) => Array.isArray(models) && models.length > 0 &&
    models.every(model => typeof model === 'string' && model.trim().length > 0) &&
    new Set(models).size === models.length;
  if (!validList(configured) || !validList(catalog)) return new Set();
  const catalogSet = new Set(catalog);
  if (!catalogSet.has(policy.models?.finalRisk) || !configured.includes(policy.models.finalRisk) || configured.some(model => !catalogSet.has(model))) {
    return new Set();
  }
  return new Set(configured);
};

/**
 * Trusted Agent bots are an explicit trusted-main trust root, never "all bots".
 * Login + immutable GitHub user id + account type must all match. A malformed
 * catalog fails closed by trusting none of it.
 */
const trustedFinalRiskAgentBots = (policy) => {
  const configured = policy.finalRiskTrust?.trustedAgentBots;
  if (!Array.isArray(configured) || !configured.length) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of configured) {
    const login = typeof entry?.login === 'string' ? entry.login.trim() : '';
    const id = Number(entry?.id);
    const type = typeof entry?.type === 'string' ? entry.type.trim() : '';
    const key = `${login}\u0000${id}\u0000${type}`;
    if (!login || !Number.isSafeInteger(id) || id <= 0 || type !== 'Bot' || seen.has(key)) return [];
    seen.add(key);
    normalized.push({ login, id, type });
  }
  return normalized;
};

export function isTrustedFinalRiskAgentUser(user = {}, policy = routing) {
  const login = typeof user?.login === 'string' ? user.login.trim() : '';
  const id = Number(user?.id);
  const type = typeof user?.type === 'string' ? user.type.trim() : '';
  return trustedFinalRiskAgentBots(policy).some(entry =>
    entry.login === login && entry.id === id && entry.type === type
  );
}

const normalizedWorkstream = (body = '') => readField(body, 'WORKSTREAM').trim().toUpperCase();
const validDate = (value) => {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : null;
};
const pathWithin = (path, prefixes = []) => prefixes.some((prefix) => path === prefix || path.startsWith(prefix));

/**
 * MODEL_GOVERNANCE 是 audit 層的工作，而 audit 層在兩個 provider 上各有一個模型：
 * OpenAI 側 `gpt-5.6-sol`、Anthropic 側 `claude-opus-5`（`anthropicEquivalents.audit`）。
 * 同層等價，所以兩者都算合規；`allowedModels` 未設定時退回單一 `model`，舊設定不受影響。
 */
const governanceModels = (governance = {}) => {
  const allowed = Array.isArray(governance.allowedModels) ? governance.allowedModels.filter(Boolean) : [];
  return allowed.length ? allowed : [governance.model].filter(Boolean);
};

/**
 * 逐一取出 `requested=` / `actual=` 的值再比對，而不是對整行做子字串比對。
 * 子字串比對會把 `requested=gpt-5.6-sol-preview` 這種更長的字串當成命中，
 * 而清單一旦有兩個值，寬鬆比對的誤判面積就會變大。
 */
const declaredModel = (line = '', field) =>
  (String(line).match(new RegExp(`\\b${field}\\s*=\\s*([A-Za-z0-9._-]+)`, 'i'))?.[1] ?? '').trim();

/**
 * Workstream is a trusted-main classification contract. New PRs created after
 * workstreams.effectiveAt must declare one. Older PRs stay on legacy behavior
 * until they are intentionally backfilled, so the rollout does not freeze the
 * whole open inventory at once.
 *
 * @param {{body?: string, changedFiles?: string[] | null, createdAt?: string}} [input]
 */
export function classifyWorkstream({ body = '', changedFiles = null, createdAt = '' } = {}, policy = routing) {
  const config = policy.workstreams ?? {};
  const allowed = Array.isArray(config.allowed) ? config.allowed : [];
  const raw = normalizedWorkstream(body);
  const errors = [];
  const effectiveAt = validDate(config.effectiveAt);
  const created = validDate(createdAt);
  const policyApplies = effectiveAt !== null && created !== null && created >= effectiveAt;

  if (!raw) {
    if (policyApplies) errors.push('WORKSTREAM is required for PRs created after the two-workstream policy effective time');
    return { workstream: 'LEGACY_UNCLASSIFIED', isModelGovernance: false, policyApplies, errors };
  }

  if (!allowed.includes(raw)) {
    errors.push(`WORKSTREAM must be one of: ${allowed.join(', ')}`);
    return { workstream: raw, isModelGovernance: false, policyApplies: true, errors };
  }

  if (raw === config.modelGovernance?.workstream) {
    const governance = config.modelGovernance ?? {};
    if (readField(body, 'AGENT_LANE').trim().toUpperCase() !== governance.lane) {
      errors.push(`MODEL_GOVERNANCE requires AGENT_LANE: ${governance.lane}`);
    }
    if (readField(body, 'ASTRA_RISK').trim().toUpperCase() !== governance.risk) {
      errors.push(`MODEL_GOVERNANCE requires ASTRA_RISK: ${governance.risk}`);
    }
    if (readField(body, 'FINAL_RISK_POLICY').trim().toUpperCase() !== governance.finalRiskPolicy) {
      errors.push(`MODEL_GOVERNANCE requires FINAL_RISK_POLICY: ${governance.finalRiskPolicy}`);
    }
    const modelLine = readField(body, 'REQUESTED_MODEL / ACTUAL_MODEL');
    const allowedModels = governanceModels(governance);
    const declared = { requested: declaredModel(modelLine, 'requested'), actual: declaredModel(modelLine, 'actual') };
    if (!allowedModels.includes(declared.requested) || !allowedModels.includes(declared.actual)) {
      errors.push(`MODEL_GOVERNANCE requires requested/actual model to be one of: ${allowedModels.join(', ')}`);
    }
    if (Array.isArray(changedFiles) && changedFiles.length) {
      const outside = changedFiles.filter((path) => !pathWithin(path, governance.scopePrefixes));
      if (outside.length) {
        errors.push(`MODEL_GOVERNANCE contains Product/non-governance path(s): ${outside.join(', ')}`);
      }
    }
    return { workstream: raw, isModelGovernance: true, policyApplies: true, errors };
  }

  return { workstream: raw, isModelGovernance: false, policyApplies: true, errors };
}

/** @param {{body?: string, changedFiles?: string[] | null, createdAt?: string}} [input] */
export function classifyAstra({ body = '', changedFiles = null, createdAt = '' } = {}, policy = routing) {
  const risks = readField(body, 'ASTRA_RISK').split(',').map(s => s.trim()).filter(Boolean);
  const workstream = classifyWorkstream({ body, changedFiles, createdAt }, policy);
  const errors = [...workstream.errors];
  if (!risks.length || risks.some(r => r !== 'NONE' && !policy.highRisk.includes(r)) || (risks.includes('NONE') && risks.length > 1)) {
    errors.push('ASTRA_RISK must be NONE or a comma-separated list of configured risks');
  }
  if (!meaningful(readField(body, 'ASTRA_RATIONALE'))) errors.push('ASTRA_RATIONALE requires a concrete risk assessment');
  if (!Array.isArray(changedFiles) || !changedFiles.length) errors.push('Astra classification requires actual changed files');
  if (workstream.isModelGovernance) {
    return { ...workstream, required: false, risks, errors: [...new Set(errors)] };
  }
  const sensitive = (changedFiles ?? []).some(path => policy.sensitivePaths.some(prefix => path.startsWith(prefix)));
  return { ...workstream, required: sensitive || risks.some(r => policy.highRisk.includes(r)), risks, errors: [...new Set(errors)] };
}

// Only trusted GitHub review records supplied by the caller may become attestations.
// OPERATOR_ATTESTED means the trusted submitting actor attests the model dispatch;
// that actor may be a write-capable human or an explicitly allowlisted Agent bot.
// This is still not provider-signed model telemetry.
/** @param {Array<Record<string, any>>} [reviews] */
export function parseAstraReviews(reviews = []) {
  return reviews.filter(r => r.trusted === true).flatMap(r => {
    const body = String(r.body ?? '');
    if (!body.includes('astra-review') && !['CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) return [];
    const record = {
      reviewState: r.state,
      commitId: r.commit_id,
      submittedAt: r.submitted_at,
      reviewId: r.id,
      trustSource: r.trustSource ?? 'UNKNOWN',
      reviewerLogin: r.user?.login ?? '',
      reviewerId: r.user?.id ?? null,
      reviewerType: r.user?.type ?? '',
    };
    const match = body.match(/```astra-review\s*\n([\s\S]*?)\n```/);
    try {
      if (!match) throw new Error('Malformed attestation');
      return [{ ...JSON.parse(match[1]), ...record }];
    } catch { return [{ ...record, parseError: true }]; }
  }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)) || Number(b.reviewId) - Number(a.reviewId));
}

/** @param {{body?: string, changedFiles?: string[] | null, context?: Record<string, string>, reviews?: Array<Record<string, any>>}} [input] */
export function evaluateAstra({ body = '', changedFiles = null, context = {}, reviews = [] } = {}, policy = routing) {
  const classification = classifyAstra({ body, changedFiles, createdAt: context.createdAt }, policy);
  if (classification.errors.length) return { ...classification, status: 'ASTRA_PENDING' };
  if (!classification.required) return { ...classification, status: 'NOT_REQUIRED' };
  const errors = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(context.repository ?? '')) errors.push('Missing repository identity');
  for (const key of ['baseSha', 'headSha']) if (!SHA.test(context[key] ?? '')) errors.push(`Missing exact ${key}`);
  if (!DIGEST.test(context.changeDigest ?? '')) errors.push('Missing change digest for this candidate');
  if (context.policyVersion !== policy.version) errors.push('Trusted policy version mismatch');
  for (const key of ['testBaseline', 'schemaBaseline']) if (!meaningful(context[key])) errors.push(`Missing concrete ${key}`);

  const parsed = parseAstraReviews(reviews);
  const latest = parsed[0];
  if (!latest) errors.push('No trusted Astra attestation for this head');
  else {
    for (const key of fields) if (latest[key] !== context[key]) errors.push(`Astra evidence is stale: ${key}`);
    for (const key of ['baseSha', 'headSha']) {
      if (!SHA.test(latest[key] ?? '')) errors.push(`Astra evidence is stale: ${key}`);
    }
    if (!['COMMENTED', 'APPROVED'].includes(latest.reviewState)) errors.push('Astra review is dismissed or requests changes');
    if (latest.verdict !== 'PASS') errors.push('Astra verdict is not PASS');
    const allowedModels = allowedFinalRiskModels(policy);
    if (
      latest.requestedModel !== latest.actualModel ||
      !allowedModels.has(latest.requestedModel) ||
      !allowedModels.has(latest.actualModel)
    ) errors.push('Astra model identity is unverified');
    if (latest.identityEvidence !== 'OPERATOR_ATTESTED') errors.push('Missing explicit operator model attestation');
    if (!meaningful(latest.report) || !/^https:\/\/github\.com\//.test(latest.report)) errors.push('Missing durable review report URL');
    if (!meaningful(latest.findings)) errors.push('Missing Astra findings');
  }
  return { ...classification, errors, status: errors.length ? 'ASTRA_PENDING' : 'ASTRA_APPROVED' };
}

// REST calls are read-only. Never load policy/code from a PR or execute evidence content.
export async function evaluateGithubAstra({ github, owner, repo, current }, policy = routing) {
  const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: current.number, per_page: 100 });
  if (files.length !== current.changed_files) throw new Error('Incomplete changed-file inventory');
  const changedFiles = [...new Set(files.flatMap(f => [f.filename, f.previous_filename].filter(Boolean)))];
  const body = current.body ?? '';
  const classification = classifyAstra({ body, changedFiles, createdAt: current.created_at }, policy);
  const reviews = [];
  if (classification.required && !classification.errors.length) {
    const records = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: current.number, per_page: 100 });
    const permissions = new Map();
    for (const review of records.filter(r => r.body?.includes('astra-review') || ['CHANGES_REQUESTED', 'DISMISSED'].includes(r.state))) {
      const login = review.user?.login;
      if (!login) continue;

      if (isTrustedFinalRiskAgentUser(review.user, policy)) {
        reviews.push({ ...review, trusted: true, trustSource: 'TRUSTED_AGENT_BOT' });
        continue;
      }

      if (!permissions.has(login)) {
        try {
          const response = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
          permissions.set(login, ['admin', 'maintain', 'write'].includes(response.data.permission));
        } catch (error) {
          if (error?.status !== 404) throw error;
          permissions.set(login, false);
        }
      }
      reviews.push({ ...review, trusted: permissions.get(login), trustSource: permissions.get(login) ? 'WRITE_ACTOR' : 'UNTRUSTED' });
    }
  }
  const digest = changeDigestOf(files);
  const result = evaluateAstra({ body, changedFiles, reviews, context: {
    repository: `${owner}/${repo}`, baseSha: current.base.sha, headSha: current.head.sha,
    policyVersion: policy.version, testBaseline: readField(body, 'ASTRA_TEST_BASELINE'),
    schemaBaseline: readField(body, 'ASTRA_SCHEMA_BASELINE'),
    changeDigest: digest, createdAt: current.created_at,
  } }, policy);
  return { ...result, changeDigest: digest };
}