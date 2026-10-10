import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { changeDigestOf, evaluateAstra, evaluateGithubAstra, routing as currentRouting, resolveRoleReceiptWakeup, parseAstraReviews } from '../../scripts/agents/astra-review-policy.mjs';
import { independentRoleErrors, nativeRoleShapeErrors, finalRiskReviewerErrors } from '../../scripts/agents/final-risk-cost-policy.mjs';
import { validateNativeRolePreflight, validateWipPreflight } from '../../scripts/agents/agent-wip-preflight.mjs';
import { buildProductionDbFinalRiskEvidence, buildProductionDbFinalRiskEvidenceFromGithub } from '../../scripts/agents/production-db-final-risk-evidence.mjs';

// Every event/identity below is SYNTHETIC. These tests cannot certify real native tasks.
// Preserve #843's exact historical configuration independently of the active singleton.
const routing = { ...currentRouting, nativeRolePilot: {
  version: '2026-10-09.1', enabled: true, surface: 'PRODUCT_SOURCE_FINAL_RISK',
  repository: 'smallwei0301/vibeaico-admin-rebuild', prNumber: 843,
  headSha: '47f259db7b2f4ab50b08c0962cc8d6f676575fd0',
  changeDigest: '18ee75322cafca9148e043cee7ba518ea767ab4f8449fd6eb655c8cb5192b6ba',
  privateMessageMode: 'PR843_RETAINED_ORIGINAL_V1',
} };
const adoptionBuildScope = 'Fresh adoption and full verification of existing PR #848 exact source; no original authorship claimed.';
const adoptionRouting = { ...currentRouting, nativeRolePilot: {
  ...routing.nativeRolePilot, prNumber: 848,
  headSha: '8e85baf04a3e9a8d556ed8abd71c2ad789be468b',
  changeDigest: 'd9c1f7cffeeed4436e4bd31ea211e1235d70e83294c12a876c249793b1539790',
  privateMessageMode: 'PR848_RETAINED_ORIGINAL_V1',
  adoptionApprovedAt: '2026-10-10T12:46:54.792160Z', buildWorkScope: adoptionBuildScope,
} };
const adoptionFiles = [
  ['.github/workflows/production-db-release-orchestrator.yml', 'modified', '86e86707a76eabd065053281f3ee1aa6a2e62e59'],
  ['scripts/agents/schema-drift-watch.mjs', 'modified', '6dec0d948b15b468b3fad4e74a74ac5373e57a4c'],
  ['tests/unit/production-db-release-orchestrator-workflow.447.test.ts', 'modified', 'd0a21229567a3886e7a8f96e9383a6f661c6500e'],
  ['tests/unit/schema-drift-watch.test.ts', 'modified', 'f7eb4f0954b39254fa53a7be011d0443ff83b2eb'],
].map(([filename, status, sha]) => ({ filename, status, sha }));
const pilot = routing.nativeRolePilot, repository = pilot.repository, head = pilot.headSha, main = 'a'.repeat(40);
// Historical policy is a synthetic regression input, never the current enabled policy.
const historicalPilot = { ...pilot, headSha: '07d360c50c6eb60486fa4f3bc21d0f713d6e2bbb',
  changeDigest: '8da954f36f1e6ea03bac4be9c24f203f75273494dab11b8f49829fca2d7664a3' };
const historicalRouting = { ...routing, nativeRolePilot: historicalPilot };
const actor = { login: 'operator-fixture', id: 12345678, type: 'User' };
const ref = (id: number) => `https://github.com/${repository}/pull/843#issuecomment-${id}`;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const block = (value: unknown, kind = 'agent-role-execution') => '```' + kind + '\n' + JSON.stringify(value) + '\n```';
const files = [
  ['.github/workflows/ci.yml', 'modified', 'c67a55a0ed4e7d6e15e88366f1644c535b8edd5b'],
  ['scripts/db/validate-production-db-release-on-test.mjs', 'modified', 'a21c85801c8b169921eb3f50b345e5dbfcdb7fe4'],
  ['scripts/test/production-db-test-baseline-0098-postgres.mjs', 'added', 'ea2cd17bdf46e6d40ecd82f42536b13b354c2ecd'],
  ['tests/unit/production-db-test-baseline-postgres-runner.755.test.ts', 'added', '48b402d82bcd1ec781a0a0207e09e198f3c9fffc'],
  ['tests/unit/production-db-test-baseline-workflow.755.test.ts', 'added', 'ac17a66acbb3cc695ba1710b82674c67ffb48f37'],
  ['tests/unit/production-db-test-baseline.755.test.ts', 'added', '04d89bb9c514f2ab725187ae72b935a642c46e24'],
].map(([filename, status, sha]) => ({ filename, status, sha }));
const historicalFiles = files.map(file => ({ ...file, sha: file.filename === 'scripts/db/validate-production-db-release-on-test.mjs'
  ? 'cbbd394ee0150e20d81ed88aecaffb357c96180f' : file.filename === 'tests/unit/production-db-test-baseline.755.test.ts'
    ? 'd755c8ccc229bdc87c3e32e8fd716e3eb267dbca' : file.sha }));
