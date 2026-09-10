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

const OWNER_WAIVER_STATUS = /^OWNER_WAIVED_FOR_PR_(\d+)_\d{4}_\d{2}_\d{2}$/;
const OWNER_WAIVER_REVOKED_STATUS = /^OWNER_WAIVER_(?:REVOKED|DENIED)_FOR_PR_(\d+)_\d{4}_\d{2}_\d{2}$/;
const OWNER_WAIVER_INVALIDATED = /^PR #(\d+)$/;

/**
 * @param {{current?: Record<string, any>, owner?: string, origin?: string, laneState?: string, body?: string, ownerAttestations?: Array<Record<string, any>>, changeDigest?: string}} [input]
 *
 * A one-time Owner waiver is a merge-admission exception, never a model review.
 * It is intentionally narrow: only the repository owner may author it, the PR
 * must be explicitly OWNER-origin and OWNER_BLOCKED, and the scope must bind to
 * this PR. Draft, parked, agent-authored and copied waiver text fail closed.
 *
 * Owner comments are event-sourced evidence. A later edit/delete event creates a
 * durable invalidation marker, so removing a revoke/deny cannot revive an older
 * grant. A later complete grant may explicitly renew the waiver.
 */
export function isOwnerFinalRiskWaiver({
  current = {},
  owner = '',
  origin = '',
  laneState = '',
  body = current.body ?? '',
  ownerAttestations = [],
  changeDigest = '',
} = {}) {
  const trustedOwner = String(owner).trim();
  const number = Number(current.number ?? 0);
  if (
    String(current.state ?? '').trim().toLowerCase() !== 'open' ||
    current.draft === true ||
    !trustedOwner ||
    String(current.user?.login ?? '').trim() !== trustedOwner ||
    String(current.head?.repo?.owner?.login ?? '').trim() !== trustedOwner ||
    String(origin).trim().toUpperCase() !== 'OWNER' ||
    String(laneState).trim().toUpperCase() !== 'OWNER_BLOCKED' ||
    !Number.isInteger(number) ||
    number < 1
  ) return false;

  const status = readField(body, 'FINAL_RISK_STATUS');
  const statusMatch = status.match(OWNER_WAIVER_STATUS);
  if (!statusMatch || Number(statusMatch[1]) !== number) return false;
  const scope = readField(body, 'FINAL_RISK_WAIVER_SCOPE');
  if (scope !== `PR #${number} only; one-time exception; does not change the repository default Final Risk policy or authorize fake model evidence`) {
    return false;
  }
  if (readField(body, 'ASTRA_REVIEW_STATUS') !== status || !/^[a-f0-9]{64}$/i.test(changeDigest)) return false;

  const eventTime = (comment) => {
    const updated = Date.parse(String(comment?.updated_at ?? ''));
    if (Number.isFinite(updated)) return updated;
    return Date.parse(String(comment?.created_at ?? ''));
  };
  const ownerEvents = ownerAttestations
    .map((comment) => ({ comment, kind: 'owner' }))
    .filter(({ comment }) => String(comment?.user?.login ?? '').trim() === trustedOwner)
    .filter(({ comment }) => readField(String(comment?.body ?? ''), 'OWNER_FINAL_RISK_WAIVER') === `PR #${number}`);
  const invalidationEvents = ownerAttestations
    .map((comment) => ({ comment, kind: 'invalidation' }))
    .filter(({ comment }) => {
      const body = String(comment?.body ?? '');
      const invalidated = readField(body, 'OWNER_FINAL_RISK_INVALIDATED');
      const match = invalidated.match(OWNER_WAIVER_INVALIDATED);
      return (
        String(comment?.user?.login ?? '').trim() === 'github-actions[bot]' &&
        body.includes('<!-- agent-wip-guard-waiver-invalidation -->') &&
        Boolean(match && Number(match[1]) === number) &&
        meaningful(readField(body, 'INVALIDATION_EVENT_KEY'))
      );
    });
  const relevantEvents = [...ownerEvents, ...invalidationEvents];

  // Never use comment id or array order as a proxy for chronology. Every
  // relevant event must carry a real GitHub timestamp; if two events have
  // equal timestamps, fail closed rather than allowing an older grant to win
  // by accident.
  if (relevantEvents.some(({ comment }) => !Number.isFinite(eventTime(comment)))) return false;
  if (relevantEvents.length > 1) {
    for (let left = 0; left < relevantEvents.length; left += 1) {
      for (let right = left + 1; right < relevantEvents.length; right += 1) {
        const leftTime = eventTime(relevantEvents[left].comment);
        const rightTime = eventTime(relevantEvents[right].comment);
        if (leftTime === rightTime) return false;
      }
    }
  }

  const latestEvent = [...relevantEvents].sort(
    (left, right) => eventTime(left.comment) - eventTime(right.comment),
  ).at(-1);
  if (!latestEvent || latestEvent.kind === 'invalidation') return false;

  const latestBody = String(latestEvent.comment.body ?? '');
  const latestStatus = readField(latestBody, 'WAIVER_STATUS');
  const revoked = latestStatus.match(OWNER_WAIVER_REVOKED_STATUS);
  if (revoked && Number(revoked[1]) === number) return false;
  if (latestStatus !== status) return false;
  return (
    /^[a-f0-9]{40}$/i.test(readField(latestBody, 'REVIEWED_HEAD')) &&
    readField(latestBody, 'CHANGE_DIGEST').toLowerCase() === changeDigest.toLowerCase()
  );
}

