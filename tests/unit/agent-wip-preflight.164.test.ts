import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { routing } from '../../scripts/agents/astra-review-policy.mjs';
import {
  discoverChangedFiles,
  parseGitNameStatus,
  validateDeliveryUnitBoundary,
  validateWipPreflight,
  validateRoleCaptureCapability,
} from '../../scripts/agents/agent-wip-preflight.mjs';
import {
  buildWipErrorFingerprint,
  isDuplicateWipFailure,
  normalizeWipErrors,
  readWipEvidence,
} from '../../scripts/agents/wip-alert-fingerprint.mjs';

const productBody = `<!-- pr-lifecycle
issue: 150
state: ACTIVE
supersedes:
-->

- DELIVERY_UNIT_TYPE: SLICE
- PARENT_EPIC: #28
- COUNT_IN_DELIVERY_OUTCOME: true
- RETROACTIVE_TRACKING_MIGRATION: false
- USER_VISIBLE_OUTCOME: 管理者可下載真正的庫存 CSV
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: 2026-09-04-product-r03
- SCORECARD_PATH: docs/metrics/agent-runs/2026-09-04-product-r03.json
- AGENT_LANE: TERRA_BUILD
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: true
- CLOSEABILITY_SCORE: 5
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: exact-head CI and closeout
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: EMPTY_WITH_SCAN
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=Terra
- DUAL_TERRA_PILOT: false
- TERRA_SLOT: none
- TEST_PROFILE: LOCAL_ISOLATED
- TEST_ENV_ID: local-product-r03-slot-1
- FINAL_CANONICAL_REQUIRED: true
- FILE_OWNERSHIP: src/app/tenant/inventory/page.tsx
`;

const governanceBody = `<!-- pr-lifecycle
issue: 164
state: ACTIVE
supersedes:
-->

- DELIVERY_UNIT_TYPE: GOVERNANCE
- PARENT_EPIC: none
- COUNT_IN_DELIVERY_OUTCOME: false
- RETROACTIVE_TRACKING_MIGRATION: false
- USER_VISIBLE_OUTCOME: none
- WORK_ORIGIN: OWNER
- BPLUS_MODE: false
- AGENT_LANE: GOVERNANCE
- LANE_STATE: ACTIVE
- REQUESTED_MODEL / ACTUAL_MODEL: requested=GPT-5.6 Pro; actual=GPT-5.6 Pro
`;

const agentGovernanceBody = `<!-- pr-lifecycle
issue: 182
state: ACTIVE
supersedes: none
-->

- DELIVERY_UNIT_TYPE: GOVERNANCE
- PARENT_EPIC: none
- COUNT_IN_DELIVERY_OUTCOME: false
- RETROACTIVE_TRACKING_MIGRATION: false
- USER_VISIBLE_OUTCOME: none
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: 2026-09-04-governance-scorecard-none-r01
- SCORECARD_PATH: none
- AGENT_LANE: GOVERNANCE
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: true
- CLOSEABILITY_SCORE: 5
- SELECTION_REASON: GOVERNANCE
- REMAINING_AUTONOMOUS_STEPS: exact-head CI and closeout
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: #182
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: false
- TERRA_SLOT: none
- TEST_PROFILE: SOURCE_ONLY
- TEST_ENV_ID: none
- FINAL_CANONICAL_REQUIRED: false
- FILE_OWNERSHIP: scripts/agents/agent-wip-preflight.mjs, tests/unit/agent-wip-preflight.164.test.ts
`;