const body = `WORKSTREAM: PRODUCT_MAINLINE\nAGENT_LANE: TERRA_BUILD\nLANE_STATE: ACTIVE\nASTRA_RISK: GOVERNANCE_GATE\nASTRA_RATIONALE: Synthetic source admission fixture only\nASTRA_TEST_BASELINE: Synthetic source tests complete\nASTRA_SCHEMA_BASELINE: Synthetic unchanged canonical SQL\nBUILDER_EXECUTION_RECEIPT: ${ref(101)}`;
function fixture(policy = routing) {
  const pilot = policy.nativeRolePilot, head = pilot.headSha;
  const ref = (id: number) => `https://github.com/${repository}/pull/${pilot.prNumber}#issuecomment-${id}`;
  const fixtureTime = (value: string) => pilot.prNumber === 848
    ? new Date(Date.parse(value) + Date.parse('2026-10-10T12:47:00Z') - Date.parse('2026-10-09T15:00:00Z')).toISOString() : value;
  const fixtureBody = body.replace('/843#', `/${pilot.prNumber}#`);
  const fixtureFiles = pilot.prNumber === 848 ? adoptionFiles : head === historicalPilot.headSha ? historicalFiles : files;
  const role = (kind: string): any => {
    const build = kind === 'BUILD', start = build ? fixtureTime('2026-10-09T15:00:00Z') : fixtureTime('2026-10-09T15:04:00Z');
    const end = build ? fixtureTime('2026-10-09T15:01:00Z') : fixtureTime('2026-10-09T15:05:00Z');
    const task = build ? 'synthetic_builder' : 'synthetic_reviewer';
    return { role: kind, repository, headSha: head, changeDigest: pilot.changeDigest, sourceRef: ref(build ? 101 : 102),
      actorId: null, sessionId: null, executionIdentityKind: 'NATIVE_TASK', backendIdentityAvailability: 'UNEXPOSED',
      executionRef: `operator-scoped:${task}`, executionEvidence: 'OPERATOR_ATTESTED', timingBasis: 'OBSERVED_ROLE_WORK',
      startedAt: start, completedAt: end, freshContext: !build, provider: 'OPENAI', providerEvidenceRef: ref(103),
      requestedModel: build ? 'gpt-6.1-sol' : 'not_requested', actualModel: 'unknown', identityEvidence: 'UNKNOWN', servedVerified: false,
      nativeTaskEvidence: { schemaVersion: 1, namespace: 'synthetic-parent-scope', captureGeneration: 'synthetic-generation',
        executionRefBasis: 'OPERATOR_SCOPED_NATIVE_TASK', operatorLogin: actor.login, operatorId: actor.id,
        taskName: `/root/${task}`, performedWorkScope: build ? (pilot.prNumber === 848 ? adoptionBuildScope : 'Synthetic four-file construction; other authors unchanged') : 'Synthetic full six-file exact-head final audit',
        compiledAt: end, spawn: { sourceKind: 'OPERATOR_WITNESSED', tool: 'collaboration.spawn_agent', assignedRole: kind, observedAt: start,
          request: { task_name: task, message: `Synthetic ${kind} assignment`, fork_turns: 'none', reasoning_effort: 'xhigh', ...(build ? { model: 'gpt-6.1-sol' } : {}) }, result: { task_name: `/root/${task}` } },
        work: { sourceKind: 'WORKER_REPORTED', event: 'ROLE_WORK_STARTED', startedAt: start, observedAt: start, evidenceRef: ref(103), artifactSha256: 'f'.repeat(64) },
        completion: { sourceKind: 'OPERATOR_WITNESSED', event: 'BOUNDED_WORK_COMPLETED', observedAt: end, stoppedWriting: true,
          headSha: head, changeDigest: pilot.changeDigest, evidenceRef: ref(103) },
        ...(build && pilot.prNumber === 848 ? { policyReadback: { sourceKind: 'OPERATOR_WITNESSED',
          version: pilot.version, mainSha: main, observedAt: '2026-10-10T12:46:59Z' } } : {}),
        ...(!build ? { contextIsolationAttested: true, participatedInBuild: false, reviewPhase: 'FINAL',
          policyReadback: { sourceKind: 'OPERATOR_WITNESSED', version: pilot.version, mainSha: main, observedAt: fixtureTime('2026-10-09T15:03:00Z') } } : {}) } };
  };
  const builder = role('BUILD'), reviewer = role('REVIEW');
  reviewer.nativeTaskEvidence.builderReadback = { sourceKind: 'OPERATOR_WITNESSED', sourceRef: ref(101), bodySha256: hash(block(builder)),
    updatedAt: fixtureTime('2026-10-09T15:02:00Z'), observedAt: fixtureTime('2026-10-09T15:03:00Z') };
  const review: any = { repository, baseSha: main, headSha: head, changeDigest: pilot.changeDigest, policyVersion: routing.version,
    nativeRolePolicyVersion: pilot.version, requestedModel: 'not_requested', actualModel: 'unknown', identityEvidence: 'UNKNOWN', servedVerified: false,
    executionRef: reviewer.executionRef, reviewerExecutionReceipt: ref(102), verdict: 'PASS', report: ref(103), findings: 'Synthetic counterexamples checked, no unresolved findings',
    reviewerTier: 'CURRENT_AGENT', costPolicyVersion: routing.finalRiskCostControl.version, downgradeReason: 'MODEL_SELECTION_UNAVAILABLE',
    modelSelectionAvailable: false, downgradeEvidenceRef: ref(104), reviewLineage: 'synthetic-lineage', executionEvidence: 'OPERATOR_ATTESTED',
    adversarialEvidence: 'Synthetic negative cases, not real work', priorFindingsReviewed: true, unresolvedFindingCount: 0,
    testBaseline: 'Synthetic source tests complete', schemaBaseline: 'Synthetic unchanged canonical SQL', submittedAt: fixtureTime('2026-10-09T15:07:00Z') };
  const current: any = { number: pilot.prNumber, state: 'open', draft: false, body: fixtureBody, changed_files: fixtureFiles.length, created_at: fixtureTime('2026-10-09T12:00:00Z'),
    head: { sha: head }, base: { sha: main, repo: { full_name: repository } } };
  const record = () => ({ id: 201, state: 'COMMENTED', user: actor, commit_id: head, submitted_at: review.submittedAt, body: block(review, 'astra-review'), trusted: true });
  const listFiles = vi.fn(), listReviews = vi.fn(), listPulls = vi.fn();
  const github: any = { rest: { pulls: { listFiles, listReviews, list: listPulls, get: vi.fn(async () => ({ data: current })) },
    issues: { getComment: vi.fn(async ({ comment_id }: any) => ({ data: { id: comment_id, html_url: ref(comment_id), user: actor,
      updated_at: comment_id === 101 ? fixtureTime('2026-10-09T15:02:00Z') : fixtureTime('2026-10-09T15:06:00Z'), body: block(comment_id === 101 ? builder : reviewer) } })) },
    repos: { getCollaboratorPermissionLevel: vi.fn(async () => ({ data: { permission: 'write' } })),
      getCommit: vi.fn(async () => ({ data: { sha: main } })),
      getContent: vi.fn(async () => { const bytes = Buffer.from(JSON.stringify(policy)); return { data: { type: 'file', encoding: 'base64', content: bytes.toString('base64'), sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') } }; }),
      listCommits: vi.fn(async () => ({ data: [{ sha: main }] })), compareCommitsWithBasehead: vi.fn(async () => ({ data: { status: 'ahead' } })) } },
    paginate: vi.fn(async (method: any) => method === listFiles ? fixtureFiles : method === listReviews ? [record()] : method === listPulls ? [current] : []) };
  const context: any = { repository, baseSha: main, headSha: head, currentHeadSha: head, changeDigest: pilot.changeDigest, prNumber: pilot.prNumber,
    policyVersion: routing.version, testBaseline: review.testBaseline, schemaBaseline: review.schemaBaseline,
    reviewSurface: pilot.surface, nativeCanonical: true, nativePolicyEvidence: { pilot, currentMainSha: main, reviewedMainSha: main },
    roleEvidence: { trusted: true, builder: { ...builder, sourceActor: actor, sourceUpdatedAt: fixtureTime('2026-10-09T15:02:00Z'), sourceBodySha256: hash(block(builder)) },
      reviewer: { ...reviewer, sourceActor: actor, sourceUpdatedAt: fixtureTime('2026-10-09T15:06:00Z') } } };
  return { policy, pilot, builder, reviewer, review, current, context, github, record, listFiles, listReviews,
    packet: { repository, headSha: head, changeDigest: pilot.changeDigest, builder, reviewer, review } };
}
const run = (f: ReturnType<typeof fixture>, policy = f.policy) => evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current }, policy);

describe('bounded native source-role pilot; structure and operator trust only', () => {
  it('T01 preserves complete backend proof and rejects old missing IDs/unknown kinds', () => {
    const f = fixture();
    for (const role of [f.context.roleEvidence.builder, f.context.roleEvidence.reviewer]) {
      delete role.nativeTaskEvidence; delete role.executionIdentityKind; role.actorId = role.executionRef; role.sessionId = role.executionRef;
    }
    expect(independentRoleErrors(f.review, f.context)).toEqual([]);
    f.context.roleEvidence.builder.actorId = null; expect(independentRoleErrors(f.review, f.context).length).toBeGreaterThan(0);
    f.context.roleEvidence.builder.actorId = 'real-fixture-actor'; f.context.roleEvidence.builder.executionIdentityKind = 'UNKNOWN';
    expect(independentRoleErrors(f.review, f.context).length).toBeGreaterThan(0);
  });
  it('T03 accepts the complete synthetic exact843 source contract while keeping risk/model gates', async () => {
    const f = fixture(); expect(changeDigestOf(files)).toBe(pilot.changeDigest);
    expect(nativeRoleShapeErrors(f.review, f.context, pilot)).toEqual([]);
    expect(independentRoleErrors(f.review, f.context)).toEqual([]);
    const r = await run(f); expect(r.status).toBe('ASTRA_APPROVED'); expect(r.risks).toContain('GOVERNANCE_GATE');
    expect(validateNativeRolePreflight(f.packet, f.current, f.policy)).toMatchObject({ status: 'NEEDS_CANONICAL_READBACK', canonicalReadbackVerified: false, errors: [] });
  });
  // The pinned historical shape is synthetic here; a passing fixture does not authenticate the real spawn.
  const uncapturedBuild = (policy = historicalRouting) => {
    const f = fixture(policy), e = f.builder.nativeTaskEvidence;
    e.taskName = '/root/implement_843_pg_harness';
    e.spawn.request.task_name = 'implement_843_pg_harness'; e.spawn.result.task_name = e.taskName;
    e.spawn.request.message = null; e.spawn.requestMessageAvailability = 'NOT_CAPTURED';
    // Existing build-start checkpoint and parent-observed completion; not backend lifetime.
    f.builder.executionRef = 'native-task:/root/implement_843_pg_harness';
    e.spawn.observedAt = '2026-10-09T14:28:16Z';
    f.builder.startedAt = e.work.startedAt = e.work.observedAt = '2026-10-09T14:32:26Z';
    f.builder.completedAt = e.completion.observedAt = e.compiledAt = '2026-10-09T15:32:00Z';
    f.reviewer.startedAt = f.reviewer.nativeTaskEvidence.spawn.observedAt = f.reviewer.nativeTaskEvidence.work.startedAt =
      f.reviewer.nativeTaskEvidence.work.observedAt = '2026-10-09T16:04:00Z';
    f.reviewer.completedAt = f.reviewer.nativeTaskEvidence.completion.observedAt = f.reviewer.nativeTaskEvidence.compiledAt = '2026-10-09T16:05:00Z';
    f.reviewer.nativeTaskEvidence.builderReadback.updatedAt = '2026-10-09T15:33:00Z';
    f.reviewer.nativeTaskEvidence.builderReadback.observedAt = f.reviewer.nativeTaskEvidence.policyReadback.observedAt = '2026-10-09T16:03:00Z';
    f.review.submittedAt = '2026-10-09T16:07:00Z';
    Object.assign(f.context.roleEvidence.reviewer, f.reviewer, { sourceUpdatedAt: '2026-10-09T16:06:00Z' });
    f.context.roleEvidence.builder.sourceUpdatedAt = '2026-10-09T15:33:00Z';
    const getComment = f.github.rest.issues.getComment.getMockImplementation();
    f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
      const result = await getComment(args);
      result.data.updated_at = args.comment_id === 101 ? '2026-10-09T15:33:00Z' : '2026-10-09T16:06:00Z'; return result;
    });
    return f;
  };
  const expectMessageAdmission = async (f: ReturnType<typeof fixture>, valid: boolean) => {
    const bodySha256 = hash(block(f.builder));
    f.reviewer.nativeTaskEvidence.builderReadback.bodySha256 = bodySha256;
    Object.assign(f.context.roleEvidence.builder, f.builder, { sourceBodySha256: bodySha256 });
    expect(nativeRoleShapeErrors(f.review, f.context, f.pilot).length === 0).toBe(valid);
    expect(validateNativeRolePreflight(f.packet, f.current, f.policy).errors.length === 0).toBe(valid);
    expect((await run(f)).status).toBe(valid ? 'ASTRA_APPROVED' : 'ASTRA_PENDING');
  };
  const withhold = (f: ReturnType<typeof fixture>) => {
    for (const record of [f.builder, f.reviewer]) {
      const e = record.nativeTaskEvidence, spawn = e.spawn, original = spawn.request.message;
      spawn.request.message = null; spawn.requestMessageAvailability = 'WITHHELD_PRIVATE';
      spawn.privateMessage = { schemaVersion: 1, sha256: hash(original), byteLength: Buffer.byteLength(original, 'utf8'),
        encoding: 'UTF-8', retention: 'ORIGINAL_VERBATIM_RETAINED_PRIVATELY',
        attestation: 'OPERATOR_ATTESTS_ORIGINAL_CAPTURE_HASH_AND_SCOPE', publicWorkScope: e.performedWorkScope,
        repository, prNumber: f.current.number, headSha: record.headSha, changeDigest: record.changeDigest,
        role: record.role, taskName: e.taskName, executionRef: record.executionRef,
        operatorLogin: e.operatorLogin, operatorId: e.operatorId,
        spawnObservedAt: spawn.observedAt, workStartedAt: record.startedAt,
        workCompletedAt: record.completedAt, workArtifactSha256: e.work.artifactSha256, attestedAt: e.compiledAt };
    }
    return f;
  };
  describe.each([routing, adoptionRouting])('private prompt scope PR$nativeRolePilot.prNumber', privateRouting => {
  it('P18 admits private retained prompts through shape, local and canonical paths without publishing original bytes', async () => {
    const f = withhold(fixture(privateRouting)); await expectMessageAdmission(f, true);
    expect(block(f.builder)).not.toContain('Synthetic BUILD assignment');
    expect(block(f.reviewer)).not.toContain('Synthetic REVIEW assignment');
    expect(validateNativeRolePreflight(f.packet, f.current, f.policy).canonicalReadbackVerified).toBe(false);
  });
  it.each(['BUILD', 'REVIEW'])('P18 supports mixed captured/private %s without changing original captured mode', async role => {
    const f = fixture(privateRouting), other = role === 'BUILD' ? f.reviewer : f.builder;
    const saved = structuredClone(other.nativeTaskEvidence.spawn);
    withhold(f); other.nativeTaskEvidence.spawn = saved;
    await expectMessageAdmission(f, true);
  });
  it.each([
    ['sha256', 'a'.repeat(63)], ['sha256', '0'.repeat(64)], ['sha256', 123], ['sha256', hash('')],
    ['byteLength', 0], ['byteLength', -1], ['byteLength', 1.2], ['byteLength', '24'], ['byteLength', Number.MAX_SAFE_INTEGER + 1],
    ['encoding', 'UTF-16'], ['retention', 'NOT_CAPTURED'], ['attestation', false],
    ['publicWorkScope', 'different public scope'], ['repository', 'other/repository'], ['prNumber', 836],
    ['headSha', 'b'.repeat(40)], ['changeDigest', 'c'.repeat(64)], ['role', 'OTHER'],
    ['taskName', '/root/another_task'], ['executionRef', 'native-task:another'],
    ['operatorLogin', 'other-operator'], ['operatorId', 987654321],
    ['spawnObservedAt', '2026-10-09T14:59:59Z'], ['workStartedAt', '2026-10-09T14:59:59Z'],
    ['workCompletedAt', '2026-10-09T15:59:59Z'], ['attestedAt', '2026-10-09T15:59:59Z'],
    ['schemaVersion', 2], ['workArtifactSha256', 'b'.repeat(64)], ['publicWorkScope', ''], ['publicWorkScope', '        '], ['publicWorkScope', {}],
    ['publicWorkScope', ['synthetic scope']], ['publicWorkScope', 123456789],
  ])('P18 rejects private proof mismatch %s=%s for each role', async (key, value) => {
    for (const role of ['builder', 'reviewer'] as const) {
      const f = withhold(fixture(privateRouting)); f[role].nativeTaskEvidence.spawn.privateMessage[key] = value;
      await expectMessageAdmission(f, false);
    }
  });
  it.each(['missing-proof', 'raw-also-present', 'unknown-availability', 'captured-with-private', 'missing-field'])('P18 rejects ambiguous private evidence: %s', async mode => {
    const f = withhold(fixture(privateRouting)), spawn = f.builder.nativeTaskEvidence.spawn;
    if (mode === 'missing-proof') delete spawn.privateMessage;
    if (mode === 'raw-also-present') spawn.request.message = 'Synthetic raw bytes must not coexist';
    if (mode === 'unknown-availability') spawn.requestMessageAvailability = 'HASH_ONLY';
    if (mode === 'captured-with-private') { spawn.request.message = 'Synthetic captured content'; spawn.requestMessageAvailability = 'CAPTURED'; }
    if (mode === 'missing-field') delete spawn.privateMessage.retention;
    await expectMessageAdmission(f, false);
  });
  it('P18 rejects private evidence under old exact source and disabled/missing policy mode', async () => {
    await expectMessageAdmission(withhold(fixture(historicalRouting)), false);
    for (const mode of [undefined, 'DISABLED']) {
      const policy = { ...privateRouting, nativeRolePilot: { ...privateRouting.nativeRolePilot, privateMessageMode: mode } };
      await expectMessageAdmission(withhold(fixture(policy)), false);
    }
  });
  it('P18 rejects cross-role commitment replay and unapproved scope even when pilot is changed consistently', async () => {
    const replay = withhold(fixture(privateRouting));
    replay.reviewer.nativeTaskEvidence.spawn.privateMessage = structuredClone(replay.builder.nativeTaskEvidence.spawn.privateMessage);
    await expectMessageAdmission(replay, false);
    const policy = { ...privateRouting, nativeRolePilot: { ...privateRouting.nativeRolePilot, headSha: 'b'.repeat(40) } };
    await expectMessageAdmission(withhold(fixture(policy)), false);
  });
  it('P18 explicitly remains operator attestation, not authentication of unavailable private bytes', async () => {
    const f = withhold(fixture(privateRouting)); f.builder.nativeTaskEvidence.spawn.privateMessage.sha256 = hash('different private bytes');
    // Public validation cannot recompute withheld bytes. Canonical operator identity and all bindings still apply.
    await expectMessageAdmission(f, true);
    f.github.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({ data: { permission: 'read' } });
    expect((await run(f)).status).toBe('ASTRA_PENDING');
  });
  });
  const adoptionAdmission = async (f: ReturnType<typeof fixture>) => {
    const bodySha256 = hash(block(f.builder));
    f.reviewer.nativeTaskEvidence.builderReadback.bodySha256 = bodySha256;
    Object.assign(f.context.roleEvidence.builder, f.builder, { sourceBodySha256: bodySha256 });
    Object.assign(f.context.roleEvidence.reviewer, f.reviewer);
    return { shape: nativeRoleShapeErrors(f.review, f.context, f.pilot).length === 0,
      local: validateNativeRolePreflight(f.packet, f.current, f.policy).errors.length === 0,
      canonical: (await run(f)).status === 'ASTRA_APPROVED' };
  };
  it.each(['builder', 'reviewer'] as const)('P2 captured original prompt is text for %s, never coercible JSON', async role => {
    for (const message of [{}, ['Synthetic role assignment'], 123456789]) {
      const f = fixture(adoptionRouting);
      f.builder.nativeTaskEvidence.performedWorkScope = adoptionBuildScope;
      f[role].nativeTaskEvidence.spawn.request.message = message;
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
    }
  });
  describe.each([false, true])('P2 exact848 BUILD declaration, private=%s', privatePrompt => {
    const declaration = (scope: unknown) => {
      const f = fixture(adoptionRouting);
      if (privatePrompt) withhold(f);
      f.builder.nativeTaskEvidence.performedWorkScope = scope;
      if (privatePrompt) f.builder.nativeTaskEvidence.spawn.privateMessage.publicWorkScope = scope;
      return f;
    };
    it('admits the exact public adoption/full-verification/no-authorship declaration', async () => {
      expect(await adoptionAdmission(declaration(adoptionBuildScope))).toEqual({ shape: true, local: true, canonical: true });
    });
    it.each([
      ['ordinary-construction', 'Synthetic four-file construction; other authors unchanged'],
      ['original-authorship', 'I originally authored and constructed all four source files in PR #848'],
      ['missing', undefined], ['null', null], ['object', {}], ['array', [adoptionBuildScope]], ['number', 848848848],
      ['empty', ''], ['wrong-pr', adoptionBuildScope.replace('#848', '#843')],
      ['adoption-only', 'Fresh adoption of existing PR #848 exact source; no original authorship claimed.'],
      ['verification-only', 'Full verification of existing PR #848 exact source; no original authorship claimed.'],
      ['missing-no-authorship', 'Fresh adoption and full verification of existing PR #848 exact source.'],
      ['appended-contradiction', adoptionBuildScope + ' I also claim original authorship of all source.'],
      ['prepended-contradiction', 'I am the original author. ' + adoptionBuildScope],
      ['whitespace-drift', adoptionBuildScope + ' '], ['case-drift', adoptionBuildScope.toUpperCase()],
    ])('rejects non-exact or contradictory declaration: %s', async (_name, scope) => {
      expect(await adoptionAdmission(declaration(scope))).toEqual({ shape: false, local: false, canonical: false });
    });
  });
  it.each([undefined, 'Ordinary original source construction', adoptionBuildScope + ' I am also the original author.'])(
    'P2 policy cannot omit or redefine the fixed declaration: %s', async buildWorkScope => {
      const policy = { ...adoptionRouting, nativeRolePilot: { ...adoptionRouting.nativeRolePilot, buildWorkScope } };
      const f = fixture(policy); f.builder.nativeTaskEvidence.performedWorkScope = buildWorkScope;
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
    });
  it('P2 private public scope cannot claim adoption while the BUILD scope claims original authorship', async () => {
    const f = withhold(fixture(adoptionRouting));
    f.builder.nativeTaskEvidence.performedWorkScope = 'I am the original author of every source file';
    expect(f.builder.nativeTaskEvidence.spawn.privateMessage.publicWorkScope).toBe(adoptionBuildScope);
    expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
  });
  describe.each([false, true])('P2 exact848 complete contract, private=%s', privatePrompt => {
    const fresh = () => privatePrompt ? withhold(fixture(adoptionRouting)) : fixture(adoptionRouting);
    it.each([
      ['builder-provider', (f: any) => { f.builder.provider = 'ANTHROPIC'; }],
      ['builder-model', (f: any) => { f.builder.requestedModel = f.builder.nativeTaskEvidence.spawn.request.model = 'gpt-6-astra'; }],
      ['identity-overclaim', (f: any) => { f.builder.actorId = 'invented-backend-id'; }],
      ['model-overclaim', (f: any) => { f.builder.actualModel = 'gpt-6.1-sol'; }],
      ['served-overclaim', (f: any) => { f.review.servedVerified = true; }],
      ['missing-namespace', (f: any) => { delete f.builder.nativeTaskEvidence.namespace; }],
      ['different-generation', (f: any) => { f.reviewer.nativeTaskEvidence.captureGeneration = 'different-generation'; }],
      ['different-operator', (f: any) => { f.reviewer.nativeTaskEvidence.operatorId = 123456789; }],
      ['unwitnessed-spawn', (f: any) => { f.builder.nativeTaskEvidence.spawn.sourceKind = 'WORKER_REPORTED'; }],
      ['missing-work-hash', (f: any) => { delete f.builder.nativeTaskEvidence.work.artifactSha256; }],
      ['unstopped-build', (f: any) => { f.builder.nativeTaskEvidence.completion.stoppedWriting = false; }],
      ['completion-scope', (f: any) => { f.builder.nativeTaskEvidence.completion.headSha = 'b'.repeat(40); }],
      ['completion-order', (f: any) => { f.builder.nativeTaskEvidence.completion.observedAt = '2026-10-10T12:49:00Z'; }],
      ['future-compilation', (f: any) => { f.reviewer.nativeTaskEvidence.compiledAt = '2099-01-01T00:00:00Z'; }],
      ['inherited-final-context', (f: any) => { f.reviewer.nativeTaskEvidence.spawn.request.fork_turns = 'all'; }],
      ['unattested-isolation', (f: any) => { f.reviewer.nativeTaskEvidence.contextIsolationAttested = false; }],
      ['not-fresh-final', (f: any) => { f.reviewer.freshContext = false; }],
    ])('rejects role-contract violation: %s', async (_name, mutate) => {
      const f = fresh(); expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
      (mutate as (f: any) => void)(f);
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
    });
    it.each(['branch-only', 'tampered-main-blob', 'unknown-generation', 'intermediate-disable', 'main-race',
      'untrusted-actor', 'deleted-comment', 'duplicate-role-block', 'foreign-comment', 'canonical-actor-mismatch', 'latest-finding'])(
      'canonical readback rejects %s without treating local shape as authority', async mode => {
        const f = fresh(); expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
        if (mode === 'branch-only') f.github.rest.repos.getContent.mockRejectedValue(new Error('no enabled main policy'));
        if (mode === 'tampered-main-blob') f.github.rest.repos.getContent.mockResolvedValue({ data: { type: 'file', encoding: 'base64', content: '{}', sha: main } });
        if (mode === 'unknown-generation') f.github.rest.repos.listCommits.mockResolvedValue({ data: [] });
        if (mode === 'intermediate-disable') {
          f.github.rest.repos.listCommits.mockResolvedValue({ data: [{ sha: 'c'.repeat(40) }] });
          f.github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { status: 'behind' } });
        }
        if (mode === 'main-race') f.github.rest.repos.getCommit.mockResolvedValueOnce({ data: { sha: main } }).mockResolvedValue({ data: { sha: 'c'.repeat(40) } });
        if (mode === 'untrusted-actor') f.github.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({ data: { permission: 'read' } });
        if (mode === 'deleted-comment') f.github.rest.issues.getComment.mockRejectedValue(new Error('404'));
        if (['duplicate-role-block', 'foreign-comment', 'canonical-actor-mismatch'].includes(mode)) {
          const read = f.github.rest.issues.getComment.getMockImplementation();
          f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
            const result = await read(args);
            if (mode === 'duplicate-role-block') result.data.body += '\n' + block({});
            if (mode === 'foreign-comment') result.data.html_url = result.data.html_url.replace(repository, 'foreign/repo');
            if (mode === 'canonical-actor-mismatch') result.data.user = { ...actor, id: actor.id + 1 };
            return result;
          });
        }
        if (mode === 'latest-finding') f.github.paginate.mockImplementation(async (method: any) => method === f.listFiles ? adoptionFiles
          : [f.record(), { ...f.record(), id: 202, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-10T12:55:00Z', body: 'blocking finding' }]);
        expect(validateNativeRolePreflight(f.packet, f.current, f.policy)).toMatchObject({ canonicalReadbackVerified: false, status: 'NEEDS_CANONICAL_READBACK' });
        expect((await run(f)).status).toBe('ASTRA_PENDING');
      });
  });
  const coincidentAdoption = () => {
    const f = fixture(adoptionRouting), time = '2026-10-10T13:00:00.000000001Z';
    for (const record of [f.builder, f.reviewer]) {
      const e = record.nativeTaskEvidence;
      record.startedAt = record.completedAt = e.compiledAt = e.spawn.observedAt = e.work.startedAt = e.work.observedAt =
        e.completion.observedAt = e.policyReadback.observedAt = time;
    }
    f.reviewer.nativeTaskEvidence.builderReadback.updatedAt = f.reviewer.nativeTaskEvidence.builderReadback.observedAt = time;
    f.context.roleEvidence.builder.sourceUpdatedAt = f.context.roleEvidence.reviewer.sourceUpdatedAt = f.review.submittedAt = time;
    const read = f.github.rest.issues.getComment.getMockImplementation();
    f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
      const result = await read(args);
      result.data.updated_at = f.context.roleEvidence[args.comment_id === 101 ? 'builder' : 'reviewer'].sourceUpdatedAt;
      return result;
    });
    return f;
  };
  describe.each(['builder', 'reviewer'] as const)('P2 exact848 nanosecond role timing: %s', role => {
    it.each(['work-before-start', 'work-after-completion', 'completed-before-start', 'compiled-before-completion', 'done-not-completed'])(
      'rejects previously truncated ordering/equality edge %s', async edge => {
        const f = coincidentAdoption(), record = f[role], e = record.nativeTaskEvidence;
        expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
        const before = '2026-10-10T13:00:00.000000000Z', after = '2026-10-10T13:00:00.000000002Z';
        if (edge === 'work-before-start') e.work.observedAt = before;
        if (edge === 'work-after-completion') e.work.observedAt = after;
        if (edge === 'completed-before-start') record.completedAt = e.completion.observedAt = before;
        if (edge === 'compiled-before-completion') e.compiledAt = before;
        if (edge === 'done-not-completed') e.completion.observedAt = after;
        expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
      });
  });
  it.each(['readback-before-updated', 'readback-updated-before-completion'])(
    'P2 exact848 BUILD readback rejects 1ns inversion: %s', async edge => {
      const f = coincidentAdoption(), rb = f.reviewer.nativeTaskEvidence.builderReadback;
      const before = '2026-10-10T13:00:00.000000000Z';
      if (edge === 'readback-before-updated') rb.observedAt = before;
      else rb.updatedAt = f.context.roleEvidence.builder.sourceUpdatedAt = before;
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
    });
  it.each(['review-source-before-compiled', 'review-submission-before-completion'])(
    'P2 canonical exact848 source timing rejects 1ns inversion: %s', async edge => {
      const f = coincidentAdoption(), before = '2026-10-10T13:00:00.000000000Z';
      if (edge === 'review-source-before-compiled') f.context.roleEvidence.reviewer.sourceUpdatedAt = before;
      else f.review.submittedAt = before;
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: true, canonical: false });
    });
  it('P2 exact848 compilation cannot be 1ns in the future', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-10T13:00:00.000Z'));
      expect(await adoptionAdmission(coincidentAdoption())).toEqual({ shape: false, local: false, canonical: false });
    } finally { vi.useRealTimers(); }
  });
  it('P2 does not invent REVIEW policy readback after BUILD completion or reject equivalent UTC instants', async () => {
    const f = fixture(adoptionRouting);
    f.reviewer.nativeTaskEvidence.policyReadback.observedAt = '2026-10-10T12:46:59Z';
    f.builder.nativeTaskEvidence.completion.observedAt = f.builder.completedAt.replace('.000Z', 'Z');
    expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
  });
  it.each(['before-approval', 'missing-readback', 'wrong-kind', 'wrong-version', 'wrong-main', 'late-readback', 'submillisecond-late-readback', 'submillisecond-early-work'])(
    'P1 adoption rejects pre-policy or unbound BUILD: %s', async mode => {
      const f = fixture(adoptionRouting), b = f.builder, e = b.nativeTaskEvidence;
      expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
      if (mode === 'before-approval') e.policyReadback.observedAt = e.spawn.observedAt = '2026-10-10T12:46:54Z';
      if (mode === 'missing-readback') delete e.policyReadback;
      if (mode === 'wrong-kind') e.policyReadback.sourceKind = 'WORKER_REPORTED';
      if (mode === 'wrong-version') e.policyReadback.version = 'stale';
      if (mode === 'wrong-main') e.policyReadback.mainSha = 'b'.repeat(40);
      if (mode === 'late-readback') e.policyReadback.observedAt = '2026-10-10T12:53:00Z';
      if (mode === 'submillisecond-late-readback') e.policyReadback.observedAt = '2026-10-10T12:47:00.000001Z';
      if (mode === 'submillisecond-early-work') {
        e.spawn.observedAt = '2026-10-10T12:47:00.000002Z';
        b.startedAt = e.work.startedAt = e.work.observedAt = '2026-10-10T12:47:00.000001Z';
      }
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
    });
  it.each([
    ['2026-10-10T12:46:54.792000Z', false], ['2026-10-10T12:46:54.792159Z', false],
    ['2026-10-10T12:46:54.792160Z', true], ['2026-10-10T12:46:54.793000Z', true],
  ])('P1 adoption preserves exact fractional approval boundary %s', async (time, valid) => {
    const f = fixture(adoptionRouting), b = f.builder, e = b.nativeTaskEvidence;
    e.policyReadback.observedAt = e.spawn.observedAt = b.startedAt = e.work.startedAt = e.work.observedAt = time;
    expect(await adoptionAdmission(f)).toEqual({ shape: valid, local: valid, canonical: valid });
  });
  it.each([undefined, null, 123, {}, [], 'invalid-utc', '2026-02-30T12:00:00Z', '2026-10-10T12:46:54.7921600000Z'])(
    'P1 malformed adoption readback fails closed without throwing: %j', async observedAt => {
      const f = fixture(adoptionRouting); f.builder.nativeTaskEvidence.policyReadback.observedAt = observedAt;
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
    });
  it.each([undefined, '2026-10-10T12:46:54Z', '2026-10-10T12:46:54.792000Z'])(
    'P1 policy cannot omit or round down the approval boundary: %s', async adoptionApprovedAt => {
      const policy = { ...adoptionRouting, nativeRolePilot: { ...adoptionRouting.nativeRolePilot, adoptionApprovedAt } };
      expect(await adoptionAdmission(fixture(policy))).toEqual({ shape: false, local: false, canonical: false });
    });
  it('P1 neither BUILD start nor REVIEW spawn can slip below approval within the same millisecond', async () => {
    for (const earlier of ['build-start', 'review-spawn']) {
      const f = fixture(adoptionRouting), b = f.builder, r = f.reviewer, be = b.nativeTaskEvidence, re = r.nativeTaskEvidence;
      const approved = '2026-10-10T12:46:54.792160Z', before = '2026-10-10T12:46:54.792159Z';
      be.policyReadback.observedAt = be.spawn.observedAt = b.startedAt = be.work.startedAt = be.work.observedAt = approved;
      b.completedAt = be.completion.observedAt = be.compiledAt = approved;
      re.builderReadback.updatedAt = re.builderReadback.observedAt = re.policyReadback.observedAt = re.spawn.observedAt = approved;
      f.context.roleEvidence.builder.sourceUpdatedAt = approved;
      const read = f.github.rest.issues.getComment.getMockImplementation();
      f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
        const result = await read(args); if (args.comment_id === 101) result.data.updated_at = approved; return result;
      });
      expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
      if (earlier === 'build-start') b.startedAt = be.work.startedAt = be.work.observedAt = before;
      else re.spawn.observedAt = before;
      expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
    }
  });
  it('P1 unrelated main advance preserves the same verified BUILD/REVIEW policy generation', async () => {
    const f = fixture(adoptionRouting);
    f.github.rest.repos.getCommit.mockResolvedValue({ data: { sha: 'c'.repeat(40) } });
    expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
  });
  it('P1 adoption rejects the original pre-approval synthetic timeline without rewriting 843 history', async () => {
    const f = fixture(adoptionRouting), seen = new Set<any>();
    const beforeApproval = (value: any): void => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const [key, item] of Object.entries(value)) {
        if (key !== 'adoptionApprovedAt' && typeof item === 'string' && /^2026-10-10T/.test(item))
          value[key] = new Date(Date.parse(item) - 86400000).toISOString();
        else beforeApproval(item);
      }
    };
    beforeApproval(f.builder); beforeApproval(f.reviewer); beforeApproval(f.review); beforeApproval(f.context.roleEvidence);
    const getComment = f.github.rest.issues.getComment.getMockImplementation();
    f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
      const result = await getComment(args); result.data.updated_at = new Date(Date.parse(result.data.updated_at) - 86400000).toISOString(); return result;
    });
    expect(await adoptionAdmission(f)).toEqual({ shape: false, local: false, canonical: false });
  });
  it('P1 BUILD policy evidence cannot enable branch-only or a different canonical generation', async () => {
    const f = fixture(adoptionRouting);
    expect(await adoptionAdmission(f)).toEqual({ shape: true, local: true, canonical: true });
    f.context.nativePolicyEvidence.reviewedMainSha = 'b'.repeat(40);
    expect(nativeRoleShapeErrors(f.review, f.context, f.pilot).length).toBeGreaterThan(0);
    f.github.rest.repos.getContent.mockRejectedValue(new Error('enabled main policy unavailable'));
    expect((await run(f)).status).toBe('ASTRA_PENDING');
  });
  it('A848 activates only the exact four-file adoption scope, with truthful unknown identity', async () => {
    expect(currentRouting.nativeRolePilot).toEqual(adoptionRouting.nativeRolePilot);
    expect(changeDigestOf(adoptionFiles)).toBe(adoptionRouting.nativeRolePilot.changeDigest);
    for (const privatePrompt of [false, true]) {
      const f = fixture(currentRouting);
      if (privatePrompt) withhold(f);
      for (const record of [f.builder, f.reviewer]) record.nativeTaskEvidence.performedWorkScope = record.role === 'BUILD'
        ? adoptionBuildScope
        : 'Synthetic independent final review of all four existing source files';
      if (privatePrompt) for (const record of [f.builder, f.reviewer])
        record.nativeTaskEvidence.spawn.privateMessage.publicWorkScope = record.nativeTaskEvidence.performedWorkScope;
      await expectMessageAdmission(f, true);
      expect(validateNativeRolePreflight(f.packet, f.current).canonicalReadbackVerified).toBe(false);
      expect(f.builder).toMatchObject({ actorId: null, sessionId: null, actualModel: 'unknown', identityEvidence: 'UNKNOWN', servedVerified: false });
    }
  });
  it.each([routing, historicalRouting])('A848 current singleton rejects historical PR843 even when its captured shape is valid', async policy => {
    const f = fixture(policy);
    expect(nativeRoleShapeErrors(f.review, f.context, f.pilot)).toEqual([]);
    expect(nativeRoleShapeErrors(f.review, f.context, currentRouting.nativeRolePilot).length).toBeGreaterThan(0);
    expect(validateNativeRolePreflight(f.packet, f.current).errors.length).toBeGreaterThan(0);
    expect((await run(f, currentRouting)).status).toBe('ASTRA_PENDING');
  });
  it.each([
    ['repository', 'foreign/repository'], ['prNumber', 843], ['headSha', 'b'.repeat(40)],
    ['changeDigest', 'b'.repeat(64)], ['surface', 'PRODUCTION_DB_RELEASE'], ['surface', 'G5'], ['surface', 'WRITER'],
  ])('A848 rejects nonmatching active scope %s=%s', async (key, value) => {
    const f = fixture(adoptionRouting), wrong = { ...adoptionRouting, nativeRolePilot: { ...adoptionRouting.nativeRolePilot, [key]: value } };
    expect(nativeRoleShapeErrors(f.review, f.context, wrong.nativeRolePilot).length).toBeGreaterThan(0);
    expect(validateNativeRolePreflight(f.packet, f.current, wrong).errors.length).toBeGreaterThan(0);
    expect((await run(f, wrong)).status).toBe('ASTRA_PENDING');
  });
  it.each([{ policy: adoptionRouting, mode: 'PR843_RETAINED_ORIGINAL_V1' }, { policy: routing, mode: 'PR848_RETAINED_ORIGINAL_V1' }])(
    'A848 private modes cannot be exchanged across exact source scopes', async ({ policy, mode }) => {
      const wrong = { ...policy, nativeRolePilot: { ...policy.nativeRolePilot, privateMessageMode: mode } };
      await expectMessageAdmission(withhold(fixture(wrong)), false);
    });
  it.each(['BUILD', 'REVIEW'])('A848 requires fresh complete %s capture, never historical NOT_CAPTURED', async role => {
    for (const field of ['message', 'model', 'fork_turns', 'reasoning_effort', 'observedAt', 'result', 'NOT_CAPTURED']) {
      const f = fixture(adoptionRouting), record = role === 'BUILD' ? f.builder : f.reviewer;
      // Selected REVIEW must retain its actual request too; no-selector fallback is a separate existing mode.
      if (role === 'REVIEW') {
        record.requestedModel = record.nativeTaskEvidence.spawn.request.model = f.review.requestedModel = 'gpt-6.1-sol';
      }
      const spawn = record.nativeTaskEvidence.spawn;
      if (field === 'NOT_CAPTURED') { spawn.request.message = null; spawn.requestMessageAvailability = 'NOT_CAPTURED'; }
      else if (['observedAt', 'result'].includes(field)) delete spawn[field];
      else delete spawn.request[field];
      await expectMessageAdmission(f, false);
    }
    await expectMessageAdmission(uncapturedBuild(adoptionRouting), false);
  });
  it.each(['same-task', 'same-execution', 'same-comment', 'participated', 'early', 'before-readback', 'old-policy-readback', 'edited-body', 'edited-comment'])(
    'A848 rejects self/early/stale final review: %s', async mode => {
      const f = withhold(fixture(adoptionRouting)), b = f.builder, r = f.reviewer, e = r.nativeTaskEvidence;
      await expectMessageAdmission(f, true); // Establish valid canonical private proof before each mutation.
      if (mode === 'same-task') e.taskName = b.nativeTaskEvidence.taskName;
      if (mode === 'same-execution') r.executionRef = b.executionRef;
      if (mode === 'same-comment') r.sourceRef = f.review.reviewerExecutionReceipt = b.sourceRef;
      if (mode === 'participated') e.participatedInBuild = true;
      if (mode === 'early') e.reviewPhase = 'EARLY';
      if (mode === 'before-readback') e.spawn.observedAt = '2026-10-09T15:02:30Z';
      if (mode === 'old-policy-readback') e.policyReadback.version = 'stale';
      if (mode === 'edited-body') e.builderReadback.bodySha256 = 'c'.repeat(64);
      if (mode === 'edited-comment') {
        const read = f.github.rest.issues.getComment.getMockImplementation();
        f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
          const result = await read(args); result.data.updated_at = '2026-10-09T15:08:00Z'; return result;
        });
      }
      expect((await run(f)).status).toBe('ASTRA_PENDING');
    });
  it('A848 source admission never authorizes DB release, G5 or writer', async () => {
    const f = fixture(adoptionRouting), releasePacket = { releaseId: 'synthetic-release', planDigest: 'b'.repeat(64), repository };
    expect((await run(f)).status).toBe('ASTRA_APPROVED');
    for (const reviewSurface of ['PRODUCTION_DB_RELEASE', 'G5', 'WRITER'])
      expect(finalRiskReviewerErrors(f.review, adoptionRouting, { ...f.context, reviewSurface }).length).toBeGreaterThan(0);
    expect(() => buildProductionDbFinalRiskEvidence({ body: f.current.body, changedFiles: adoptionFiles.map(file => file.filename), context: f.context, reviews: [f.record()], releasePacket })).toThrow('FINAL_RISK_NOT_APPROVED');
    await expect(buildProductionDbFinalRiskEvidenceFromGithub({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', prNumber: 848, releasePacket })).rejects.toThrow('FINAL_RISK_NOT_APPROVED');
  });
  it('T17 binds the approved frozen driver repair, with current six-file blobs and captured tasks', async () => {
    expect(pilot.headSha).toBe('47f259db7b2f4ab50b08c0962cc8d6f676575fd0');
    expect(changeDigestOf(files)).toBe('18ee75322cafca9148e043cee7ba518ea767ab4f8449fd6eb655c8cb5192b6ba');
    expect(changeDigestOf(historicalFiles)).toBe(historicalPilot.changeDigest);
    const f = fixture(); await expectMessageAdmission(f, true);
  });
  it.each(['captured', 'uncaptured'])('T17 current policy rejects prior source even with valid %s roles', async mode => {
    const f = mode === 'captured' ? fixture(historicalRouting) : uncapturedBuild();
    expect(nativeRoleShapeErrors(f.review, f.context, pilot).length).toBeGreaterThan(0);
    expect(validateNativeRolePreflight(f.packet, f.current, routing).errors.length).toBeGreaterThan(0);
    expect((await run(f, routing)).status).toBe('ASTRA_PENDING');
  });
  it('T17 cannot move historical missing-prompt compatibility onto the repaired source', async () => {
    const f = uncapturedBuild(routing); await expectMessageAdmission(f, false);
    f.builder.nativeTaskEvidence.spawn.request.message = 'Synthetic genuinely captured new BUILD assignment';
    f.builder.nativeTaskEvidence.spawn.requestMessageAvailability = 'CAPTURED';
    await expectMessageAdmission(f, true);
  });
  it('T05 accepts explicit historical BUILD message NOT_CAPTURED without manufacturing a prompt', async () => {
    const f = uncapturedBuild(); await expectMessageAdmission(f, true);
    expect(f.builder.nativeTaskEvidence.spawn.request.message).toBeNull();
    expect(f.builder).toMatchObject({ actorId: null, sessionId: null, actualModel: 'unknown', identityEvidence: 'UNKNOWN', servedVerified: false });
  });
  it.each(['execution-ref', 'spawn-instant', 'work-instant', 'completion-instant', 'later-same-name'])('P2 binds uncaptured BUILD to historical observations: %s', async mode => {
    const f = uncapturedBuild(), e = f.builder.nativeTaskEvidence;
    if (mode === 'execution-ref') f.builder.executionRef = 'operator-scoped:another-build';
    if (mode === 'spawn-instant') e.spawn.observedAt = '2026-10-09T14:28:17Z';
    if (mode === 'work-instant') f.builder.startedAt = e.work.startedAt = e.work.observedAt = '2026-10-09T14:32:27Z';
    if (mode === 'completion-instant') f.builder.completedAt = e.completion.observedAt = e.compiledAt = '2026-10-09T15:32:01Z';
    if (mode === 'later-same-name') {
      // Reused strings are legal synthetic data, not historical platform identities.
      const seen = new Set<any>();
      const later = (value: any): void => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        for (const [key, item] of Object.entries(value)) {
          if (typeof item === 'string' && /^2026-10-09T/.test(item)) value[key] = new Date(Date.parse(item) + 60_000).toISOString();
          else later(item);
        }
      };
      later(f.builder); later(f.reviewer); later(f.review); later(f.context);
      for (const role of [f.builder, f.reviewer]) {
        role.nativeTaskEvidence.namespace = 'synthetic-later-task-tree'; role.nativeTaskEvidence.captureGeneration = 'synthetic-later-capture';
      }
      const getComment = f.github.rest.issues.getComment.getMockImplementation();
      f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
        const result = await getComment(args); result.data.updated_at = new Date(Date.parse(result.data.updated_at) + 60_000).toISOString(); return result;
      });
    }
    await expectMessageAdmission(f, false);
    // The same later/different task is otherwise valid when its prompt was genuinely captured.
    e.spawn.request.message = 'Synthetic captured assignment for the different task'; e.spawn.requestMessageAvailability = 'CAPTURED';
    await expectMessageAdmission(f, true);
  });
  it('P2 compares recorded instants, without inventing historical namespace/generation', async () => {
    const f = uncapturedBuild(), e = f.builder.nativeTaskEvidence;
    e.spawn.observedAt = '2026-10-09T14:28:16.000Z';
    f.builder.startedAt = e.work.startedAt = e.work.observedAt = '2026-10-09T14:32:26.000Z';
    f.builder.completedAt = e.completion.observedAt = e.compiledAt = '2026-10-09T15:32:00.000Z';
    for (const role of [f.builder, f.reviewer]) {
      role.nativeTaskEvidence.namespace = 'synthetic-operator-compilation-scope';
      role.nativeTaskEvidence.captureGeneration = 'synthetic-current-compilation';
    }
    await expectMessageAdmission(f, true);
  });
  it.each([
    ['missing-availability', (f: any) => { delete f.builder.nativeTaskEvidence.spawn.requestMessageAvailability; }],
    ['unknown-availability', (f: any) => { f.builder.nativeTaskEvidence.spawn.requestMessageAvailability = 'UNKNOWN'; }],
    ['missing-message-key', (f: any) => { delete f.builder.nativeTaskEvidence.spawn.request.message; }],
    ['empty-message', (f: any) => { f.builder.nativeTaskEvidence.spawn.request.message = ''; }],
    ['summary-instead-of-null', (f: any) => { f.builder.nativeTaskEvidence.spawn.request.message = 'Later reconstructed assignment summary'; }],
    ['different-task', (f: any) => { const e = f.builder.nativeTaskEvidence; e.taskName = e.spawn.result.task_name = '/root/other_builder'; e.spawn.request.task_name = 'other_builder'; }],
    ['unwitnessed-spawn', (f: any) => { f.builder.nativeTaskEvidence.spawn.sourceKind = 'WORKER_REPORTED'; }],
    ['missing-model', (f: any) => { delete f.builder.nativeTaskEvidence.spawn.request.model; }],
    ['missing-fork', (f: any) => { delete f.builder.nativeTaskEvidence.spawn.request.fork_turns; }],
    ['missing-reasoning', (f: any) => { delete f.builder.nativeTaskEvidence.spawn.request.reasoning_effort; }],
    ['missing-spawn-time', (f: any) => { delete f.builder.nativeTaskEvidence.spawn.observedAt; }],
    ['missing-work-hash', (f: any) => { delete f.builder.nativeTaskEvidence.work.artifactSha256; }],
    ['missing-completion', (f: any) => { delete f.builder.nativeTaskEvidence.completion; }],
    ['wrong-provider', (f: any) => { f.builder.provider = 'ANTHROPIC'; }],
    ['wrong-tier', (f: any) => { f.builder.requestedModel = f.builder.nativeTaskEvidence.spawn.request.model = 'gpt-6-luna'; }],
    ['forged-backend', (f: any) => { f.builder.actorId = f.builder.nativeTaskEvidence.taskName; }],
    ['review-message-missing', (f: any) => { f.reviewer.nativeTaskEvidence.spawn.request.message = null; f.reviewer.nativeTaskEvidence.spawn.requestMessageAvailability = 'NOT_CAPTURED'; }],
    ['review-message-undefined', (f: any) => { delete f.reviewer.nativeTaskEvidence.spawn.request.message; }],
  ])('T05 historical message availability never waives %s', async (_name, mutate) => {
    const f = uncapturedBuild(); (mutate as (f: any) => void)(f); await expectMessageAdmission(f, false);
  });
  it.each(['other-pr', 'other-head', 'other-digest', 'other-repo', 'DB-surface'])('T02 historical message compatibility stays exact-scope: %s', async mode => {
    const f = uncapturedBuild();
    if (mode === 'other-pr') f.current.number = f.context.prNumber = 836;
    if (mode === 'other-head') f.current.head.sha = f.context.currentHeadSha = 'b'.repeat(40);
    if (mode === 'other-digest') f.review.changeDigest = 'b'.repeat(64);
    if (mode === 'other-repo') f.review.repository = f.packet.repository = f.context.repository = 'foreign/repo';
    if (mode === 'DB-surface') {
      f.context.reviewSurface = 'PRODUCTION_DB_RELEASE';
      expect(nativeRoleShapeErrors(f.review, f.context, pilot).length).toBeGreaterThan(0);
      expect(finalRiskReviewerErrors(f.review, routing, f.context).length).toBeGreaterThan(0);
      await expect(buildProductionDbFinalRiskEvidenceFromGithub({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild',
        prNumber: 843, releasePacket: { releaseId: 'synthetic-release', planDigest: 'b'.repeat(64), repository } })).rejects.toThrow('FINAL_RISK_NOT_APPROVED');
      return;
    }
    await expectMessageAdmission(f, false);
  });
  it('T05 captured messages remain compatible but reject contradictory availability', async () => {
    const f = fixture(); f.builder.nativeTaskEvidence.spawn.requestMessageAvailability = 'CAPTURED';
    f.reviewer.nativeTaskEvidence.spawn.requestMessageAvailability = 'CAPTURED'; await expectMessageAdmission(f, true);
    f.reviewer.nativeTaskEvidence.spawn.requestMessageAvailability = 'NOT_CAPTURED'; await expectMessageAdmission(f, false);
  });
  it.each([
    ['OPENAI', 'gpt-6.1-sol', true], ['ANTHROPIC', 'claude-sonnet-5-5', true],
    ['ANTHROPIC', 'gpt-6.1-sol', false], ['OPENAI', 'claude-sonnet-5-5', false],
    ['OPENAI', 'arbitrary-long-model', false], ['ANTHROPIC', 'arbitrary-long-model', false],
    ['OPENAI', 'gpt-6-luna', false], ['OPENAI', 'gpt-6-astra', false], ['OPENAI', 'gpt-5.6-sol', false],
    ['ANTHROPIC', 'claude-opus-5-5', false], ['ANTHROPIC', 'claude-haiku-4-5', false],
    ['OPENAI', 'not_requested', false], ['ANTHROPIC', 'not_requested', false],
  ])('T04/T13 native BUILD requires current provider-local tier: %s / %s', async (provider, requestedModel, valid) => {
    const f = fixture(); Object.assign(f.builder, { provider, requestedModel });
    if (requestedModel === 'not_requested') delete f.builder.nativeTaskEvidence.spawn.request.model;
    else f.builder.nativeTaskEvidence.spawn.request.model = requestedModel;
    const bodySha256 = hash(block(f.builder));
    f.reviewer.nativeTaskEvidence.builderReadback.bodySha256 = bodySha256;
    Object.assign(f.context.roleEvidence.builder, { provider, requestedModel, sourceBodySha256: bodySha256 });
    expect(nativeRoleShapeErrors(f.review, f.context, pilot).length === 0).toBe(valid);
    expect(validateNativeRolePreflight(f.packet, f.current, f.policy).errors.length === 0).toBe(valid);
    expect((await run(f)).status).toBe(valid ? 'ASTRA_APPROVED' : 'ASTRA_PENDING');
    expect(f.builder).toMatchObject({ actorId: null, sessionId: null, actualModel: 'unknown', identityEvidence: 'UNKNOWN', servedVerified: false });
  });
  it.each([
    ['disabled', { enabled: false }], ['unknown-version', { version: 'future' }], ['other-pr', { prNumber: 836 }],
    ['other-head', { headSha: 'b'.repeat(40) }], ['other-digest', { changeDigest: 'b'.repeat(64) }], ['DB-surface', { surface: 'PRODUCTION_DB_RELEASE' }],
  ])('T02 rejects pilot %s', (_name, patch) => {
    const f = fixture(); expect(nativeRoleShapeErrors(f.review, f.context, { ...pilot, ...(patch as object) }).length).toBeGreaterThan(0);
  });
  it.each([{ repository: 'foreign/repository' }, { headSha: 'b'.repeat(40) }, { changeDigest: 'b'.repeat(64) }])('T02 local review payload binding rejects %j', patch => {
    const f = fixture(); Object.assign(f.review, patch); expect(validateNativeRolePreflight(f.packet, f.current, f.policy).errors.length).toBeGreaterThan(0);
  });
  it('T12 full local preflight rejects a different current body without claiming canonical verification', () => {
    const f = fixture(); const result = validateWipPreflight({ body: body + '\nChanged metadata', nativeRoleEvidence: f.packet, currentPr: f.current });
    expect(result.errors).toContain('Native packet current PR body differs from preflight body'); expect(result.canonicalReadbackVerified).toBe(false);
  });
  it.each([
    ['forged-actor', (r: any) => { r.actorId = r.nativeTaskEvidence.taskName; }],
    ['forged-session', (r: any) => { r.sessionId = r.nativeTaskEvidence.taskName; }],
    ['actual-overclaim', (r: any) => { r.actualModel = 'gpt-6.1-sol'; }],
    ['served-overclaim', (r: any) => { r.servedVerified = true; }],
    ['unknown-schema', (r: any) => { r.nativeTaskEvidence.schemaVersion = 2; }],
    ['missing-witness', (r: any) => { r.nativeTaskEvidence.spawn.sourceKind = 'WORKER_REPORTED'; }],
    ['queued-completion', (r: any) => { r.nativeTaskEvidence.completion.event = 'QUEUED'; }],
    ['CI-not-completion', (r: any) => { r.nativeTaskEvidence.completion.event = 'CI_COMPLETED'; }],
    ['missing-result', (r: any) => { delete r.nativeTaskEvidence.spawn.result; }],
    ['hidden-exposed-session', (r: any) => { r.nativeTaskEvidence.spawn.result.sessionId = 'real-session'; }],
    ['invented-spawn-parameter', (r: any) => { r.nativeTaskEvidence.spawn.request.freshContext = true; }],
    ['missing-generation', (r: any) => { delete r.nativeTaskEvidence.captureGeneration; }],
    ['fork-all', (r: any) => { r.nativeTaskEvidence.spawn.request.fork_turns = 'all'; }],
    ['participated', (r: any) => { r.nativeTaskEvidence.participatedInBuild = true; }],
    ['not-fresh', (r: any) => { r.freshContext = false; }],
    ['early-renamed', (r: any) => { r.nativeTaskEvidence.reviewPhase = 'EARLY'; }],
    ['missing-time', (r: any) => { delete r.startedAt; }],
    ['future-time', (r: any) => { r.nativeTaskEvidence.compiledAt = '2099-01-01T00:00:00Z'; }],
    ['reverse-time', (r: any) => { r.completedAt = '2026-10-09T14:00:00Z'; }],
    ['foreign-comment', (r: any) => { r.sourceRef = ref(102).replace('/843#', '/836#'); }],
  ])('T04–T09 rejects declared %s in shared and local shape checks', (_name, mutate) => {
    const f = fixture(); (mutate as (r: any) => void)(f.reviewer);
    expect(nativeRoleShapeErrors(f.review, { ...f.context, roleEvidence: f.packet }, pilot).length).toBeGreaterThan(0);
    expect(validateNativeRolePreflight(f.packet, f.current, f.policy).errors.length).toBeGreaterThan(0);
  });
  it.each(['same-task', 'different-generation', 'wrong-operator', 'old-policy', 'old-head', 'early-time', 'edit-hash'])('T06/T09/T10 rejects %s', mode => {
    const f = fixture(), b = f.context.roleEvidence.builder, r = f.context.roleEvidence.reviewer;
    if (mode === 'same-task') r.nativeTaskEvidence.taskName = b.nativeTaskEvidence.taskName;
    if (mode === 'different-generation') r.nativeTaskEvidence.captureGeneration = 'other-generation';
    if (mode === 'wrong-operator') r.nativeTaskEvidence.operatorId = 99;
    if (mode === 'old-policy') delete f.review.nativeRolePolicyVersion;
    if (mode === 'old-head') f.context.currentHeadSha = 'b'.repeat(40);
    if (mode === 'early-time') r.startedAt = '2026-10-09T14:59:00Z';
    if (mode === 'edit-hash') b.sourceBodySha256 = 'b'.repeat(64);
    expect(independentRoleErrors(f.review, f.context).length).toBeGreaterThan(0);
  });
  it.each(['branch-only', 'tampered-main-blob', 'unknown-generation', 'intermediate-disable', 'main-race', 'permission', 'deleted-comment', 'edited-comment', 'multiple-json', 'foreign-url'])('T02/T10/T11/T14 adapter rejects %s', async mode => {
    const f = fixture();
    if (mode === 'branch-only') f.github.rest.repos.getContent.mockRejectedValue(new Error('pilot absent on main'));
    if (mode === 'tampered-main-blob') f.github.rest.repos.getContent.mockResolvedValue({ data: { type: 'file', encoding: 'base64', content: '{}', sha: main } });
    if (mode === 'unknown-generation') f.github.rest.repos.listCommits.mockResolvedValue({ data: [] });
    if (mode === 'intermediate-disable') { f.github.rest.repos.listCommits.mockResolvedValue({ data: [{ sha: 'c'.repeat(40) }] }); f.github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { status: 'behind' } }); }
    if (mode === 'main-race') f.github.rest.repos.getCommit.mockResolvedValueOnce({ data: { sha: main } }).mockResolvedValue({ data: { sha: 'c'.repeat(40) } });
    if (mode === 'permission') f.github.rest.repos.getCollaboratorPermissionLevel.mockRejectedValue(new Error('unavailable'));
    if (mode === 'deleted-comment') f.github.rest.issues.getComment.mockRejectedValue(new Error('404'));
    if (['edited-comment', 'multiple-json', 'foreign-url'].includes(mode)) {
      const original = f.github.rest.issues.getComment.getMockImplementation();
      f.github.rest.issues.getComment.mockImplementation(async (a: any) => { const r = await original(a);
        if (mode === 'edited-comment') r.data.updated_at = '2026-10-09T15:08:00Z';
        if (mode === 'multiple-json') r.data.body += '\n' + block({});
        if (mode === 'foreign-url') r.data.html_url = ref(a.comment_id).replace(repository, 'foreign/repo'); return r; });
    }
    try { expect((await run(f)).status).toBe('ASTRA_PENDING'); } catch (error) { expect(mode).toBe('permission'); }
  });
  it('T09 latest trusted negative cannot be replaced with older PASS', async () => {
    const f = fixture(); f.github.paginate.mockImplementation(async (method: any) => method === f.listFiles ? files : [f.record(), { ...f.record(), id: 202, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-09T15:08:00Z', body: 'blocking finding' }]);
    expect((await run(f)).status).toBe('ASTRA_PENDING');
  });
  it.each(['2026-10-09T15:00:00Z', '2026-10-09T15:02:30Z'])('T07 independently reproduced early final spawn %s is rejected remotely and locally', async observedAt => {
    const f = fixture(); f.reviewer.nativeTaskEvidence.spawn.observedAt = observedAt;
    expect((await run(f)).status).toBe('ASTRA_PENDING'); expect(validateNativeRolePreflight(f.packet, f.current, f.policy).errors.length).toBeGreaterThan(0);
  });
  it.each(['astra-review', 'sol-review'])('T10 rejects conflicting second native final %s block without changing legacy parser', async kind => {
    const f = fixture(); const review = { ...f.record(), body: f.record().body + '\n' + block({ ...f.review, verdict: 'FIX_REQUIRED', unresolvedFindingCount: 1 }, kind) };
    f.github.paginate.mockImplementation(async (method: any) => method === f.listFiles ? files : [review]);
    expect((await run(f)).status).toBe('ASTRA_PENDING');
    const { nativeRolePolicyVersion: _unused, ...legacy } = f.review;
    expect(parseAstraReviews([{ ...f.record(), body: block(legacy, 'astra-review') + '\n' + block({ ...legacy, verdict: 'FIX_REQUIRED' }, kind) }])[0].verdict).toBe('PASS');
  });
  it.each(['current', 'requested', 'duplicate-astra', 'duplicate-sol', 'overclaimed', 'wrong-version'])('T10/T13 actual native fallback adapter %s keeps replacement evidence consistent', async mode => {
    const f = fixture(); Object.assign(f.review, { reviewerTier: 'EVIDENCE_FALLBACK', fallbackPolicyVersion: '2026-09-30.1',
      failureClass: 'IDENTITY_UNAVAILABLE', failureEvidenceRef: ref(105), failureDiagnosis: 'Synthetic runtime exposes no served identity',
      replacementReviewRef: ref(106), playbookEvidenceRef: `https://github.com/${repository}/blob/main/docs/AGENT-PLAYBOOK.md#pb-031`,
      downgradeReason: 'REVIEWER_INFRASTRUCTURE_FAILURE', downgradeEvidenceRef: ref(105) });
    if (mode === 'requested') {
      Object.assign(f.review, { requestedModel: 'gpt-6.1-sol', modelSelectionAvailable: true });
      f.reviewer.requestedModel = 'gpt-6.1-sol'; f.reviewer.nativeTaskEvidence.spawn.request.model = 'gpt-6.1-sol';
      f.reviewer.runtimeCatalog = { provider: 'OPENAI', models: ['gpt-6.1-sol'], captureStartedAt: '2026-10-09T15:03:00Z',
        observedAt: '2026-10-09T15:03:01Z', providerEvidenceRef: f.reviewer.providerEvidenceRef, evidenceRef: ref(105) };
    }
    const getComment = f.github.rest.issues.getComment.getMockImplementation();
    f.github.rest.issues.getComment.mockImplementation(async (args: any) => {
      if (![105, 106].includes(args.comment_id)) return getComment(args);
      const replacement = { ...f.review, ...(mode === 'overclaimed' ? { servedVerified: true } : {}),
        ...(mode === 'wrong-version' ? { nativeRolePolicyVersion: 'future' } : {}) };
      return { data: { id: args.comment_id, html_url: ref(args.comment_id), user: actor,
        created_at: args.comment_id === 105 ? '2026-10-09T15:02:00Z' : '2026-10-09T15:05:00Z',
        updated_at: args.comment_id === 105 ? '2026-10-09T15:02:00Z' : '2026-10-09T15:06:00Z',
        body: args.comment_id === 105 ? f.review.failureDiagnosis : block(replacement, 'astra-review') +
          (mode.startsWith('duplicate-') ? '\n' + block({ ...replacement, verdict: 'FIX_REQUIRED', unresolvedFindingCount: 1 }, mode === 'duplicate-sol' ? 'sol-review' : 'astra-review') : '') } };
    });
    const getContent = f.github.rest.repos.getContent.getMockImplementation();
    f.github.rest.repos.getContent.mockImplementation(async (args: any) => {
      if (args.path !== 'docs/AGENT-PLAYBOOK.md') return getContent(args);
      const bytes = Buffer.from('<a id="pb-031"></a>\nSynthetic prevention');
      return { data: { type: 'file', encoding: 'base64', content: bytes.toString('base64'),
        sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') } };
    });
    expect((await run(f)).status).toBe(['current', 'requested'].includes(mode) ? 'ASTRA_APPROVED' : 'ASTRA_PENDING');
  });
  it.each([{ draft: true }, { state: 'closed' }, { body: body.replace('LANE_STATE: ACTIVE', 'LANE_STATE: PARKED') }])('T12 lifecycle does not approve or publish native final %j', async patch => {
    const f = fixture(); Object.assign(f.current, patch); expect((await run(f)).status).not.toBe('ASTRA_APPROVED');
    expect(validateNativeRolePreflight(f.packet, f.current, f.policy).errors.length).toBeGreaterThan(0);
  });
  it('T13 rejects DB entrypoints even when caller injects fully valid source context', async () => {
    const f = fixture(), releasePacket = { releaseId: 'synthetic-release', planDigest: 'b'.repeat(64), repository };
    expect(() => buildProductionDbFinalRiskEvidence({ body, changedFiles: files.map(f => f.filename), context: f.context, reviews: [f.record()], releasePacket })).toThrow('FINAL_RISK_NOT_APPROVED');
    await expect(buildProductionDbFinalRiskEvidenceFromGithub({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', prNumber: 843, releasePacket })).rejects.toThrow('FINAL_RISK_NOT_APPROVED');
    expect(finalRiskReviewerErrors(f.review, routing, { ...f.context, reviewSurface: 'PRODUCTION_DB_RELEASE' }).length).toBeGreaterThan(0);
  });
  it.each([{ reviewerTier: 'PREMIUM' }, { reviewerTier: 'AUDIT' }, { unresolvedFindingCount: 1 }, { servedVerified: true }, { modelSelectionAvailable: true }])('T13 native evidence does not waive existing model/cost/finding contract %j', patch => {
    const f = fixture(); Object.assign(f.review, patch); expect(finalRiskReviewerErrors(f.review, routing, f.context).length).toBeGreaterThan(0);
  });
  it('T10/T11 same-PR edit/delete still resolves current source and preserves unavailable status semantics', async () => {
    const f = fixture();
    const result = await resolveRoleReceiptWakeup({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', repository, issueNumber: 843, commentId: 101, nativePr: true });
    expect(result.numbers).toContain(843);
    f.github.paginate.mockRejectedValue(new Error('inventory unavailable'));
    await expect(run(f)).rejects.toThrow('inventory unavailable');
    // No status mutation exists in this adapter. The existing decoded-workflow tests
    // exercise pending-before-read and failed-write paths; an old green can remain.
    expect(f.github.rest.repos.createCommitStatus).toBeUndefined();
  });
  it('T14 disabled current policy invalidates an earlier valid synthetic packet', async () => {
    const f = fixture(); expect((await run(f)).status).toBe('ASTRA_APPROVED');
    expect((await run(f, { ...routing, nativeRolePilot: { ...pilot, enabled: false } })).status).toBe('ASTRA_PENDING');
  });
  it('T14 actual trusted-main disable rejects branch enabled config; unrelated main advance preserves generation', async () => {
    const f = fixture(); f.github.rest.repos.getCommit.mockResolvedValue({ data: { sha: 'c'.repeat(40) } });
    expect((await run(f)).status).toBe('ASTRA_APPROVED');
    const bytes = Buffer.from(JSON.stringify({ ...routing, nativeRolePilot: { ...pilot, enabled: false } }));
    f.github.rest.repos.getContent.mockResolvedValue({ data: { type: 'file', encoding: 'base64', content: bytes.toString('base64'),
      sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') } });
    expect((await run(f)).status).toBe('ASTRA_PENDING');
  });
  it('T15/T16 remains a source-only identity change; does not execute PG or invent TEST acceptance', () => {
    expect(pilot.surface).toBe('PRODUCT_SOURCE_FINAL_RISK');
    const source = readFileSync('scripts/agents/final-risk-cost-policy.mjs', 'utf8');
    expect(source).not.toContain('child_process'); expect(source).not.toContain('TEST_VERIFIED');
    const f = fixture(); expect(evaluateAstra({ body, changedFiles: files.map(f => f.filename), context: f.context, reviews: [f.record()] }, routing).status).toBe('ASTRA_APPROVED');
  });
});