export function ownerWaiverLifecycleStatus({
  lifecycleEvent = false,
  invalidationPersisted = false,
  freshState = 'closed',
} = {}) {
  if (!lifecycleEvent || !invalidationPersisted) return null;
  return String(freshState).trim().toLowerCase() === 'open' ? 'failure' : null;
}

export function finalRiskGateStatus({
  hasErrors = false,
  finalRiskRequired = false,
  ownerFinalRiskWaived = false,
} = {}) {
  if (hasErrors) return 'failure';
  return finalRiskRequired || ownerFinalRiskWaived ? 'success' : 'pending';
}

/**
 * 逐字比對的欄位。
 *
 * ⚠️ `baseSha` / `headSha` **刻意不在這裡**——它們仍必須出現在 attestation 裡
 * （下方單獨驗格式，供稽核追溯「當時審的是哪一顆」），但不再要求與當下的
 * base/head 相同。取而代之的是 `changeDigest`：綁的是**變更內容**，不是 commit 身分。
 * 理由見 `changeDigestOf()` 的檔頭。
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

/** @param {{body?: string, changedFiles?: string[] | null}} [input] */
export function classifyAstra({ body = '', changedFiles = null } = {}, policy = routing) {
  const risks = readField(body, 'ASTRA_RISK').split(',').map(s => s.trim()).filter(Boolean);
  const errors = [];
  if (!risks.length || risks.some(r => r !== 'NONE' && !policy.highRisk.includes(r)) || (risks.includes('NONE') && risks.length > 1)) {
    errors.push('ASTRA_RISK must be NONE or a comma-separated list of configured risks');
  }
  if (!meaningful(readField(body, 'ASTRA_RATIONALE'))) errors.push('ASTRA_RATIONALE requires a concrete risk assessment');
  if (!Array.isArray(changedFiles) || !changedFiles.length) errors.push('Astra classification requires actual changed files');
  const sensitive = (changedFiles ?? []).some(path => policy.sensitivePaths.some(prefix => path.startsWith(prefix)));
  return { required: sensitive || risks.some(r => policy.highRisk.includes(r)), risks, errors };
}

// Only trusted GitHub review records supplied by the caller may become attestations.
// The author attests model identity; this is not provider-signed model telemetry.
/** @param {Array<Record<string, any>>} [reviews] */
export function parseAstraReviews(reviews = []) {
  return reviews.filter(r => r.trusted === true).flatMap(r => {
    const body = String(r.body ?? '');
    if (!body.includes('astra-review') && !['CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) return [];
    const record = { reviewState: r.state, commitId: r.commit_id, submittedAt: r.submitted_at, reviewId: r.id };
    const match = body.match(/```astra-review\s*\n([\s\S]*?)\n```/);
    try {
      if (!match) throw new Error('Malformed attestation');
      return [{ ...JSON.parse(match[1]), ...record }];
    } catch { return [{ ...record, parseError: true }]; }
  }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)) || Number(b.reviewId) - Number(a.reviewId));
}