describe('Issue #164 Agent WIP preflight', () => {
  it('passes a complete Product Slice before PR creation', () => {
    const result = validateWipPreflight({
      body: productBody,
      fileExists: () => true,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.metadata.issueNumber).toBe(150);
  });

  it('passes bounded Owner-directed governance metadata', () => {
    const result = validateWipPreflight({ body: governanceBody });
    expect(result.valid).toBe(true);
  });

  it.each(['none', 'NONE'])(
    'treats exact SCORECARD_PATH=%s as not applicable for active governance',
    (value) => {
      let fileChecks = 0;
      const result = validateWipPreflight({
        body: agentGovernanceBody.replace('SCORECARD_PATH: none', `SCORECARD_PATH: ${value}`),
        fileExists: () => {
          fileChecks += 1;
          return false;
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(fileChecks).toBe(0);
    },
  );

  it.each(['none/child.json', 'not-none'])(
    'does not let SCORECARD_PATH=%s bypass the existence check',
    (value) => {
      let fileChecks = 0;
      const result = validateWipPreflight({
        body: agentGovernanceBody.replace('SCORECARD_PATH: none', `SCORECARD_PATH: ${value}`),
        fileExists: () => {
          fileChecks += 1;
          return false;
        },
      });
      expect(result.errors).toContain(`SCORECARD_PATH does not exist locally: ${value}`);
      expect(fileChecks).toBe(1);
    },
  );

  it('catches the missing requested/actual model field seen in the retrospective', () => {
    const result = validateWipPreflight({
      body: productBody.replace(
        '- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=Terra',
        '- REQUESTED_MODEL / ACTUAL_MODEL:',
      ),
      fileExists: () => true,
    });
    expect(result.errors).toContain('REQUESTED_MODEL / ACTUAL_MODEL is required');
  });

  it('catches a non-close-ready Terra without a real WHY_NOT_CLOSER_CANDIDATE', () => {
    const result = validateWipPreflight({
      body: productBody.replace('SELECTION_REASON: CLOSE_READY', 'SELECTION_REASON: OWNER_DIRECTED'),
      fileExists: () => true,
    });
    expect(result.errors).toContain('Non-CLOSE_READY Terra selection requires WHY_NOT_CLOSER_CANDIDATE');
  });

  it('catches a missing active B+ scorecard locally', () => {
    const result = validateWipPreflight({
      body: productBody,
      fileExists: () => false,
    });
    expect(result.errors).toContain(
      'SCORECARD_PATH does not exist locally: docs/metrics/agent-runs/2026-09-04-product-r03.json',
    );
  });

  it('requires a closable Product Delivery Slice rather than an Epic', () => {
    const body = productBody
      .replace('DELIVERY_UNIT_TYPE: SLICE', 'DELIVERY_UNIT_TYPE: EPIC')
      .replace('COUNT_IN_DELIVERY_OUTCOME: true', 'COUNT_IN_DELIVERY_OUTCOME: false');
    const result = validateWipPreflight({ body, fileExists: () => true });
    expect(result.errors).toContain(
      'An active Product delivery lane must point to a closable SLICE or STANDALONE Issue',
    );
  });

  it('checks actual Dual Terra files against declared ownership', () => {
    const body = productBody
      .replace('DUAL_TERRA_PILOT: false', 'DUAL_TERRA_PILOT: true')
      .replace('TERRA_SLOT: none', 'TERRA_SLOT: 1');
    const result = validateWipPreflight({
      body,
      changedFiles: ['src/app/tenant/bookings/page.tsx'],
      fileExists: () => true,
      prNumber: 200,
    });
    expect(result.errors).toContain(
      'Dual Terra PR #200 changed files outside FILE_OWNERSHIP: src/app/tenant/bookings/page.tsx',
    );
  });

  it('fails a retroactive tracking Issue that tries to count as new output', () => {
    const errors = validateDeliveryUnitBoundary(
      productBody.replace('RETROACTIVE_TRACKING_MIGRATION: false', 'RETROACTIVE_TRACKING_MIGRATION: true'),
      { issueNumber: 150, origin: 'AGENT', state: 'ACTIVE', lane: 'TERRA_BUILD' },
    );
    expect(errors).toContain('A retroactive tracking migration must set COUNT_IN_DELIVERY_OUTCOME=false');
  });
});

describe('pre-execution role capture capability diagnostic (synthetic, not provenance)', () => {
  const now = Date.parse('2026-10-14T00:01:00Z');
  const role = () => ({ actorId: 'EXPOSED', sessionId: 'EXPOSED', executionRef: 'EXPOSED', captureBeforeWork: 'SUPPORTED' });
  const observation = () => ({ schemaVersion: 1, sourceKind: 'OPERATOR_OBSERVED_RUNTIME_CONTRACT',
    evidenceRef: 'synthetic-runtime-contract:fixture', observedAt: '2026-10-14T00:00:00Z',
    roles: { BUILD: role(), REVIEW: role() }, independentFreshReviewer: 'SUPPORTED' });
  it('records capabilities without demanding future completed receipts or verifying identity', () => {
    const result = validateRoleCaptureCapability(observation(), now);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('ROLE_CAPTURE_CAPABILITY_RECORDED_UNVERIFIED');
    expect(result.roleIdentityVerified).toBe(false);
    expect(result.canonicalReadbackVerified).toBe(false);
  });
  it.each(['BUILD', 'REVIEW'] as const)('rejects each unavailable %s capture field', roleName => {
    for (const field of ['actorId', 'sessionId', 'executionRef', 'captureBeforeWork'] as const) {
      for (const unavailable of ['UNKNOWN', 'UNEXPOSED', 'task_name', 'parent-thread-id', 'true', '']) {
        const p = observation(); p.roles[roleName][field] = unavailable;
        expect(validateRoleCaptureCapability(p, now).valid, `${roleName}.${field}=${unavailable}`).toBe(false);
      }
    }
  });
  it.each([
    undefined, {}, { sourceKind: 'REPO_MODEL_CONFIG' }, { evidenceRef: 'unknown' },
    { observedAt: 'not-a-date' }, { observedAt: '2026-10-14T00:02:00Z' },
    { independentFreshReviewer: 'UNKNOWN' }, { independentFreshReviewer: true },
  ])('rejects missing or unsupported runtime observations: %j', patch => {
    const p = patch === undefined ? undefined : { ...observation(), ...patch };
    // Empty packets are checked separately; a missing observation cannot default to supported.
    expect(validateRoleCaptureCapability(patch && !Object.keys(patch).length ? {} : p, now).valid).toBe(false);
  });
  it('CLI reports unsupported capture before source work, with no body/diff/final packet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-capability-'));
    try {
      const path = join(dir, 'observation.json');
      const p = observation(); p.roles.BUILD.actorId = 'UNEXPOSED';
      writeFileSync(path, JSON.stringify(p));
      const run = (extra: string[] = []) => spawnSync(process.execPath,
        ['scripts/agents/agent-wip-preflight.mjs', '--role-capability', path, ...extra], { encoding: 'utf8' });
      const unavailable = run();
      expect(unavailable.status).toBe(1);
      expect(JSON.parse(unavailable.stdout).status).toBe('ROLE_CAPTURE_UNAVAILABLE');
      writeFileSync(path, JSON.stringify(observation()));
      const recorded = run(); expect(recorded.status).toBe(0);
      expect(JSON.parse(recorded.stdout).canonicalReadbackVerified).toBe(false);
      expect(run(['--prospective-final', 'true']).status).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('#659 local preflight changed-file discovery', () => {
  it('keeps both old and new paths for renames so schema triggers cannot disappear', () => {
    expect(parseGitNameStatus([
      'M\tsrc/server/widgets.ts',
      'R100\tsupabase/migrations/0127_old.sql\tdocs/schema-truth/archive.sql',
      'A\ttests/unit/example.test.ts',
      '',
    ].join('\n'))).toEqual([
      'src/server/widgets.ts',
      'supabase/migrations/0127_old.sql',
      'docs/schema-truth/archive.sql',
      'tests/unit/example.test.ts',
    ]);
  });

  it('discovers the current branch inventory from one shell-free git diff call', () => {
    const calls: Array<{ args: string[]; options: Record<string, unknown> }> = [];
    const files = discoverChangedFiles({
      base: 'origin/main',
      repositoryRoot: '/repo',
      runGit: (args, options) => {
        calls.push({ args, options });
        return 'M\tscripts/agents/agent-wip-preflight.mjs\n';
      },
    });
    expect(files).toEqual(['scripts/agents/agent-wip-preflight.mjs']);
    expect(calls).toEqual([{
      args: ['diff', '--name-status', '--find-renames', 'origin/main...HEAD', '--'],
      options: { cwd: '/repo', encoding: 'utf8' },
    }]);
  });

  it('fails closed on an unsafe base ref or an empty branch diff', () => {
    expect(() => discoverChangedFiles({
      base: 'origin/main;echo unsafe',
      runGit: () => '',
    })).toThrow(/safe git base ref/);
    expect(() => discoverChangedFiles({
      base: 'origin/main',
      runGit: () => '',
    })).toThrow(/No changed files found/);
  });
});

describe('Issue #164 WIP alert fingerprint', () => {
  it('normalizes duplicate and reordered errors into one deterministic fingerprint', () => {
    const left = buildWipErrorFingerprint({
      prNumber: 159,
      headSha: 'a'.repeat(40),
      errors: [' Missing model ', 'Closure evidence missing', 'Missing model'],
    });
    const right = buildWipErrorFingerprint({
      prNumber: 159,
      headSha: 'A'.repeat(40),
      errors: ['Closure   evidence missing', 'Missing model'],
    });
    expect(normalizeWipErrors(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates a new fingerprint when the exact head or error set changes', () => {
    const base = { prNumber: 159, headSha: 'a'.repeat(40), errors: ['Missing model'] };
    expect(buildWipErrorFingerprint(base)).not.toBe(
      buildWipErrorFingerprint({ ...base, headSha: 'b'.repeat(40) }),
    );
    expect(buildWipErrorFingerprint(base)).not.toBe(
      buildWipErrorFingerprint({ ...base, errors: ['Missing model', 'Missing closure'] }),
    );
  });

  it('suppresses only the same head and same error fingerprint', () => {
    const headSha = 'c'.repeat(40);
    const fingerprint = buildWipErrorFingerprint({
      prNumber: 159,
      headSha,
      errors: ['Missing model'],
    });
    const previousBody = `- EXACT_HEAD: ${headSha}\n- ERROR_FINGERPRINT: ${fingerprint}`;
    expect(readWipEvidence(previousBody)).toEqual({ fingerprint, headSha });
    expect(isDuplicateWipFailure({ previousBody, fingerprint, headSha })).toBe(true);
    expect(isDuplicateWipFailure({ previousBody, fingerprint, headSha: 'd'.repeat(40) })).toBe(false);
  });
});

/**
 * #370 帶出來的缺口：preflight 先前**不驗** TEST_PROFILE。
 *
 * TEST_PROFILE / FINAL_CANONICAL_REQUIRED 由 scripts/ci/local-isolated-test-policy.mjs
 * 驗，不在 agent-wip-policy 或 dual-terra-wip-policy 裡。於是一支 preflight 通過的 PR
 * 仍然會被 CI 的 classify job 退掉——2026-09-11 的 #370 就是這樣被退的
 * （TEST_PROFILE 填成不存在的 CANONICAL_TEST，正確值是 SHARED_CANONICAL）。
 *
 * PB-034 的預防是「開 PR 前跑 preflight，通過才推」。那條預防只有在 preflight 真的
 * 涵蓋 CI 會擋的規則時才成立；少涵蓋一支驗證器，預防就只是**看起來**有效——而這件事
 * 在 preflight 通過時完全看不出來。
 */
describe('#370 preflight 必須涵蓋 local-isolated-test-policy 的欄位', () => {
  const withProfile = (profile: string) =>
    productBody
      .replace(/- TEST_PROFILE: .*/g, '')
      .replace('- DUAL_TERRA_PILOT: false', `- TEST_PROFILE: ${profile}\n- DUAL_TERRA_PILOT: false`);

  it('擋下不存在的 TEST_PROFILE（#370 實際被 CI 退掉的那個值）', () => {
    const result = validateWipPreflight({ body: withProfile('CANONICAL_TEST') });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('TEST_PROFILE is invalid: CANONICAL_TEST');
  });

  it('放行四個合法 profile', () => {
    for (const profile of ['SOURCE_ONLY', 'SHARED_CANONICAL']) {
      const result = validateWipPreflight({ body: withProfile(profile) });
      expect(result.errors).not.toContain(`TEST_PROFILE is invalid: ${profile}`);
    }
  });

  it('本機 profile 未設 FINAL_CANONICAL_REQUIRED=true 時擋下', () => {
    // productBody 本身帶 FINAL_CANONICAL_REQUIRED: true，所以要明確翻成 false 才測得到
    // 這條規則——照原樣只會驗到「它本來就滿足」，等於什麼都沒驗。
    const body = withProfile('LOCAL_ISOLATED').replace(
      '- FINAL_CANONICAL_REQUIRED: true',
      '- FINAL_CANONICAL_REQUIRED: false',
    );
    const result = validateWipPreflight({ body });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('LOCAL_ISOLATED profiles must set FINAL_CANONICAL_REQUIRED=true');
  });

  it('本機 profile 且 FINAL_CANONICAL_REQUIRED=true 時不擋（對照組）', () => {
    const result = validateWipPreflight({ body: withProfile('LOCAL_ISOLATED') });
    expect(result.errors).not.toContain('LOCAL_ISOLATED profiles must set FINAL_CANONICAL_REQUIRED=true');
  });

  it('已退役的 profile 給出指向替代做法的訊息，而不是泛用的 invalid', () => {
    const result = validateWipPreflight({ body: withProfile('REMOTE_BRANCH_REQUIRED') });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/retired/i);
  });
});

describe('ordinary final review local contract (synthetic, never canonical approval)', () => {
  const body = productBody + '\nWORKSTREAM: PRODUCT_MAINLINE\nASTRA_RISK: NONE\nASTRA_RATIONALE: Synthetic bounded runtime change\n';
  const live = { state: 'open', draft: false, body, head: { sha: 'b'.repeat(40) } };
  it('rejects missing ordinary final proof for an explicit current Product stage', () => {
    const result = validateWipPreflight({ body, currentPr: live, fileExists: () => true } as any);
    expect(result.valid).toBe(false);
    expect(result.ordinaryReviewRequired).toBe(true);
    expect(result.errors).toContain('Ordinary final review requires local scope and receipt snapshots');
  });
  const repository = 'synthetic/contract', headSha = 'b'.repeat(40), changeDigest = 'c'.repeat(64);
  const source = (id: number) => `https://github.com/${repository}/pull/150#issuecomment-${id}`;
  const role = (kind: string) => ({ role: kind, repository, headSha, changeDigest, sourceRef: source(kind === 'BUILD' ? 101 : 102),
    actorId: `synthetic-${kind}-actor`, sessionId: `synthetic-${kind}-session`, executionRef: `synthetic-${kind}-execution`,
    startedAt: '2026-10-01T00:01:00Z', completedAt: '2026-10-01T00:01:00Z', executionEvidence: 'OPERATOR_ATTESTED',
    freshContext: kind === 'REVIEW', provider: 'OPENAI', providerEvidenceRef: source(104), requestedModel: routing.models.audit });
  const packet = () => ({ repository, headSha, changeDigest, builder: role('BUILD'), reviewer: role('REVIEW'),
    reviewSourceRef: `https://github.com/${repository}/pull/150#pullrequestreview-105`,
    review: { repository, headSha, changeDigest, policyVersion: routing.version, executionRef: 'synthetic-REVIEW-execution',
      requestedModel: routing.models.audit, actualModel: 'unknown', identityEvidence: 'UNKNOWN', servedVerified: false,
      reviewerExecutionReceipt: source(102), verdict: 'PASS', report: source(103), findings: 'Synthetic counterexamples only; not a dispatched actor' } });
  const finalBody = body + `BUILDER_EXECUTION_RECEIPT: ${source(101)}\n`;
  const check = (ordinaryEvidence: any, extra = {}) => validateWipPreflight({ body: finalBody, prospectiveFinal: true, ordinaryEvidence, fileExists: () => true, ...extra } as any);
  it('validates a concrete synthetic local shape but never claims canonical role approval', () => {
    const result = check(packet()); expect(result.valid).toBe(true); expect(result.ordinaryReviewStatus).toBe('NEEDS_CANONICAL_READBACK'); expect(result.canonicalReadbackVerified).toBe(false);
  });
  it.each(['self-actor', 'self-session', 'stale-head', 'foreign-source', 'unknown-served', 'string-served', 'wrong-model', 'unknown-actor'])('rejects %s without trusting packet flags', mode => {
    const p = packet() as any; p.trusted = true;
    if (mode === 'self-actor') p.reviewer.actorId = p.builder.actorId;
    if (mode === 'self-session') p.reviewer.sessionId = p.builder.sessionId;
    if (mode === 'stale-head') p.reviewer.headSha = 'd'.repeat(40);
    if (mode === 'foreign-source') p.reviewer.sourceRef = 'https://github.com/foreign/repo/pull/1#issuecomment-2';
    if (mode === 'unknown-served') p.review.servedVerified = true;
    if (mode === 'string-served') p.review.servedVerified = 'true';
    if (mode === 'wrong-model') p.review.requestedModel = 'gpt-6-astra';
    if (mode === 'unknown-actor') p.reviewer.actorId = 'unknown';
    expect(check(p).valid).toBe(false); expect(check(p).canonicalReadbackVerified).toBe(false);
  });
  it('current snapshot head/body cannot disagree with a prospective packet', () => {
    expect(check(packet(), { currentPr: { ...live, body: finalBody, head: { sha: 'd'.repeat(40) } } }).valid).toBe(false);
    expect(check(packet(), { currentPr: live }).ordinaryReviewStatus).toBe('LOCAL_NOT_VERIFIABLE');
  });
  it.each([
    { draft: true, lane: 'ACTIVE' },
    { draft: false, lane: 'PARKED' },
    { draft: true, lane: 'PARKED' },
  ])('explicit prospective final checks deferred open snapshots: %j', ({ draft, lane }) => {
    const scopedBody = finalBody.replace('LANE_STATE: ACTIVE', `LANE_STATE: ${lane}`);
    const currentPr = { ...live, body: scopedBody, draft };
    const missing = check(undefined, { body: scopedBody, currentPr });
    expect(missing.ordinaryReviewRequired).toBe(true);
    expect(missing.errors).toContain('Ordinary final review requires local scope and receipt snapshots');
    const complete = check(packet(), { body: scopedBody, currentPr });
    expect(complete.ordinaryReviewStatus).toBe('NEEDS_CANONICAL_READBACK');
    expect(complete.canonicalReadbackVerified).toBe(false);
    const unexposed = packet(); unexposed.builder.actorId = 'unknown';
    expect(check(unexposed, { body: scopedBody, currentPr }).errors).toContain('Invalid local BUILD role receipt shape');
  });
  it('prospective final does not reopen closed history or bypass snapshot validation', () => {
    expect(check(undefined, { currentPr: { ...live, body: finalBody, state: 'closed', draft: true } }).ordinaryReviewRequired).toBe(false);
    expect(check(undefined, { currentPr: { ...live, body: finalBody, draft: 'true' } }).ordinaryReviewStatus).toBe('LOCAL_NOT_VERIFIABLE');
    expect(check(undefined, { currentPr: { ...live, draft: true } }).ordinaryReviewStatus).toBe('LOCAL_NOT_VERIFIABLE');
    expect(check(undefined, { prospectiveFinal: 'true', currentPr: { ...live, body: finalBody, draft: true } }).ordinaryReviewRequired).toBe(false);
  });
  it('Draft BUILD, governance and high-risk baseline do not acquire ordinary proof requirements', () => {
    expect(validateWipPreflight({ body, currentPr: { ...live, draft: true }, fileExists: () => true } as any).ordinaryReviewRequired).toBe(false);
    expect(validateWipPreflight({ body: governanceBody, prospectiveFinal: true } as any).ordinaryReviewRequired).toBe(false);
    expect(validateWipPreflight({ body: body.replace('ASTRA_RISK: NONE', 'ASTRA_RISK: PAYMENT_CONSISTENCY'), prospectiveFinal: true, fileExists: () => true } as any).ordinaryReviewRequired).toBe(false);
  });
  it('canonical template documents non-executable schemas without trusted proof flags', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8');
    expect(template).toContain('NON_EXECUTABLE_EXAMPLE'); expect(template).toContain('BUILDER_EXECUTION_RECEIPT:');
    expect(template).toContain('reviewerExecutionReceipt'); expect(template).toContain('LOCAL_NOT_VERIFIABLE'); expect(template).not.toContain('"trusted": true');
  });
  it('reports absent stage as locally unverifiable, never remote role PASS', () => {
    const result = validateWipPreflight({ body, fileExists: () => true });
    expect(result.ordinaryReviewStatus).toBe('LOCAL_NOT_VERIFIABLE');
    expect(result.canonicalReadbackVerified).toBe(false);
  });
});
