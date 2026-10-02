import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import * as dualPolicy from '../../scripts/agents/dual-terra-wip-policy.mjs';
import * as alertPolicy from '../../scripts/agents/wip-alert-fingerprint.mjs';
import * as astraPolicy from '../../scripts/agents/astra-review-policy.mjs';
import * as boundaryPolicy from '../../scripts/agents/governance-workstream-boundary.mjs';
import * as capturePolicy from '../../scripts/agents/scorecard-required-gate.mjs';
import * as schemaStagePolicy from '../../scripts/agents/schema-staged-release-policy.mjs';
import { createRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyWorkstream } from '../../scripts/agents/astra-review-policy.mjs';
import { parseLaneMetadata } from '../../scripts/agents/agent-wip-policy.mjs';
import { validateDeliveryUnitBoundary as preflightBoundary } from '../../scripts/agents/agent-wip-preflight.mjs';
import { evaluateProductDeliveryTruth, formatProductDeliveryTruth } from '../../scripts/agents/completion-truth.mjs';
import {
  boundaryPaths, shouldApplyProductGlobalWip, terminalBodyPlan, terminalLabelPlan,
  validateBookkeepingWorkstream, validateDeliveryUnitBoundary,
} from '../../scripts/agents/governance-workstream-boundary.mjs';

const gov = `<!-- pr-lifecycle\nissue: 500\nstate: ACTIVE\nsupersedes:\n-->
WORK_ORIGIN: AGENT
WORKSTREAM: MODEL_GOVERNANCE
AGENT_LANE: GOVERNANCE
LANE_STATE: ACTIVE
ACTIVE_CANDIDATE: false
BPLUS_MODE: false
RUN_ID: none
SCORECARD_PATH: none
CLOSEABILITY_SCORE: 5
SELECTION_REASON: GOVERNANCE
REMAINING_AUTONOMOUS_STEPS: source CI and exact-diff verification
OWNER_OR_EXTERNAL_BLOCKER: none
CLOSURE_SWEEP_TARGET: #500
TEST_LANE_REQUIRED: false
RESERVE_BOUNDARY: none
WHY_NOT_CLOSER_CANDIDATE: none
REQUESTED_MODEL / ACTUAL_MODEL: requested=not_requested; actual=unknown
DELIVERY_UNIT_TYPE: GOVERNANCE
COUNT_IN_DELIVERY_OUTCOME: false
RETROACTIVE_TRACKING_MIGRATION: false
USER_VISIBLE_OUTCOME: none
ASTRA_RISK: NONE
ASTRA_RATIONALE: Bounded governance source only with regression tests
FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY
TEST_PROFILE: SOURCE_ONLY
FINAL_CANONICAL_REQUIRED: false
`;
const product = gov.replace('WORKSTREAM: MODEL_GOVERNANCE', 'WORKSTREAM: PRODUCT_MAINLINE')
  .replace('AGENT_LANE: GOVERNANCE', 'AGENT_LANE: TERRA_BUILD')
  .replace('ACTIVE_CANDIDATE: false', 'ACTIVE_CANDIDATE: true')
  .replace('BPLUS_MODE: false', 'BPLUS_MODE: true')
  .replace('RUN_ID: none', 'RUN_ID: 2026-09-15-product-delivery-r01')
  .replace('SCORECARD_PATH: none', 'SCORECARD_PATH: docs/metrics/agent-runs/2026-09-15-product-delivery-r01.json')
  .replace('DELIVERY_UNIT_TYPE: GOVERNANCE', 'DELIVERY_UNIT_TYPE: STANDALONE')
  .replace('COUNT_IN_DELIVERY_OUTCOME: false', 'COUNT_IN_DELIVERY_OUTCOME: true')
  .replace('USER_VISIBLE_OUTCOME: none', 'USER_VISIBLE_OUTCOME: Real promotion statistics')
  + 'PRODUCTION_SCHEMA_STATUS: NOT_APPLIED\nAUTHENTICATED_PRODUCTION_ACCEPTANCE: NOT_RUN\n';