/** @param {{body?: string, changedFiles?: string[] | null, context?: Record<string, string>, reviews?: Array<Record<string, any>>}} [input] */
export function evaluateAstra({ body = '', changedFiles = null, context = {}, reviews = [] } = {}, policy = routing) {
  const classification = classifyAstra({ body, changedFiles }, policy);
  if (classification.errors.length) return { ...classification, status: 'ASTRA_PENDING' };
  if (!classification.required) return { ...classification, status: 'NOT_REQUIRED' };
  const errors = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(context.repository ?? '')) errors.push('Missing repository identity');
  for (const key of ['baseSha', 'headSha']) if (!SHA.test(context[key] ?? '')) errors.push(`Missing exact ${key}`);
  // ⚠️ 沒有可用的內容指紋就不能往下走。少了這一行，`latest.changeDigest !== context.changeDigest`
  // 會在兩邊都 undefined 時「通過」，等於把整條放寬變成無條件放行。
  if (!DIGEST.test(context.changeDigest ?? '')) errors.push('Missing change digest for this candidate');
  if (context.policyVersion !== policy.version) errors.push('Trusted policy version mismatch');
  for (const key of ['testBaseline', 'schemaBaseline']) if (!meaningful(context[key])) errors.push(`Missing concrete ${key}`);

  /**
   * 取**最新的一筆**可信 review，然後要求它適用於本候選。
   *
   * ⚠️ 這裡刻意不是 `find(r => r.commitId === context.headSha)`。原寫法只挑「釘在
   * 當下 head 的那一筆」，有兩個後果：
   *
   *   1. 純換底時完全找不到評估（rebase 換了 commit sha，內容一個字都沒動）。
   *   2. **更嚴重**：釘在別顆 head 上的較新否決（CHANGES_REQUESTED / FIX_REQUIRED）
   *      會被直接跳過，讓一份較舊的 PASS 存活。
   *
   * 改成「取最新那一筆，再要求它對得上本候選」之後，兩者一起解決：換底時靠
   * `changeDigest` 對得上；而任何較新的否決都會成為那一筆 latest，於是照樣擋下。
   * 這一步是**收緊**，不是放寬。
   */
  const parsed = parseAstraReviews(reviews);
  const latest = parsed[0];
  if (!latest) errors.push('No trusted Astra attestation for this head');
  else {
    for (const key of fields) if (latest[key] !== context[key]) errors.push(`Astra evidence is stale: ${key}`);
    /**
     * `baseSha` / `headSha` 不再要求與當下相同（純換底時它們本來就會不同），
     * 但**仍必須是格式正確的 40 碼**：它們是稽核紀錄——「當時審的是哪一顆」。
     * 少了這道，一份把 headSha 填成任意字串的 attestation 也會通過，追溯線就斷了。
     */
    for (const key of ['baseSha', 'headSha']) {
      if (!SHA.test(latest[key] ?? '')) errors.push(`Astra evidence is stale: ${key}`);
    }
    /**
     * 這裡**刻意沒有**「commitId 必須等於 headSha」那條檢查了。
     *
     * 曾經寫過一條 `commitId !== headSha && !DIGEST.test(latest.changeDigest)` 的
     * 捷徑，但它是死碼：`changeDigest` 已經在上面的 `fields` 迴圈裡逐字比對過，
     * 而 `context.changeDigest` 在函式開頭就要求是合法的 64 碼。所以只要 fields
     * 迴圈放行，`latest.changeDigest` 必然合法且等於本次算出的值，那條 if 永遠
     * 不會成立。留著只會讓讀的人以為還有一道獨立防線——PB-027 的形狀。
     *
     * 現在「這份評估適用於本候選」完全由 `changeDigest` 承擔；`commitId` 仍被
     * 記錄下來（來自 GitHub，不可偽造），但只作為稽核用途。
     */
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
  const classification = classifyAstra({ body, changedFiles }, policy);
  const reviews = [];
  if (classification.required && !classification.errors.length) {
    const records = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: current.number, per_page: 100 });
    const permissions = new Map();
    for (const review of records.filter(r => r.body?.includes('astra-review') || ['CHANGES_REQUESTED', 'DISMISSED'].includes(r.state))) {
      const login = review.user?.login;
      if (!login) continue;
      if (!permissions.has(login)) {
        const response = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
        permissions.set(login, ['admin', 'maintain', 'write'].includes(response.data.permission));
      }
      reviews.push({ ...review, trusted: permissions.get(login) });
    }
  }
  const digest = changeDigestOf(files);
  const result = evaluateAstra({ body, changedFiles, reviews, context: {
    repository: `${owner}/${repo}`, baseSha: current.base.sha, headSha: current.head.sha,
    policyVersion: policy.version, testBaseline: readField(body, 'ASTRA_TEST_BASELINE'),
    schemaBaseline: readField(body, 'ASTRA_SCHEMA_BASELINE'),
    // 指紋由**受信任的預設分支**這份程式算出，且原料是 GitHub 直接給的 blob sha，
    // 不採信 PR 或 attestation 自填的任何內容（同一份檔案清單上面已驗過沒有被截斷）。
    changeDigest: digest,
  } }, policy);
  /**
   * 把算出來的指紋一起回傳，讓 guard 能把它印在 summary 與 PR 留言裡。
   *
   * 少了這一步，這道閘門會要求一個「操作者無從得知」的必填欄位：文件說「把檢查器
   * 算出來的同一個值填進 attestation」，但檢查器從來沒有把它說出口。那會讓下一支
   * 高風險 PR 直接卡死——正是這支 PR 想要消除的那種收斂不了的狀態。
   */
  return { ...result, changeDigest: digest };
}
