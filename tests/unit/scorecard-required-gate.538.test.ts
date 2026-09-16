import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { validateWipPreflight } from '../../scripts/agents/agent-wip-preflight.mjs';
import { shouldApplyProductGlobalWip } from '../../scripts/agents/governance-workstream-boundary.mjs';
import { createRunLedgerV2, validateRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import {
  isRunLedgerPath, validateRunLedgerContent, validateLocalRunLedgerChanges,
  validateGithubRunLedgerChanges,
} from '../../scripts/agents/scorecard-required-gate.mjs';

const ledgerPath = 'docs/metrics/agent-runs/2026-09-16-synthetic-538.json';
const makeRun = () => createRunLedgerV2('2026-09-16-synthetic-538', '2026-09-16T02:00:00Z',
  { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
const task = { id: 'observed', requestedModel: 'luna', actualModel: 'unknown', role: 'test fixture',
  count: 1, contextClass: 'compact', accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null };
const claim = { type: 'ISSUE_CLOSED', subject: 'issue#538', claimedState: 'closed', observedState: 'closed',
  verification: 'VERIFIED', evidenceRef: 'synthetic:issue#538' };
function remote(content = JSON.stringify(makeRun())) {
  const bytes = Buffer.from(content);
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const data = { encoding: 'base64', content: bytes.toString('base64'), sha, size: bytes.length };
  const requested: unknown[] = [];
  const github = { rest: { git: { getBlob: async (input: unknown) => { requested.push(input); return { data }; } } } };
  return { github, owner: 'owner', repo: 'repo', current: { head: { sha: 'a'.repeat(40) }, changed_files: 1 },
    changedFiles: [{ filename: ledgerPath, status: 'modified', sha }], data, requested };
}

describe('#538 shared required raw-capture gate', () => {
  it('permits a new active Run with terminal-only nulls, without creating a score', () => {
    const run = makeRun();
    const before = JSON.stringify(run);
    assert.deepEqual(validateRunLedgerContent(ledgerPath, before), []);
    assert.equal(JSON.stringify(run), before);
  });

  it('rejects both directions of close-claim disagreement even when the ledger schema is valid', () => {
    for (const claimsOnly of [false, true]) {
      const run = makeRun();
      if (claimsOnly) run.completionTruth.claims.push(claim);
      else run.delivery.issuesClosed = 1;
      assert.deepEqual(validateRunLedgerV2(run), []);
      assert.match(validateRunLedgerContent(ledgerPath, JSON.stringify(run)).join('\n'), /ISSUE_CLOSED/);
    }
  });

  it('accepts matching close evidence and uses existing task, CI and closure invariants', () => {
    const run = makeRun();
    run.delivery.issuesClosed = 1;
    run.completionTruth.claims.push(claim);
    run.modelUsage.tasks.push(task);
    run.flow.lunaTasks = 1;
    run.flow.lunaAccepted = 1;
    run.flow.solTouches = 3; // Deliberately not equal to the number of Sol task records.
    assert.deepEqual(validateRunLedgerContent(ledgerPath, JSON.stringify(run)), []);
    for (const mutate of [
      (r: ReturnType<typeof makeRun>) => { r.flow.lunaTasks = 2; },
      (r: ReturnType<typeof makeRun>) => { r.flow.lunaAccepted = 0; },
      (r: ReturnType<typeof makeRun>) => { r.ci.invalidReruns = 1; },
      (r: ReturnType<typeof makeRun>) => { r.inventory.closureAdvancedOrClosed = 1; },
      (r: ReturnType<typeof makeRun>) => { r.modelUsage.tasks.push(task); },
      (r: ReturnType<typeof makeRun>) => { r.modelUsage.tasks = []; },
    ]) {
      const broken = structuredClone(run);
      mutate(broken);
      assert.ok(validateRunLedgerContent(ledgerPath, JSON.stringify(broken)).length);
    }
  });

  it('does not let recovery state, unsupported schema or malformed data hide a broken counter', () => {
    const run = makeRun();
    run.status = 'CLOSURE_RECOVERY';
    run.delivery.issuesClosed = 1;
    for (const content of [undefined, '{', 'null', '{}', JSON.stringify(run),
      JSON.stringify({ ...run, schemaVersion: 99 }), JSON.stringify({ ...run, status: 'FAKE' })]) {
      assert.ok(validateRunLedgerContent(ledgerPath, content).length);
    }
  });

  it('ignores non-ledger paths but rejects traversal and recognises newline filenames', () => {
    assert.deepEqual(validateRunLedgerContent('docs/README.md', '{'), []);
    assert.ok(validateRunLedgerContent('docs/metrics/agent-runs/../secret.json', '{}').length);
    assert.equal(isRunLedgerPath('docs/metrics/agent-runs/line\nbreak.json'), true);
  });

  it('reads only changed regular local ledger files and fails missing, malformed or symlink evidence', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scorecard-538-'));
    const target = path.join(root, ledgerPath);
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(path.join(path.dirname(target), 'historical.json'), '{');
      assert.deepEqual(validateLocalRunLedgerChanges({ changedFiles: [], repositoryRoot: root }), []);
      assert.ok(validateLocalRunLedgerChanges({ changedFiles: [ledgerPath], repositoryRoot: root }).length);
      writeFileSync(target, JSON.stringify(makeRun()));
      assert.deepEqual(validateLocalRunLedgerChanges({ changedFiles: [ledgerPath], repositoryRoot: root }), []);
      writeFileSync(target, '{');
      assert.ok(validateLocalRunLedgerChanges({ changedFiles: [ledgerPath], repositoryRoot: root }).length);
      rmSync(target);
      const other = path.join(root, 'other.json');
      writeFileSync(other, JSON.stringify(makeRun()));
      symlinkSync(other, target);
      assert.ok(validateLocalRunLedgerChanges({ changedFiles: [ledgerPath], repositoryRoot: root }).length);
      assert.ok(validateLocalRunLedgerChanges({ changedFiles: null, repositoryRoot: root }).length);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('reads the immutable GitHub blob from complete exact-head inventory', async () => {
    const input = remote();
    assert.deepEqual(await validateGithubRunLedgerChanges(input), []);
    assert.deepEqual(input.requested, [{ owner: 'owner', repo: 'repo', file_sha: input.data.sha }]);
    const broken = makeRun();
    broken.delivery.issuesClosed = 1;
    assert.match((await validateGithubRunLedgerChanges(remote(JSON.stringify(broken)))).join('\n'), /ISSUE_CLOSED/);
  });

  it('rejects missing pages, duplicate file identity, missing head, removals and ledger renames', async () => {
    for (const mutate of [
      (r: ReturnType<typeof remote>) => { r.current.changed_files = 2; },
      (r: ReturnType<typeof remote>) => { r.current.changed_files = 2; r.changedFiles.push(r.changedFiles[0]); },
      (r: ReturnType<typeof remote>) => { r.current.head.sha = ''; },
      (r: ReturnType<typeof remote>) => { r.changedFiles[0].status = 'removed'; },
      (r: ReturnType<typeof remote>) => { r.changedFiles[0].sha = ''; },
    ]) {
      const input = remote(); mutate(input);
      assert.ok((await validateGithubRunLedgerChanges(input)).length);
      assert.equal(input.requested.length, 0);
    }
    const renamed = remote();
    Object.assign(renamed.changedFiles[0], { filename: 'docs/old.txt', previous_filename: ledgerPath, status: 'renamed' });
    assert.ok((await validateGithubRunLedgerChanges(renamed)).length);
  });

  it('does not convert unavailable, truncated or wrong-blob evidence to PASS', async () => {
    for (const mutate of [
      (r: ReturnType<typeof remote>) => { r.data.content = ''; },
      (r: ReturnType<typeof remote>) => { r.data.sha = 'b'.repeat(40); },
      (r: ReturnType<typeof remote>) => { r.data.size += 1; },
      (r: ReturnType<typeof remote>) => { r.data.encoding = 'none'; },
      (r: ReturnType<typeof remote>) => { r.github.rest.git.getBlob = async () => { throw new Error('unavailable'); }; },
    ]) {
      const input = remote(); mutate(input);
      assert.match((await validateGithubRunLedgerChanges(input)).join('\n'), /unavailable/);
    }
  });
});

const governanceBody = "<!-- pr-lifecycle\nissue: 538\nstate: ACTIVE\nsupersedes: none\n-->\n\nWORKSTREAM: MODEL_GOVERNANCE\nWORK_ORIGIN: AGENT\nAGENT_LANE: GOVERNANCE\nLANE_STATE: ACTIVE\nDELIVERY_UNIT_TYPE: GOVERNANCE\nPARENT_EPIC: none\nCOUNT_IN_DELIVERY_OUTCOME: false\nRETROACTIVE_TRACKING_MIGRATION: false\nUSER_VISIBLE_OUTCOME: none\nBPLUS_MODE: false\nRUN_ID: none\nSCORECARD_PATH: none\nACTIVE_CANDIDATE: false\nCLOSEABILITY_SCORE: 5\nSELECTION_REASON: GOVERNANCE\nREMAINING_AUTONOMOUS_STEPS: exact-head source CI, counterexample review, normal merge and main reread\nOWNER_OR_EXTERNAL_BLOCKER: none\nCLOSURE_SWEEP_TARGET: #538\nTEST_LANE_REQUIRED: false\nRESERVE_BOUNDARY: none\nWHY_NOT_CLOSER_CANDIDATE: none\nREQUESTED_MODEL / ACTUAL_MODEL: requested=not_requested; actual=unknown\nDUAL_TERRA_PILOT: false\nTERRA_SLOT: none\nTEST_PROFILE: SOURCE_ONLY\nTEST_ENV_ID: none\nFINAL_CANONICAL_REQUIRED: false\nGOVERNANCE_SCOPE_EXCEPTION: none\nASTRA_RISK: NONE\nFINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY\nASTRA_RATIONALE: Pure governance connects existing raw-capture validators to trusted required WIP and local preflight; no Product runtime, DB, authorization, model gates or WIP caps change.\nFILE_OWNERSHIP: scripts/agents/scorecard-required-gate.mjs, scripts/agents/agent-wip-preflight.mjs, .github/workflows/agent-wip-guard.yml, tests/unit/scorecard-required-gate.538.test.ts, docs/metrics/SCORECARD-LIVE-READINESS.md\n\n";

describe('#538 host entrypoint wiring', () => {
  it('runs raw validation through actual preflight without changing metadata-only compatibility', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'preflight-538-'));
    try {
      const target = path.join(root, ledgerPath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(makeRun()));
      const input = { body: governanceBody, repositoryRoot: root, changedFiles: [ledgerPath] };
      const valid = validateWipPreflight(input);
      assert.deepEqual(valid.errors, []);
      assert.equal(valid.rawCaptureChecked, true);
      const run = makeRun(); run.delivery.issuesClosed = 1;
      writeFileSync(target, JSON.stringify(run));
      const invalid = validateWipPreflight(input);
      assert.equal(invalid.valid, false);
      assert.match(invalid.errors.join('\\n'), /SCORECARD_CAPTURE_REJECTED/);
      const metadataOnly = validateWipPreflight({ body: governanceBody });
      assert.equal(metadataOnly.valid, true);
      assert.equal(metadataOnly.rawCaptureChecked, false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps capture failure separate from Product WIP exemption while blocking TEST and required status', () => {
    const workflow = readFileSync(path.resolve('.github/workflows/agent-wip-guard.yml'), 'utf8');
    const wiring = (source: string) => {
      assert.match(source, /const captureErrors = await capture\.validateGithubRunLedgerChanges\(\{\s*github, owner, repo, current, changedFiles: ownFiles,?\s*\}\)/);
      assert.match(source, /ownErrors: metadataErrors, completeInventory/);
      assert.doesNotMatch(source, /metadataErrors\.push\([^;]*captureErrors/);
      const dispatch = source.slice(source.indexOf('const shouldDispatchTest ='), source.indexOf('let dispatched ='));
      assert.ok(dispatch.includes('captureErrors.length === 0'));
      const gate = source.slice(source.indexOf('const errors = current.state'), source.indexOf('const fingerprint ='));
      assert.ok(gate.includes('...captureErrors'));
      assert.ok(gate.includes('hasErrors: errors.length > 0'));
      assert.ok(source.includes("ref: ${{ github.event.repository.default_branch }}"));
      assert.ok(source.includes("context: 'Agent WIP Policy'"));
      assert.ok(source.indexOf('fresh.head.sha !== current.head.sha') < source.lastIndexOf('state: policyStatus'));
    };
    wiring(workflow);
    for (const needle of ['captureErrors.length === 0', '...captureErrors', 'ownErrors: metadataErrors, completeInventory']) {
      assert.throws(() => wiring(workflow.replace(needle, 'REMOVED_BY_COUNTEREXAMPLE')));
    }
    assert.equal(shouldApplyProductGlobalWip({
      metadata: { origin: 'AGENT', state: 'ACTIVE', lane: 'GOVERNANCE' },
      classification: { workstream: 'MODEL_GOVERNANCE', isModelGovernance: true, errors: [] },
      ownErrors: [], completeInventory: true,
    }), false);
  });
});
