import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/agent-wip-guard.yml'),
  'utf8',
);

describe('agent WIP Guard live-state dispatch', () => {
  it('re-reads the current PR before parsing metadata or deciding a TEST transition', () => {
    const guardIndex = workflow.indexOf('  guard:');
    const payloadIndex = workflow.indexOf(
      'const payloadCurrent = context.payload.pull_request ?? { number: context.payload.issue.number };',
      guardIndex,
    );
    const liveReadIndex = workflow.indexOf(
      'const { data: current } = await github.rest.pulls.get({',
      guardIndex,
    );
    const metadataIndex = workflow.indexOf(
      'const metadata = policy.parseLaneMetadata(current);',
      guardIndex,
    );

    expect(payloadIndex).toBeGreaterThan(-1);
    expect(liveReadIndex).toBeGreaterThan(payloadIndex);
    expect(metadataIndex).toBeGreaterThan(liveReadIndex);
    expect(workflow).toContain('pull_number: payloadCurrent.number');
    expect(workflow).not.toContain(
      'const current = context.payload.pull_request;',
    );
  });

  it('uses live labels rather than stale event labels for one-shot remote TEST dispatch', () => {
    const liveLabelsIndex = workflow.indexOf(
      'const liveExisting = (current.labels ?? [])',
    );
    const labelWriteIndex = workflow.indexOf(
      'await github.rest.issues.setLabels({',
    );
    const dispatchDecisionIndex = workflow.indexOf(
      "!liveExisting.includes('lane:test-validation')",
    );
    const dispatchIndex = workflow.indexOf(
      'await github.rest.actions.createWorkflowDispatch({',
    );

    expect(liveLabelsIndex).toBeGreaterThan(-1);
    expect(labelWriteIndex).toBeGreaterThan(liveLabelsIndex);
    expect(dispatchDecisionIndex).toBeGreaterThan(labelWriteIndex);
    expect(dispatchIndex).toBeGreaterThan(dispatchDecisionIndex);
    expect(workflow).not.toContain(
      "!rawExisting.includes('lane:test-validation')",
    );
  });

  it('defers Final Risk until the live PR is active and non-draft', () => {
    const metadataIndex = workflow.indexOf(
      'const metadata = policy.parseLaneMetadata(current);',
    );
    const gateIndex = workflow.indexOf(
      'const finalRiskRequired = astra.shouldEnforceFinalRisk({',
    );
    const evaluationIndex = workflow.indexOf(
      'await astra.evaluateGithubAstra({ github, owner, repo, current })',
    );

    expect(metadataIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(metadataIndex);
    expect(evaluationIndex).toBeGreaterThan(gateIndex);
    expect(workflow).toContain('draft: current.draft === true');
    expect(workflow).toContain('const ownerFinalRiskWaived = astra.isOwnerFinalRiskWaiver({');
    expect(workflow).toContain('ownerWaiverChangeDigest = astra.changeDigestOf(ownerWaiverFiles);');
    expect(workflow).toContain('ownerAttestations: ownerWaiverComments,');
    expect(workflow).toContain("status: current.state === 'open' ? 'DEFERRED_NON_ACTIVE' : 'NOT_REQUIRED'");
    expect(workflow).toContain('const policyStatus = lifecyclePolicyStatus ?? astra.finalRiskGateStatus({');
    expect(workflow).toContain('ownerFinalRiskWaived,');
    expect(workflow).toContain('state: policyStatus');
    expect(workflow).toContain('Agent WIP Policy intentionally remains pending and is not an approval');
    expect(workflow).toContain('## Agent WIP Guard: deferred — not an approval');
    expect(workflow).toContain('- FINAL_RISK_GATE: ${finalRiskRequired ? \'ENFORCED\' : \'DEFERRED_NON_ACTIVE\'}');
  });

  it('revalidates draft and lifecycle state before writing the required status', () => {
    const rereadIndex = workflow.indexOf(
      'const { data: fresh } = await github.rest.pulls.get({ owner, repo, pull_number: current.number });',
    );
    const statusIndex = workflow.indexOf(
      'await github.rest.repos.createCommitStatus({',
      rereadIndex,
    );

    expect(rereadIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(rereadIndex);
    expect(workflow).toContain('fresh.draft !== current.draft');
    expect(workflow).toContain('fresh.state !== current.state');
  });

  it('serializes only the same PR and cancels stale in-flight guard runs', () => {
    expect(workflow).toContain(
      'group: agent-wip-guard-${{ github.repository }}-${{ github.event.pull_request.number || github.event.issue.number }}',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).not.toContain('github.run_id || \'pull-request\'');
    expect(workflow).not.toContain('cancel-in-progress: true');
    expect(workflow).not.toMatch(/^concurrency:/m);
    expect(workflow).toMatch(/^    concurrency:/m);
    expect(workflow).not.toContain('  pull_request_review:');
    expect(workflow).toContain('types: [created, edited, deleted]');
    expect(workflow).toContain("github.event_name == 'issue_comment' && github.event.issue.pull_request");
    expect(workflow).toContain('persist_owner_waiver_invalidation:');
    expect(workflow).toContain('needs: persist_owner_waiver_invalidation');
    expect(workflow).toContain('if: ${{ always() &&');
    expect(workflow).toContain('group: agent-wip-guard-invalidation-${{ github.repository }}-${{ github.event.issue.number }}-${{ github.run_id }}');
    expect(workflow).toContain('const invalidationJobResult = \'${{ needs.persist_owner_waiver_invalidation.result }}\';');
    expect(workflow).toContain('const waiverCommentFingerprint =');
    expect(workflow).toContain('OWNER_FINAL_RISK_INVALIDATED');
    expect(workflow).toContain('INVALIDATION_EVENT_KEY:');
    expect(workflow).toContain("context.eventName === 'pull_request_target' &&");
    expect(workflow).toContain('github.run_id');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain("comment?.user?.login === 'github-actions[bot]'");
    expect(workflow).toContain('ownerWaiverLifecycleStatus');
    expect(workflow).toContain('Owner waiver evidence changed during comment lifecycle; revalidation required');
    expect(workflow).toContain('Owner waiver comments changed during policy evaluation');
    expect(workflow).not.toContain('group: agent-wip-guard-${{ github.repository }}\n');
  });

  it('writes a dedicated policy status that remains failed even when duplicate email noise is suppressed', () => {
    expect(workflow).toContain('statuses: write');
    expect(workflow).toContain("context: 'Agent WIP Policy'");
    expect(workflow).toContain('state: policyStatus');
    expect(workflow).toContain('const policyStatus = lifecyclePolicyStatus ?? astra.finalRiskGateStatus({');
    expect(workflow).toContain('const duplicateFailure = Boolean(');
    expect(workflow).toContain('alert.isDuplicateWipFailure({');
    expect(workflow).toContain('DUPLICATE_NOTIFICATION_SUPPRESSED: ${duplicateFailure}');
    expect(workflow).toContain('OWNER_WAIVED_ONCE');

    const statusIndex = workflow.indexOf('await github.rest.repos.createCommitStatus({');
    const duplicateWarningIndex = workflow.indexOf('core.warning(`Duplicate WIP failure suppressed');
    const firstFailureIndex = workflow.indexOf('core.setFailed(errors.join');
    expect(statusIndex).toBeGreaterThan(-1);
    expect(duplicateWarningIndex).toBeGreaterThan(statusIndex);
    expect(firstFailureIndex).toBeGreaterThan(duplicateWarningIndex);
  });

  it('binds the fingerprint to the PR number, exact head and complete error set', () => {
    expect(workflow).toContain('alert.buildWipErrorFingerprint({');
    expect(workflow).toContain('prNumber: current.number');
    expect(workflow).toContain('headSha: current.head.sha');
    expect(workflow).toContain('errors,');
    expect(workflow).toContain('- EXACT_HEAD: ${current.head.sha}');
    expect(workflow).toContain('- ERROR_FINGERPRINT: ${fingerprint}');
  });
});

import {
  changeDigestOf, classifyAstra, evaluateAstra, evaluateGithubAstra, finalRiskGateStatus, routing, shouldEnforceFinalRisk,
} from '../../scripts/agents/astra-review-policy.mjs';

const body = 'ASTRA_RISK: NONE\nASTRA_RATIONALE: Change only an ordinary heading\n';
/** 一份代表性的 changed-file 清單；blob sha 是指紋的唯一內容來源 */
const FILES = [
  { filename: 'scripts/agents/model-routing.json', status: 'modified', sha: '1'.repeat(40) },
  { filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed', sha: '2'.repeat(40) },
];
const context = {
  repository: 'smallwei0301/vibeaico-admin-rebuild', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  policyVersion: routing.version, testBaseline: 'unit-run-123:no-db', schemaBaseline: 'NOT_APPLICABLE: no schema changes',
  changeDigest: changeDigestOf(FILES),
};
const makeReview = (patch = {}, record = {}) => ({
  trusted: true, id: 1, state: 'COMMENTED', commit_id: context.headSha, submitted_at: '2026-09-07T00:00:00Z',
  body: '```astra-review\n' + JSON.stringify({ ...context, requestedModel: routing.models.finalRisk,
    actualModel: routing.models.finalRisk, identityEvidence: 'OPERATOR_ATTESTED', verdict: 'PASS',
    report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/209', findings: 'No unresolved blocking findings in this scope', ...patch }) + '\n```',
  ...record,
});
const candidate = (reviews = [makeReview()], extra = {}) => ({ body, changedFiles: ['scripts/agents/model-routing.json'], context, reviews, ...extra });

describe('Astra lifecycle gate', () => {
  it('defers Final Risk for draft and non-active lifecycle states only', () => {
    expect(shouldEnforceFinalRisk({ pullRequestState: 'open', draft: false, laneState: 'ACTIVE' })).toBe(true);
    expect(shouldEnforceFinalRisk({ pullRequestState: 'open', draft: true, laneState: 'ACTIVE' })).toBe(false);
    for (const laneState of ['PARKED', 'COMPLETE', 'OWNER_BLOCKED', 'HISTORICAL', 'READY_FOR_PROMOTION']) {
      expect(shouldEnforceFinalRisk({ pullRequestState: 'open', draft: false, laneState })).toBe(false);
    }
  });

  it('fails closed for unknown lane states and does not enforce closed PRs', () => {
    expect(shouldEnforceFinalRisk({ pullRequestState: 'open', draft: false, laneState: 'STALE_UNKNOWN' })).toBe(true);
    expect(shouldEnforceFinalRisk({ pullRequestState: 'closed', draft: false, laneState: 'ACTIVE' })).toBe(false);
  });

  it('never reports deferred Final Risk as a passing policy status', () => {
    expect(finalRiskGateStatus({ hasErrors: true, finalRiskRequired: false })).toBe('failure');
    expect(finalRiskGateStatus({ hasErrors: false, finalRiskRequired: false })).toBe('pending');
    expect(finalRiskGateStatus({ hasErrors: false, finalRiskRequired: true })).toBe('success');
  });
});

describe('Astra risk review contract', () => {
  it('does not escalate ordinary UI work or routine DB wiring solely for touching DB', () => {
    for (const path of ['src/i18n/title.ts', 'src/server/customers.ts']) {
      expect(evaluateAstra({ body, changedFiles: [path] }).status).toBe('NOT_REQUIRED');
    }
  });
  it('requires review for semantic risks outside path heuristics', () => {
    for (const risk of routing.highRisk) expect(evaluateAstra({ body: body.replace('NONE', risk), changedFiles: ['src/lib/shared.ts'] }).status).toBe('ASTRA_PENDING');
  });
  it('does not allow NONE to downgrade a governance gate', () => {
    expect(classifyAstra(candidate()).required).toBe(true);
    expect(evaluateAstra(candidate([])).status).toBe('ASTRA_PENDING');
  });
  it('fails closed on missing inventory, risk or rationale', () => {
    for (const override of [{ changedFiles: null }, { changedFiles: [] }, { body: '' }, { body: body.replace('NONE', 'TYPO') }]) {
      expect(evaluateAstra(candidate([], override)).status).toBe('ASTRA_PENDING');
    }
  });
  it('accepts matching operator-attested evidence', () => expect(evaluateAstra(candidate()).status).toBe('ASTRA_APPROVED'));
  it('rejects every stale binding including unchanged code with changed environment', () => {
    for (const key of Object.keys(context)) expect(evaluateAstra(candidate([makeReview({ [key]: 'stale' })])).status).toBe('ASTRA_PENDING');
  });
  it('rejects unknown actual model, self-declared body pass and untrusted reviewers', () => {
    expect(evaluateAstra(candidate([makeReview({ actualModel: 'unknown' })])).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra(candidate([makeReview({}, { trusted: false })])).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra(candidate([], { body: body + '\nASTRA_STATUS: PASS' })).status).toBe('ASTRA_PENDING');
  });
  it('accepts either configured final-risk reviewer model', () => {
    expect(routing.models.finalRiskModelCatalog).toEqual(['gpt-6-astra', 'claude-fable-5-1']);
    expect(routing.models.finalRiskAllowedModels).toEqual(['gpt-6-astra', 'claude-fable-5-1']);
    for (const model of ['gpt-6-astra', 'claude-fable-5-1']) {
      expect(evaluateAstra(candidate([makeReview({ requestedModel: model, actualModel: model })])).status).toBe('ASTRA_APPROVED');
    }
  });
  it('fails closed on missing, malformed, or unknown final-risk allowlists', () => {
    for (const override of [
      { finalRiskAllowedModels: undefined },
      { finalRiskAllowedModels: [] },
      { finalRiskAllowedModels: 'claude-fable-5-1' },
      { finalRiskAllowedModels: ['gpt-6-astra', null] },
      { finalRiskAllowedModels: ['gpt-6-astra', 'unknown-model'] },
      { finalRiskModelCatalog: undefined },
    ]) {
      const policy = { ...routing, models: { ...routing.models, ...override } };
      expect(evaluateAstra(candidate(), policy).status).toBe('ASTRA_PENDING');
    }
  });
  it('rejects unknown or mixed final-risk reviewer models', () => {
    expect(evaluateAstra(candidate([makeReview({ requestedModel: 'unknown-model', actualModel: 'unknown-model' })])).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra(candidate([makeReview({ requestedModel: 'gpt-6-astra', actualModel: 'claude-fable-5-1' })])).status).toBe('ASTRA_PENDING');
  });
  it('does not reuse older pass after a newer rejection or dismissal', () => {
    for (const [patch, record] of [[{ verdict: 'FIX_REQUIRED' }, {}], [{}, { state: 'DISMISSED' }], [{ actualModel: 'unknown' }, {}]]) {
      const newer = makeReview(patch, { id: 2, submitted_at: '2026-09-07T01:00:00Z', ...record });
      expect(evaluateAstra(candidate([makeReview(), newer])).status).toBe('ASTRA_PENDING');
    }
  });
  it('does not fall back after malformed or mismatched latest attestation', () => {
    for (const latest of [makeReview({ repository: 'wrong/repo', verdict: 'FIX_REQUIRED' }), makeReview({}, { body: '```astra-review\nnot-json\n```' })]) {
      expect(evaluateAstra(candidate([makeReview(), { ...latest, id: 2, submitted_at: '2026-09-07T01:00:00Z' }])).status).toBe('ASTRA_PENDING');
    }
  });
  it('binds the actual GitHub review commit, not just the JSON claim', () => {
    // review 釘在別顆 commit 上、且其 changeDigest 也對不上本候選 → 不可放行
    expect(evaluateAstra(candidate([
      makeReview({ changeDigest: 'f'.repeat(64) }, { commit_id: 'c'.repeat(40) }),
    ])).status).toBe('ASTRA_PENDING');
  });

  /* ---- 純換底沿用（本輪新增的放寬），以及它的每一道 fail-closed ---- */

  it('純換底沿用：commit 換了但變更內容指紋相同 → 仍然有效', () => {
    // rebase 只換 parent，檔案內容一個字都沒改：blob sha 逐一相同 ⇒ 指紋不變。
    // 這正是 PR #292 連跑四輪、其中兩輪只是換底的那個情形。
    const rebased = makeReview({}, { commit_id: 'c'.repeat(40) });
    expect(evaluateAstra(candidate([rebased])).status).toBe('ASTRA_APPROVED');
  });

  it('換底時若有任何檔案被夾帶修改 → 指紋改變 → 不得沿用', () => {
    // 只要有一個 blob sha 不同（靜默合併、或趁換底夾帶），舊評估立刻失效。
    const tampered = { ...context, changeDigest: changeDigestOf([
      FILES[0], { ...FILES[1], sha: '9'.repeat(40) },
    ]) };
    expect(tampered.changeDigest).not.toBe(context.changeDigest);
    expect(evaluateAstra({
      body, changedFiles: ['scripts/agents/model-routing.json'],
      context: tampered, reviews: [makeReview({}, { commit_id: 'c'.repeat(40) })],
    }).status).toBe('ASTRA_PENDING');
  });

  it('沒有可用指紋時 fail closed（兩邊都 undefined 不得視為相符）', () => {
    // 少了這道，`latest.changeDigest !== context.changeDigest` 在兩邊都 undefined
    // 時會「通過」，整條放寬就變成無條件放行。
    for (const bad of [undefined, '', 'not-a-digest', 'a'.repeat(63), 'A'.repeat(64)]) {
      const ctx = { ...context, changeDigest: bad } as Record<string, unknown>;
      const review = makeReview({ changeDigest: bad });
      expect(evaluateAstra({
        body, changedFiles: ['scripts/agents/model-routing.json'], context: ctx as never, reviews: [review],
      }).status).toBe('ASTRA_PENDING');
    }
  });

  it('changeDigestOf 對缺漏欄位回空字串，不產生一個涵蓋不到內容的指紋', () => {
    expect(changeDigestOf([])).toBe('');
    expect(changeDigestOf([{ filename: 'a.ts', status: 'modified' }])).toBe(''); // 缺 sha
    expect(changeDigestOf([{ filename: '', status: 'modified', sha: '1'.repeat(40) }])).toBe('');
    expect(changeDigestOf([{ filename: 'a.ts', sha: '1'.repeat(40) }])).toBe(''); // 缺 status
  });

  it('changeDigestOf 與檔案順序無關，但對 rename 前路徑敏感', () => {
    expect(changeDigestOf([FILES[1], FILES[0]])).toBe(changeDigestOf(FILES));
    const differentRenameSource = [FILES[0], { ...FILES[1], previous_filename: 'src/elsewhere.ts' }];
    expect(changeDigestOf(differentRenameSource)).not.toBe(changeDigestOf(FILES));
  });

  it('changeDigestOf 的排序不依賴執行環境的 locale（逐 UTF-16 code unit 比較）', () => {
    /**
     * `localeCompare` 不指定 locale 時採 process 的 ICU 預設：同一組路徑在
     * `da_DK` 與 `C.UTF-8` 下會排出不同順序，Unicode NFC／NFD 等價路徑更會回 0
     * 而讓順序取決於輸入。那只造成誤擋、不會放行，但一個放行條件不該依賴 locale。
     *
     * 這條測試用「locale 會分歧、原生字串比較不會分歧」的實例來鎖：大小寫混排在
     * locale 排序下是 a、A、a-b、a_b；原生比較下（此處全為 ASCII）'A'(0x41) 恆在
     * 'a'(0x61) 之前。只要改回 localeCompare，這一條就會在 en-US 的 runner 上轉紅。
     */
    const mixed = [
      { filename: 'src/a.ts', status: 'modified', sha: '1'.repeat(40) },
      { filename: 'src/A.ts', status: 'modified', sha: '2'.repeat(40) },
      { filename: 'src/a-b.ts', status: 'modified', sha: '3'.repeat(40) },
      { filename: 'src/a_b.ts', status: 'modified', sha: '4'.repeat(40) },
    ];
    // 原生字串比較的結果是可以逐字寫死的；localeCompare 的結果不是。
    const expected = createHash('sha256').update(JSON.stringify([
      ['src/A.ts', '', 'modified', '2'.repeat(40)],
      ['src/a-b.ts', '', 'modified', '3'.repeat(40)],
      ['src/a.ts', '', 'modified', '1'.repeat(40)],
      ['src/a_b.ts', '', 'modified', '4'.repeat(40)],
    ])).digest('hex');
    expect(changeDigestOf(mixed)).toBe(expected);
    // 打亂輸入順序仍是同一個值
    expect(changeDigestOf([mixed[3], mixed[1], mixed[0], mixed[2]])).toBe(expected);
  });

  it('BMP 以外的路徑同樣得到穩定的全序（這是排序要的性質，不是 code point 序）', () => {
    /**
     * JS 原生字串比較是逐 UTF-16 code unit，對 surrogate pair 排出的位置與 UTF-8
     * byte 序不同（U+10000 會排在 U+E000 之前）。文件與註解刻意不把它叫作 byte-wise。
     * 這道閘門需要的性質只有一個：**與執行環境無關的全序**——同一組輸入，不論以
     * 什麼順序給進來，都得到同一個指紋。這條測試鎖的就是那個性質本身。
     */
    const exotic = [
      { filename: 'src/\u{10000}.ts', status: 'modified', sha: '1'.repeat(40) },
      { filename: 'src/\uE000.ts', status: 'modified', sha: '2'.repeat(40) },
      { filename: 'src/\uFFFD.ts', status: 'modified', sha: '3'.repeat(40) },
    ];
    const digest = changeDigestOf(exotic);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    for (const permutation of [
      [exotic[2], exotic[0], exotic[1]],
      [exotic[1], exotic[2], exotic[0]],
      [exotic[2], exotic[1], exotic[0]],
    ]) expect(changeDigestOf(permutation)).toBe(digest);
    // 內容變了就換一個值——穩定不等於失去敏感度
    expect(changeDigestOf([{ ...exotic[0], sha: '9'.repeat(40) }, exotic[1], exotic[2]])).not.toBe(digest);
  });

  it('evaluateGithubAstra 把算出來的 changeDigest 一起回傳，操作者才填得出來', async () => {
    /**
     * 這道閘門要求 attestation 填一個由檢查器算出的值。如果檢查器從不把它說出口，
     * 操作者就填不出來，下一支高風險 PR 直接卡死——一個「必填但無從得知」的欄位，
     * 效果等同於永久 ASTRA_PENDING。guard 的 summary 與 PR 留言都印這個回傳值。
     */
    const github = {
      rest: {
        pulls: { listFiles: 'files', listReviews: 'reviews' },
        repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'admin' } }) },
      },
      paginate: async (route: string) => (route === 'files' ? FILES : []),
    };
    const current = {
      number: 1, state: 'open', changed_files: FILES.length,
      base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) },
      body: 'ASTRA_RISK: GOVERNANCE_GATE\nASTRA_RATIONALE: touches the gate itself\n'
        + 'ASTRA_TEST_BASELINE: unit-run-123:no-db\nASTRA_SCHEMA_BASELINE: NOT_APPLICABLE: no schema changes\n',
    };
    const result = await evaluateGithubAstra({
      github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current,
    } as never);
    expect(result.changeDigest).toBe(changeDigestOf(FILES));
    expect(result.status).toBe('ASTRA_PENDING'); // 沒有 review，但指紋照樣要拿得到
  });

  it('較新的否決即使釘在別顆 head 上也擋得下（原寫法會跳過它）', () => {
    /**
     * 這一條鎖的是本輪順帶**收緊**的行為。原本是 `find(commitId === headSha)`：
     * 只挑釘在當下 head 的那一筆，於是一筆較新的 CHANGES_REQUESTED 若釘在別顆
     * commit 上會被直接跳過，讓一份較舊的 PASS 存活。
     */
    const newerRejection = {
      trusted: true, id: 2, state: 'CHANGES_REQUESTED', commit_id: 'c'.repeat(40),
      submitted_at: '2026-09-09T00:00:00Z', body: 'blocking concern',
    };
    expect(evaluateAstra(candidate([makeReview(), newerRejection])).status).toBe('ASTRA_PENDING');
  });
  it('checks rename source and permission from GitHub, not from review text', async () => {
    const github = {
      rest: { pulls: { listFiles: 'files', listReviews: 'reviews' }, repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'read' } }) } },
      paginate: async (kind: string) => kind === 'files' ? [{ filename: 'src/new.ts', previous_filename: 'scripts/agents/guard.mjs' }] : [{ ...makeReview(), user: { login: 'outsider' } }],
    };
    const result = await evaluateGithubAstra({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: {
      number: 1, changed_files: 1, base: { sha: context.baseSha }, head: { sha: context.headSha },
      body: body + `ASTRA_TEST_BASELINE: ${context.testBaseline}\nASTRA_SCHEMA_BASELINE: ${context.schemaBaseline}`,
    } });
    expect(result.required).toBe(true);
    expect(result.status).toBe('ASTRA_PENDING');
  });
  it('fails closed when GitHub truncates the changed-file inventory', async () => {
    const github = { rest: { pulls: { listFiles: 'files' } }, paginate: async () => [] };
    await expect(evaluateGithubAstra({ github, owner: 'x', repo: 'y', current: { number: 1, changed_files: 2 } })).rejects.toThrow('Incomplete');
  });
});