const created_at = '2026-09-15T12:00:00Z';
const paths = ['docs/metrics/example.md'];
function subject(body = gov): any {
  return { number: 900, state: 'open', draft: true, body, created_at, changed_files: 1,
    head: { sha: 'a'.repeat(40), ref: 'governance/example', repo: { full_name: 'owner/repo' } },
    base: { sha: 'b'.repeat(40) }, labels: [{ name: 'unrelated:keep' }] };
}
function truth(body: string, changedFiles: any[] = ['supabase/migrations/0113_test.sql']) {
  return evaluateProductDeliveryTruth({ pullRequest: { ...subject(body), state: 'closed', merged: true,
    merged_at: created_at, merge_commit_sha: 'c'.repeat(40) }, defaultBranchHead: 'd'.repeat(40),
    compareStatus: 'ahead', changedFiles, sourceWorkflowRuns: [{ id: 1, name: 'ci',
      head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success' }],
    commitStatuses: [{ context: 'Vercel', state: 'success', description: 'Deployment has completed' }] });
}

// Execute the actual trusted workflow script with real policy modules and fake GitHub I/O.
// Vitest's VM cannot dynamically import from AsyncFunction. Replace module loading only,
// not policy behavior: each exact trusted file URL resolves to its real static import.
async function runWorkflow(file: string, current = subject(), files: any[] = paths, peers: any[] = [], job = 'guard') {
  vi.stubEnv('GITHUB_WORKSPACE', process.cwd());
  const failures: string[] = []; const statuses: any[] = []; const calls: string[] = []; const comments: string[] = [];
  const labels = new Set<string>(current.labels.map((label: any) => label.name));
  const listFiles = vi.fn(); const list = vi.fn(); const listComments = vi.fn();
  const summary: any = {};
  for (const name of ['addHeading', 'addRaw', 'addTable', 'write']) summary[name] = () => summary;
  const github: any = {
    rest: {
      git: { getBlob: async ({ file_sha }: any) => {
        const file = files.find(item => item.sha === file_sha && typeof item.content === 'string');
        if (!file) throw new Error('Missing fixture blob');
        return { data: { sha: file_sha, encoding: 'base64', size: Buffer.byteLength(file.content),
          content: Buffer.from(file.content).toString('base64') } };
      } },
      pulls: {
        get: async () => ({ data: current }),
        update: async ({ body }: any) => { calls.push('body'); current.body = body; return { data: current }; },
        listFiles, list,
      },
      repos: { createCommitStatus: async (value: any) => { statuses.push(value); },
        getContent: async () => ({ data: { type: 'file' } }) },
      issues: { listComments, getLabel: async () => ({}),
        addLabels: async ({ labels: added }: any) => { calls.push('labels'); added.forEach((name: string) => labels.add(name)); },
        removeLabel: async ({ name }: any) => { calls.push('labels'); labels.delete(name); },
        createComment: async ({ body }: any) => { calls.push('comment'); comments.push(body); },
        updateComment: async () => { calls.push('comment'); },
        setLabels: async () => { throw new Error('Whole-label replacement is forbidden'); } },
      actions: { createWorkflowDispatch: async () => { calls.push('dispatch'); } },
    },
    paginate: async (method: any, args: any) => {
      if (method === list) { calls.push('product-peers'); return peers; }
      if (method === listComments) return [];
      if (method === listFiles) return args.pull_number === current.number
        ? files.map(file => typeof file === 'string' ? { filename: file } : file)
        : [{ filename: 'src/app/page.tsx' }];
      throw new Error('Unexpected GitHub request');
    },
  };
  const context: any = { repo: { owner: 'owner', repo: 'repo' }, eventName: 'pull_request_target',
    payload: { action: job === 'terminal_cleanup' ? 'closed' : 'opened', pull_request: current, repository: { default_branch: 'main' } },
    serverUrl: 'https://github.com', runId: 1 };
  const jobName = file.endsWith('agent-workstream-classification.yml') ? 'classify' : job;
  const script = parse(readFileSync(file, 'utf8')).jobs[jobName].steps.find((step: any) => step.with?.script)?.with.script;
  expect(script).toBeTruthy();
  const modules = new Map<string, unknown>([
    ['dual-terra-wip-policy.mjs', dualPolicy],
    ['wip-alert-fingerprint.mjs', alertPolicy],
    ['astra-review-policy.mjs', astraPolicy],
    ['governance-workstream-boundary.mjs', boundaryPolicy],
    ['scorecard-required-gate.mjs', capturePolicy],
    ['schema-staged-release-policy.mjs', schemaStagePolicy],
  ].map(([name, module]) => [pathToFileURL(resolve(process.cwd(), 'scripts/agents', String(name))).href, module]));
  const loadPolicy = async (specifier: string) => {
    if (!modules.has(specifier)) throw new Error(`Unexpected policy module: ${specifier}`);
    return modules.get(specifier);
  };
  const executable = script.replace(/\bimport\s*\(/g, 'loadPolicy(');
  expect(executable).not.toMatch(/\bimport\s*\(/);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', executable)(
    createRequire(import.meta.url), process, github, context,
    { summary, setFailed: (message: string) => failures.push(message), warning: () => {} }, loadPolicy);
  return { failures, statuses, calls, labels, comments };
}
afterEach(() => vi.unstubAllEnvs());

describe('governance boundary regression #500', () => {
  describe('delivery applicability regression #555', () => {
    it('shares the post-merge applicability and preserves undeclared historical records', () => {
      const applies = boundaryPolicy.shouldValidateDeliveryUnitBoundary;
      expect(applies('', { policyApplies: false })).toBe(false);
      expect(applies('', { policyApplies: true })).toBe(true);
      expect(applies(gov, { policyApplies: false })).toBe(true);
      const completion = readFileSync('scripts/agents/completion-truth.mjs', 'utf8');
      expect(completion).toContain('if (shouldValidateDeliveryUnitBoundary(body, classification))');
    });
    it.each(['OWNER', 'UNKNOWN', 'AGENT'])('rejects the #553 contradiction before merge for %s origin', async (origin) => {
      const body = gov.replace('WORK_ORIGIN: AGENT', `WORK_ORIGIN: ${origin}`)
        .replace('DELIVERY_UNIT_TYPE: GOVERNANCE', 'DELIVERY_UNIT_TYPE: STANDALONE');
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(body));
      expect(result.statuses.at(-1).state).toBe('failure');
      expect(result.failures.join('\n')).toContain('AGENT_LANE=GOVERNANCE must use DELIVERY_UNIT_TYPE=GOVERNANCE');
      expect(truth(body, paths).metadataErrors).toContain('AGENT_LANE=GOVERNANCE must use DELIVERY_UNIT_TYPE=GOVERNANCE');
      expect(result.calls).not.toContain('dispatch');
    });
    it.each(['OWNER', 'AGENT'])('retains valid pure governance without Product WIP for %s', async (origin) => {
      const body = gov.replace('WORK_ORIGIN: AGENT', `WORK_ORIGIN: ${origin}`);
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(body));
      expect(result.failures).toEqual([]);
      expect(result.calls).not.toContain('product-peers');
      expect(result.calls).not.toContain('dispatch');
      expect(result.statuses.at(-1).state).toBe('pending'); // Draft is not approval.
    });
    it.each(['OWNER', 'UNKNOWN'])('rejects Product count=false for %s without inventing shipment', async (origin) => {
      const body = product.replace('WORK_ORIGIN: AGENT', `WORK_ORIGIN: ${origin}`)
        .replace('COUNT_IN_DELIVERY_OUTCOME: true', 'COUNT_IN_DELIVERY_OUTCOME: false');
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(body), ['src/app/page.tsx']);
      expect(result.failures.join('\n')).toContain('STANDALONE must set COUNT_IN_DELIVERY_OUTCOME=true');
      expect(result.statuses.at(-1).state).toBe('failure');
      expect(truth(body).productionAccepted).toBe(false);
    });
    it.each(['PARKED', 'COMPLETE'])('does not skip declared delivery metadata for open %s OWNER PRs', async (state) => {
      const body = gov.replace('WORK_ORIGIN: AGENT', 'WORK_ORIGIN: OWNER')
        .replace('LANE_STATE: ACTIVE', `LANE_STATE: ${state}`)
        .replace('DELIVERY_UNIT_TYPE: GOVERNANCE', 'DELIVERY_UNIT_TYPE: STANDALONE');
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(body));
      expect(result.failures.join('\n')).toContain('AGENT_LANE=GOVERNANCE must use DELIVERY_UNIT_TYPE=GOVERNANCE');
    });
    it('keeps closed OWNER housekeeping ahead of validation without replacing the PR body', async () => {
      const body = gov.replace('WORK_ORIGIN: AGENT', 'WORK_ORIGIN: OWNER')
        .replace('DELIVERY_UNIT_TYPE: GOVERNANCE', 'DELIVERY_UNIT_TYPE: STANDALONE');
      const current = { ...subject(body), state: 'closed', merged: true };
      const guard = await runWorkflow('.github/workflows/agent-wip-guard.yml', current);
      expect(guard.statuses).toEqual([]); expect(guard.calls).toEqual([]);
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', current, paths, [], 'terminal_cleanup');
      expect(result.statuses).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(result.calls).not.toContain('body');
      expect(current.body).toContain('LANE_STATE: ACTIVE');
      expect(current.body).toContain('ACTIVE_CANDIDATE: false');
      expect(result.calls).not.toContain('dispatch');
      expect(result.calls).toContain('comment'); // Durable STATE_SYNC_PENDING handoff.
    });
  });

  it('uses the identical delivery validator in preflight and the remote contract', () => {
    expect(preflightBoundary).toBe(validateDeliveryUnitBoundary);
  });
  it('classifies pure bookkeeping by this diff, not the recorded Product Run', () => {
    expect(validateBookkeepingWorkstream({ body: product, changedFiles: paths })).toHaveLength(1);
    expect(validateBookkeepingWorkstream({ body: gov, changedFiles: paths })).toEqual([]);
    expect(validateBookkeepingWorkstream({ body: product, changedFiles: [...paths, 'src/server/feature.ts'] })).toEqual([]);
    expect(boundaryPaths([{ filename: paths[0], previous_filename: 'src/server/feature.ts' }])).toContain('src/server/feature.ts');
  });
  it('requires own complete classification and metadata before any WIP exemption', () => {
    const metadata = parseLaneMetadata(subject());
    const classification = classifyWorkstream({ body: gov, changedFiles: paths, createdAt: created_at });
    const input = { metadata, classification, completeInventory: true, ownErrors: [] };
    expect(shouldApplyProductGlobalWip(input)).toBe(false);
    expect(shouldApplyProductGlobalWip({ ...input, completeInventory: false })).toBe(true);
    expect(shouldApplyProductGlobalWip({ ...input, ownErrors: ['missing scope'] })).toBe(true);
    expect(shouldApplyProductGlobalWip({ ...input, classification: { ...classification, errors: ['runtime file'] } })).toBe(true);
  });
  it('does not turn Product count=false into governance or bypass migration acceptance', () => {
    const result = truth(product.replace('COUNT_IN_DELIVERY_OUTCOME: true', 'COUNT_IN_DELIVERY_OUTCOME: false'));
    expect(result.metadataErrors).toContain('STANDALONE must set COUNT_IN_DELIVERY_OUTCOME=true');
    expect(result.schema.state).toBe('NOT_APPLIED');
    expect(result.acceptance.state).toBe('NOT_RUN');
    expect(result.productionAccepted).toBe(false);
    expect(formatProductDeliveryTruth(result)).toContain('STATUS: DELIVERY_METADATA_INVALID');
  });
  it('does not count an eligible merged and deployed Product as accepted', () => {
    const result = truth(product);
    expect(result.deliveryEligible).toBe(true);
    expect(result.productionAccepted).toBe(false);
    expect(formatProductDeliveryTruth(result)).toContain('STATUS: PRODUCTION_PENDING');
  });
  it('reserves NON_PRODUCT_GOVERNANCE for validated pure governance', () => {
    expect(formatProductDeliveryTruth(truth(gov, paths))).toContain('STATUS: NON_PRODUCT_GOVERNANCE');
    const spoof = truth(gov);
    expect(spoof.isModelGovernance).toBe(false);
    expect(spoof.schema.state).not.toBe('NOT_APPLICABLE');
    expect(formatProductDeliveryTruth(spoof)).toContain('STATUS: DELIVERY_METADATA_INVALID');
  });
  it('rejects conflicting count declarations using the real shared parser', () => {
    const result = truth(product + 'COUNT_IN_DELIVERY_OUTCOME: false\n');
    expect(result.metadataErrors.length).toBeGreaterThan(0);
    expect(result.productionAccepted).toBe(false);
  });
  it('keeps terminal lane state distinct from Product acceptance', () => {
    expect(terminalLabelPlan(subject())).toBeNull();
    expect(terminalLabelPlan({ state: 'closed', merged: true })?.add).toBe('state:complete');
    expect(terminalLabelPlan({ state: 'closed', merged: false })?.add).toBe('state:historical');
    expect(terminalLabelPlan({ state: 'closed', merged: true })?.remove).toEqual(expect.arrayContaining(['governance:lane-metadata-incomplete', 'governance:wip-violation']));
    expect(terminalLabelPlan({ state: 'closed', merged: false })?.remove).not.toContain('governance:lane-metadata-incomplete');
    expect(terminalLabelPlan({ state: 'closed', merged: false })?.remove).not.toContain('governance:wip-violation');
  });
  it('executes the real guard: malformed Product peers cannot block valid governance', async () => {
    const peers = Array.from({ length: 4 }, (_, index) => ({ ...subject(product), number: index + 1, draft: false }));
    const clean = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(), paths, peers);
    expect(clean.failures).toEqual([]);
    expect(clean.calls).not.toContain('product-peers');
    expect(clean.labels.has('unrelated:keep')).toBe(true);
    const blocked = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(product), ['src/app/page.tsx'], peers);
    expect(blocked.calls).toContain('product-peers');
    expect(blocked.failures.length).toBeGreaterThan(0);
  });
  it('executes the real guard: renamed Product scope cannot use governance exemption', async () => {
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(),
      [{ filename: paths[0], previous_filename: 'src/server/payment.ts' }]);
    expect(result.failures.length).toBeGreaterThan(0);
  });
  it('executes closed-event cleanup without a pending status or TEST and leaves a sync handoff', async () => {
    const current = { ...subject(), state: 'closed', merged: true,
      labels: [{ name: 'state:active' }, { name: 'candidate:active' }, { name: 'unrelated:keep' }] };
    const guard = await runWorkflow('.github/workflows/agent-wip-guard.yml', current);
    expect(guard.statuses).toEqual([]); expect(guard.calls).toEqual([]);
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', current, paths, [], 'terminal_cleanup');
    expect(result.statuses).toEqual([]);
    expect(result.calls).not.toContain('body');
    expect(result.calls.filter(call => call === 'labels').length).toBeGreaterThan(0);
    expect(result.calls).not.toContain('dispatch');
    expect(result.calls).toContain('comment');
    expect(current.body).toContain('state: ACTIVE');
    expect(current.body).toContain('LANE_STATE: ACTIVE');
    expect([...result.labels].sort()).toEqual(['state:complete', 'unrelated:keep']);
  });
  it.each([[true, 'state:complete', false], [false, 'state:historical', true]])(
    'keeps warning labels only on unmerged closed PRs (merged=%s)', async (merged, stateLabel, keepWarnings) => {
      const current = { ...subject(), state: 'closed', merged, closed_at: created_at, labels: [{ name: 'governance:lane-metadata-incomplete' }, { name: 'governance:wip-violation' }] };
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', current, paths, [], 'terminal_cleanup');
      expect(result.labels.has(stateLabel)).toBe(true);
      for (const label of ['governance:lane-metadata-incomplete', 'governance:wip-violation']) expect(result.labels.has(label)).toBe(keepWarnings);
      expect(result.calls).not.toContain('body');
    });
  it('deduplicates only the trusted bot handoff for the same close generation', async () => {
    const initialBody = gov.replace('state: ACTIVE', 'state: HISTORICAL').replace('LANE_STATE: ACTIVE', 'LANE_STATE: HISTORICAL').replace('REMAINING_AUTONOMOUS_STEPS: source CI and exact-diff verification', 'REMAINING_AUTONOMOUS_STEPS: none') + '\nMERGE_STATUS: NOT_REQUESTED';
    const closed = { ...subject(initialBody), state: 'closed', merged: false, closed_at: '2026-10-02T07:00:00Z', labels: [{ name: 'state:active' }] };
    const marker = `<!-- agent-terminal-state-sync:v1 pr=900 head=${closed.head.sha} closed_at=${closed.closed_at} -->`;
    const comments: any[] = [{ user: { login: 'untrusted', id: 10 }, body: `${marker}\nSTATE_SYNC_PENDING` }];
    const listComments = vi.fn();
    const github: any = { rest: {
      pulls: { get: vi.fn(async () => ({ data: structuredClone(closed) })), update: vi.fn(() => { throw new Error('Body replacement forbidden'); }) },
      issues: { listComments, removeLabel: vi.fn(async ({ name }: any) => { closed.labels = closed.labels.filter((label: { name: string }) => label.name !== name); }),
        getLabel: vi.fn(async () => ({})), addLabels: vi.fn(async ({ labels }: any) => { closed.labels.push(...labels.map((name: string) => ({ name }))); }), createComment: vi.fn(async ({ body }: any) => {
        comments.push({ user: { login: 'github-actions[bot]', id: 41898282 }, body });
      }) },
    }, paginate: vi.fn(async (method: any) => method === listComments ? comments : []) };
    const call = () => boundaryPolicy.reconcileTerminalPr({ github, owner: 'owner', repo: 'repo', current: structuredClone(closed) });
    await call();
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1); // A forged marker cannot suppress handoff.
    expect(comments.at(-1).body).toContain('UNSYNCED_FIELDS: MERGE_STATUS');
    await call();
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
    closed.body = closed.body.replace('OWNER_OR_EXTERNAL_BLOCKER: none', 'OWNER_OR_EXTERNAL_BLOCKER: old queue');
    await call();
    expect(comments.at(-1).body).toContain('UNSYNCED_FIELDS: MERGE_STATUS, OWNER_OR_EXTERNAL_BLOCKER');
    closed.body = closed.body.replace('MERGE_STATUS: NOT_REQUESTED', 'MERGE_STATUS: VERIFIED_NOT_MERGED')
      .replace('OWNER_OR_EXTERNAL_BLOCKER: old queue', 'OWNER_OR_EXTERNAL_BLOCKER: none');
    await call();
    expect(comments.at(-1).body).toContain('STATE_SYNC_RESOLVED');
    await call();
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(3);
    expect(github.rest.pulls.update).not.toHaveBeenCalled();
    closed.body = closed.body.replace('MERGE_STATUS: VERIFIED_NOT_MERGED', 'MERGE_STATUS: NOT_REQUESTED');
    const pendingBody = closed.body;
    github.paginate.mockImplementationOnce(async () => { closed.state = 'open'; closed.body = gov; return comments; });
    await call(); expect(github.rest.issues.createComment).toHaveBeenCalledTimes(3);
    expect(closed.labels.map((label: any) => label.name)).toContain('state:active');
    closed.state = 'closed'; closed.body = pendingBody; github.rest.issues.updateComment = vi.fn(async ({ body }: any) => { comments.at(-1).body = body; });
    github.rest.issues.createComment.mockImplementationOnce(async ({ body }: any) => { comments.push({ body, user: { login: 'github-actions[bot]', id: 41898282 } }); closed.state = 'open'; closed.body = gov; return { data: { id: 4, body } }; });
    await call(); expect(github.rest.issues.updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 4, body: expect.stringContaining('STATE_SYNC_SUPERSEDED') }));
    expect(closed.labels.map((label: any) => label.name)).toContain('state:active');
    closed.state = 'closed'; closed.body = pendingBody; await call(); expect(comments.at(-1).body).toContain('STATE_SYNC_PENDING');
    github.paginate.mockImplementationOnce(async () => { closed.state = 'open'; closed.body = gov; throw Error('inventory failed'); });
    await expect(call()).rejects.toThrow('inventory failed'); expect(closed.labels.map((label: any) => label.name)).toContain('state:active');
    closed.state = 'closed'; closed.body = pendingBody.replace('OWNER_OR_EXTERNAL_BLOCKER: none', 'OWNER_OR_EXTERNAL_BLOCKER: new queue');
    github.rest.issues.createComment.mockImplementationOnce(async ({ body }: any) => { comments.push({ id: 5, body, user: { login: 'github-actions[bot]', id: 41898282 } }); closed.state = 'open'; closed.body = gov; throw Error('create failed'); });
    await expect(call()).rejects.toThrow('create failed'); expect(closed.labels.map((label: any) => label.name)).toContain('state:active');
    expect(comments.at(-1).body).toContain('STATE_SYNC_SUPERSEDED');
    closed.state = 'closed'; closed.body = pendingBody.replace('OWNER_OR_EXTERNAL_BLOCKER: none', 'OWNER_OR_EXTERNAL_BLOCKER: third queue');
    github.rest.issues.createComment.mockImplementationOnce(async ({ body }: any) => { comments.push({ id: 6, body, user: { login: 'github-actions[bot]', id: 41898282 } }); closed.body = pendingBody; throw Error('create after body edit'); });
    await expect(call()).rejects.toThrow('create after body edit'); expect(comments.at(-1).body).toContain('STATE_SYNC_SUPERSEDED');
    closed.body = pendingBody; await call(); expect(comments.at(-1).body).toContain('STATE_SYNC_PENDING');
    closed.closed_at = '2026-10-02T08:00:00Z'; closed.body = pendingBody.replace('MERGE_STATUS: NOT_REQUESTED', 'MERGE_STATUS: VERIFIED_NOT_MERGED'); await call(); expect(comments.at(-1).body).toContain('STATE_SYNC_RESOLVED');
  });

  it('rewrites only live terminal declarations and preserves fenced examples', () => {
    const body = gov + '\n```text\nLANE_STATE: ACTIVE\nACTIVE_CANDIDATE: true\n```\n';
    const plan = terminalBodyPlan({ state: 'closed', merged: true, body });
    expect(plan?.errors).toEqual([]);
    expect(plan?.changed).toBe(true);
    expect(plan?.changedFields).toContain('pr-lifecycle.state');
    expect(plan?.body).toContain('state: MERGED');
    expect(plan?.body).toContain('LANE_STATE: COMPLETE');
    expect(plan?.body).toContain('\n```text\nLANE_STATE: ACTIVE\nACTIVE_CANDIDATE: true\n```');
  });

  it('marks closed-unmerged lifecycle metadata HISTORICAL', () => {
    const plan = terminalBodyPlan({ state: 'closed', merged: false, body: gov });
    expect(plan?.errors).toEqual([]);
    expect(plan?.body).toContain('state: HISTORICAL');
    expect(plan?.body).toContain('LANE_STATE: HISTORICAL');
    expect(plan?.body).toContain('ACTIVE_CANDIDATE: false');
  });

  it('fails safe when multiple current pr-lifecycle blocks exist', () => {
    const extra = '<!-- pr-lifecycle\nissue: 501\nstate: ACTIVE\nsupersedes: none\n-->';
    const plan = terminalBodyPlan({ state: 'closed', merged: true, body: gov + '\n' + extra });
    expect(plan?.errors.join(' ')).toContain('Ambiguous pr-lifecycle blocks');
  });

  it.each([
    ['pr-lifecycle.state', gov.replace(/<!-- pr-lifecycle[\s\S]*?-->\n/, '')], ['pr-lifecycle.state', '<!-- pr-lifecycle\nstate: ACTIVE\n'],
    ['LANE_STATE', gov.replace('LANE_STATE: ACTIVE\n', '')], ['LANE_STATE', 'WORK_ORIGIN: AGENT\nLANE_STATE: ACTIVE\n```text\nexample'],
    ['ACTIVE_CANDIDATE', gov + '\nACTIVE_CANDIDATE: false\n'],
  ])('names %s as an unsynced body field when its declaration is missing or ambiguous', (field, body) => {
    const plan = terminalBodyPlan({ state: 'closed', merged: true, body });
    expect(plan?.unsyncedFields).toContain(field);
    expect(plan?.errors.length).toBeGreaterThan(0);
  });
  it('puts failed and changed fields together in the actual STATE_SYNC_PENDING handoff', async () => {
    const closed = { ...subject(gov + '\nACTIVE_CANDIDATE: true\n'), state: 'closed', merged: true, closed_at: created_at, labels: [] as { name: string }[] };
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', closed, paths, [], 'terminal_cleanup');
    expect(result.comments).toEqual([expect.stringContaining('UNSYNCED_FIELDS: pr-lifecycle.state, LANE_STATE, ACTIVE_CANDIDATE')]);
  });
  it('lists other current-state fields for manual terminal closeout without rewriting them', async () => {
    const body = gov.replace('OWNER_OR_EXTERNAL_BLOCKER: none', 'OWNER_OR_EXTERNAL_BLOCKER: waiting on old TEST queue') +
      '\nMERGE_STATUS: NOT_REQUESTED\nCOMPLETION_CLAIM: IN_PROGRESS\n';
    const closed = { ...subject(body), state: 'closed', merged: true, closed_at: created_at, labels: [] };
    const plan = terminalBodyPlan(closed);
    expect(plan?.unsyncedFields).toEqual(expect.arrayContaining(['MERGE_STATUS', 'COMPLETION_CLAIM', 'OWNER_OR_EXTERNAL_BLOCKER', 'REMAINING_AUTONOMOUS_STEPS']));
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', closed, paths, [], 'terminal_cleanup');
    expect(result.comments[0]).toContain('MERGE_STATUS, COMPLETION_CLAIM');
    expect(result.calls).not.toContain('body');
  });
  it.each([[false, gov.replace('REMAINING_AUTONOMOUS_STEPS: source CI and exact-diff verification', 'REMAINING_AUTONOMOUS_STEPS: none') + '\nMERGE_STATUS: VERIFIED_NOT_MERGED\nCOMPLETION_CLAIM: VERIFIED_CLOSED'], [true, gov.replace('REMAINING_AUTONOMOUS_STEPS: source CI and exact-diff verification', 'REMAINING_AUTONOMOUS_STEPS: none') + '\n```text\nMERGE_STATUS: NOT_REQUESTED\nCOMPLETION_CLAIM: IN_PROGRESS']])('does not use fenced examples as merged receipts', (merged, body) => {
    const unsynced = terminalBodyPlan({ state: 'closed', merged, body })?.unsyncedFields;
    for (const field of ['MERGE_STATUS', 'COMPLETION_CLAIM']) expect(unsynced?.includes(field)).toBe(merged);
    for (const field of ['OWNER_OR_EXTERNAL_BLOCKER', 'REMAINING_AUTONOMOUS_STEPS']) expect(unsynced).not.toContain(field);
  });
  it.each([[false, 'VERIFIED_MERGED'], [true, 'VERIFIED_CLOSED'], [true, 'OWNER_BLOCKED']])('flags %s terminal PR with mismatched claim %s', (merged, claim) => {
    const body = gov.replace('state: ACTIVE', `state: ${merged ? 'MERGED' : 'HISTORICAL'}`).replace('LANE_STATE: ACTIVE', `LANE_STATE: ${merged ? 'COMPLETE' : 'HISTORICAL'}`).replace('REMAINING_AUTONOMOUS_STEPS: source CI and exact-diff verification', 'REMAINING_AUTONOMOUS_STEPS: none') + `\nMERGE_STATUS: ${merged ? 'VERIFIED_MERGED' : 'VERIFIED_NOT_MERGED'}\nCOMPLETION_CLAIM: ${claim}`;
    expect(terminalBodyPlan({ state: 'closed', merged, body })?.unsyncedFields).toContain('COMPLETION_CLAIM');
  });
  it('keeps merged Completion Truth receipt gaps in the pending handoff', async () => {
    const body = gov.replace('state: ACTIVE', 'state: MERGED').replace('LANE_STATE: ACTIVE', 'LANE_STATE: COMPLETE')
      .replace('REMAINING_AUTONOMOUS_STEPS: source CI and exact-diff verification', 'REMAINING_AUTONOMOUS_STEPS: none') +
      '\nMERGE_STATUS: VERIFIED_MERGED\nCOMPLETION_CLAIM: VERIFIED_MERGED\nMERGE_COMMIT_SHA: none\nMAIN_HEAD_VERIFIED: false\nMAIN_HEAD_SHA: none\nMAIN_FILE_RE_READ: none\nVERIFIED_AT: none\nEXACT_HEAD_CI_STATUS: NOT_RUN\nEXACT_HEAD_CI_RUN: none\nLOCAL_JOB_RESULT: NOT_RUN\nREMOTE_JOB_RESULT: NOT_RUN';
    const closed = { ...subject(body), state: 'closed', merged: true, closed_at: created_at, labels: [] };
    const fields = ['MERGE_COMMIT_SHA', 'MAIN_HEAD_VERIFIED', 'MAIN_HEAD_SHA', 'MAIN_FILE_RE_READ', 'VERIFIED_AT', 'EXACT_HEAD_CI_STATUS', 'EXACT_HEAD_CI_RUN', 'LOCAL_JOB_RESULT', 'REMOTE_JOB_RESULT'];
    expect(terminalBodyPlan(closed)?.unsyncedFields).toEqual(fields);
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', closed, paths, [], 'terminal_cleanup');
    expect(result.comments[0]).toContain(`UNSYNCED_FIELDS: ${fields.join(', ')}`);
    expect(result.calls).not.toContain('body');
    const receipts = { MERGE_COMMIT_SHA: 'a'.repeat(40), MAIN_HEAD_VERIFIED: 'true', MAIN_HEAD_SHA: 'b'.repeat(40),
      MAIN_FILE_RE_READ: 'docs/AGENT-EXECUTION.md', VERIFIED_AT: created_at, EXACT_HEAD_CI_STATUS: 'VERIFIED_GREEN', EXACT_HEAD_CI_RUN: 'https://github.com/owner/repo/actions/runs/1', LOCAL_JOB_RESULT: 'SKIPPED', REMOTE_JOB_RESULT: 'SKIPPED' };
    const verified = Object.entries(receipts).reduce((text, [field, value]) => text.replace(new RegExp(`${field}: [^\\n]*`), `${field}: ${value}`), body);
    expect(terminalBodyPlan({ ...closed, body: verified, merge_commit_sha: 'a'.repeat(40) })?.unsyncedFields).toEqual([]);
    expect(terminalBodyPlan({ ...closed, body: verified, merge_commit_sha: 'c'.repeat(40) })?.unsyncedFields).toContain('MERGE_COMMIT_SHA');
    const live = { ...closed, body: verified, merge_commit_sha: 'a'.repeat(40), base: { ref: 'main' } };
    const comments: any[] = [{ body: `<!-- agent-terminal-state-sync:v1 pr=900 head=${live.head.sha} closed_at=${live.closed_at} digest=old -->\nSTATE_SYNC_PENDING`, user: { login: 'github-actions[bot]', id: 41898282 } }];
    const github: any = { rest: { pulls: { get: vi.fn(async () => ({ data: structuredClone(live) })) },
      issues: { listComments: vi.fn(), removeLabel: vi.fn(), getLabel: vi.fn(async () => ({})), addLabels: vi.fn(), createComment: vi.fn(async ({ body }: any) => { comments.push({ body, user: { login: 'github-actions[bot]', id: 41898282 } }); return { data: { id: comments.length } }; }) },
      repos: { getBranch: vi.fn(async () => ({ data: { commit: { sha: 'c'.repeat(40) } } })), compareCommitsWithBasehead: vi.fn(async () => ({ data: { status: 'ahead' } })), getContent: vi.fn(async () => ({ data: { type: 'file' } })) },
      actions: { listWorkflowRuns: vi.fn(async () => ({ data: { total_count: 1, workflow_runs: [{ id: 1, head_sha: live.head.sha, event: 'pull_request', path: '.github/workflows/ci.yml', pull_requests: [{ number: 900 }], created_at }] } })), getWorkflowRun: vi.fn(async () => ({ data: { head_sha: live.head.sha, status: 'completed', conclusion: 'success', event: 'pull_request', path: '.github/workflows/ci.yml', pull_requests: [{ number: 900 }] } })) },
    }, paginate: vi.fn(async () => comments) };
    const call = () => boundaryPolicy.reconcileTerminalPr({ github, owner: 'owner', repo: 'repo', current: live });
    await call(); expect(comments.at(-1).body).toContain('STATE_SYNC_RESOLVED');
    live.body = verified.replace('REMOTE_JOB_RESULT: SKIPPED', 'REMOTE_JOB_RESULT: VERIFIED_GREEN'); github.rest.actions.listJobsForWorkflowRun = vi.fn(async () => ({ data: { total_count: 1, jobs: [{ name: 'integration', status: 'completed', conclusion: 'success', steps: [{ name: 'Run integration tests', conclusion: 'skipped' }, { name: 'Run E2E tests', conclusion: 'skipped' }] }] } }));
    await call(); expect(comments.at(-1).body).toContain('remote integration/E2E steps not verified');
    github.rest.actions.listJobsForWorkflowRun.mockResolvedValue({ data: { total_count: 1, jobs: [{ name: 'integration', status: 'completed', conclusion: 'success', steps: [{ name: 'Run integration tests', conclusion: 'success' }, { name: 'Run E2E tests', conclusion: 'success' }] }] } }); await call(); expect(comments.at(-1).body).toContain('STATE_SYNC_RESOLVED'); live.body = verified;
    live.body = verified.replace(/^MERGE_COMMIT_SHA:.*\n/m, ''); await call(); expect(comments.at(-1).body).toContain('UNSYNCED_FIELDS: MERGE_COMMIT_SHA');
    live.body = verified.replace(/^(?:MERGE_STATUS|COMPLETION_CLAIM|MERGE_COMMIT_SHA|MAIN_HEAD_VERIFIED|MAIN_HEAD_SHA|MAIN_FILE_RE_READ|VERIFIED_AT|EXACT_HEAD_CI_STATUS|EXACT_HEAD_CI_RUN|LOCAL_JOB_RESULT|REMOTE_JOB_RESULT):.*\n?/gm, ''); await call(); expect(comments.at(-1).body).toContain('UNSYNCED_FIELDS: MERGE_STATUS, COMPLETION_CLAIM, MERGE_COMMIT_SHA');
    live.body = verified; expect(github.rest.repos.getContent).toHaveBeenCalledWith(expect.objectContaining({ ref: 'c'.repeat(40), path: 'docs/AGENT-EXECUTION.md' }));
    github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { status: 'diverged' } });
    await call(); expect(comments.at(-1).body).toContain('LIVE_MAIN_RECEIPT_UNVERIFIED');
    github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { status: 'ahead' } });
    github.rest.actions.listWorkflowRuns.mockResolvedValue({ data: { total_count: 2, workflow_runs: [{ id: 2, head_sha: live.head.sha, event: 'pull_request', path: '.github/workflows/ci.yml', pull_requests: [{ number: 900 }], run_started_at: '2026-10-02T08:00:00Z' }, { id: 1, head_sha: live.head.sha, event: 'pull_request', path: '.github/workflows/ci.yml', pull_requests: [{ number: 900 }], run_started_at: '2026-10-02T09:00:00Z' }] } });
    await call(); expect(comments.at(-1).body).toContain('receipt does not name latest exact-head CI run');
    const foreignInventory = { data: { total_count: 2, workflow_runs: [{ id: 2, head_sha: live.head.sha, event: 'pull_request', path: '.github/workflows/ci.yml', pull_requests: [{ number: 901 }] }, { id: 1, head_sha: live.head.sha, event: 'pull_request', path: '.github/workflows/ci.yml', pull_requests: [{ number: 900 }] }] } }; github.rest.actions.listWorkflowRuns.mockResolvedValue(foreignInventory); await call(); expect(comments.at(-1).body).toContain('STATE_SYNC_RESOLVED');
    github.rest.actions.listWorkflowRuns.mockResolvedValue({ data: { ...foreignInventory.data, workflow_runs: [{ ...foreignInventory.data.workflow_runs[0], pull_requests: [] }, foreignInventory.data.workflow_runs[1]] } }); await call(); expect(comments.at(-1).body).toContain('LIVE_MAIN_RECEIPT_UNVERIFIED'); github.rest.actions.listWorkflowRuns.mockResolvedValue(foreignInventory); github.rest.actions.getWorkflowRun.mockResolvedValue({ data: { head_sha: live.head.sha, status: 'completed', conclusion: 'success', event: 'pull_request', path: '.github/workflows/ci.yml', pull_requests: [{ number: 901 }, { number: 900 }] } }); await call(); expect(comments.at(-1).body).toContain('LIVE_MAIN_RECEIPT_UNVERIFIED');
    for (const field of ['MAIN_FILE_RE_READ', 'EXACT_HEAD_CI_RUN']) for (const placeholder of ['TBD', 'UNKNOWN', 'N/A', '-']) expect(terminalBodyPlan({ ...closed, body: verified.replace(new RegExp(`${field}: [^\\n]*`), `${field}: ${placeholder}`), merge_commit_sha: 'a'.repeat(40) })?.unsyncedFields).toContain(field);
  });
  it.each(['Historical prose only', 'Historical notes\n```text\nexample only',
    '```text\n<!-- pr-lifecycle\nstate: ACTIVE\n-->\n```'])('ignores prose and example-only lifecycle markers', body => {
    const plan = terminalBodyPlan({ state: 'closed', merged: true, body });
    expect(plan?.body).toBe(body);
    expect(plan?.errors).toEqual([]);
    expect(plan?.unsyncedFields).toEqual([]);
  });
  it.each(['\n', '\r'])('recognizes current-state fields after a same-line HTML comment close', newline => {
    const body = ['<!-- explanatory note', '-->LANE_STATE: ACTIVE', '<!-- explanatory note', '-->ACTIVE_CANDIDATE: true'].join(newline);
    const plan = terminalBodyPlan({ state: 'closed', merged: true, body });
    expect(plan?.unsyncedFields).toEqual(expect.arrayContaining(['pr-lifecycle.state', 'LANE_STATE', 'ACTIVE_CANDIDATE']));
  });
  it('fails safe on ambiguous terminal metadata instead of partially rewriting the PR body', async () => {
    const body = gov + '\nACTIVE_CANDIDATE: true\n';
    const plan = terminalBodyPlan({ state: 'closed', merged: true, body });
    expect(plan?.errors.length).toBeGreaterThan(0);
    const current = { ...subject(body), state: 'closed', merged: true };
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', current);
    expect(result.calls).not.toContain('body');
    expect(current.body).toBe(body);
  });
  it('executes the real raw-capture policy: bad ledger fails required status without borrowing Product WIP', async () => {
    const run = createRunLedgerV2('2026-09-16-synthetic-538', created_at,
      { closeoutOwner: 'PRODUCT_MAIN_SESSION' }) as unknown as { delivery: Record<string, unknown> };
    for (const closedCount of [0, 1]) {
      const content = JSON.stringify({ ...run, delivery: { ...run.delivery, issuesClosed: closedCount } });
      const sha = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
      const file = { filename: 'docs/metrics/agent-runs/2026-09-16-synthetic-538.json', status: 'modified', sha, content };
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(), [file]);
      expect(result.calls).not.toContain('product-peers');
      expect(result.calls).not.toContain('dispatch');
      expect(result.statuses.at(-1).state).toBe(closedCount ? 'failure' : 'pending');
      if (closedCount) expect(result.failures.join('\n')).toContain('SCORECARD_CAPTURE_REJECTED');
      else expect(result.failures).toEqual([]);
    }
  });
  it.each(['OWNER', 'AGENT', 'UNKNOWN'])('requires Product Run binding for %s even without a changed ledger', async (origin) => {
    const body = product.replace('WORK_ORIGIN: AGENT', `WORK_ORIGIN: ${origin}`)
      .replace('RUN_ID: 2026-09-15-product-delivery-r01', 'RUN_ID: none');
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', subject(body), ['src/app/page.tsx']);
    expect(result.failures.join('\n')).toContain('PRODUCT_RUN_BINDING_REJECTED');
    expect(result.statuses.at(-1).state).toBe('failure');
    expect(result.calls).not.toContain('dispatch');
  });
  it('executes classification workflow: pure bookkeeping incorrectly marked Product is rejected', async () => {
    const result = await runWorkflow('.github/workflows/agent-workstream-classification.yml', subject(product));
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.statuses.at(-1).state).toBe('failure');
    expect(result.labels.has('unrelated:keep')).toBe(true);
    const yaml = readFileSync('.github/workflows/agent-workstream-classification.yml', 'utf8');
    expect(yaml.split('sparse-checkout-cone-mode:')[0]).toContain('scripts/agents/governance-workstream-boundary.mjs');
  });
});
