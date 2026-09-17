import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  boundaryPaths, shouldApplyProductGlobalWip, terminalLabelPlan,
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
async function runWorkflow(file: string, current = subject(), files: any[] = paths, peers: any[] = []) {
  vi.stubEnv('GITHUB_WORKSPACE', process.cwd());
  const failures: string[] = []; const statuses: any[] = []; const calls: string[] = [];
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
      pulls: { get: async () => ({ data: current }), listFiles, list },
      repos: { createCommitStatus: async (value: any) => { statuses.push(value); },
        getContent: async () => ({ data: { type: 'file' } }) },
      issues: { listComments, getLabel: async () => ({}),
        addLabels: async ({ labels: added }: any) => { calls.push('labels'); added.forEach((name: string) => labels.add(name)); },
        removeLabel: async ({ name }: any) => { calls.push('labels'); labels.delete(name); },
        createComment: async () => { calls.push('comment'); },
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
    payload: { action: 'opened', pull_request: current, repository: { default_branch: 'main' } },
    serverUrl: 'https://github.com', runId: 1 };
  const source = readFileSync(file, 'utf8').split('          script: |\n')[1];
  expect(source).toBeTruthy();
  const script = source.split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
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
  return { failures, statuses, calls, labels };
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
    it('keeps closed OWNER housekeeping ahead of validation and never rewrites historical statuses', async () => {
      const body = gov.replace('WORK_ORIGIN: AGENT', 'WORK_ORIGIN: OWNER')
        .replace('DELIVERY_UNIT_TYPE: GOVERNANCE', 'DELIVERY_UNIT_TYPE: STANDALONE');
      const current = { ...subject(body), state: 'closed', merged: true };
      const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', current);
      expect(result.statuses).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(result.calls.every(call => call === 'labels')).toBe(true);
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
  it('executes closed-event cleanup without a pending status, TEST or rewritten comments', async () => {
    const current = { ...subject(), state: 'closed', merged: true,
      labels: [{ name: 'state:active' }, { name: 'candidate:active' }, { name: 'unrelated:keep' }] };
    const result = await runWorkflow('.github/workflows/agent-wip-guard.yml', current);
    expect(result.statuses).toEqual([]);
    expect(result.calls.every(call => call === 'labels')).toBe(true);
    expect([...result.labels].sort()).toEqual(['state:complete', 'unrelated:keep']);
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
  it('executes classification workflow: pure bookkeeping incorrectly marked Product is rejected', async () => {
    const result = await runWorkflow('.github/workflows/agent-workstream-classification.yml', subject(product));
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.statuses.at(-1).state).toBe('failure');
    expect(result.labels.has('unrelated:keep')).toBe(true);
    const yaml = readFileSync('.github/workflows/agent-workstream-classification.yml', 'utf8');
    expect(yaml.split('sparse-checkout-cone-mode:')[0]).toContain('scripts/agents/governance-workstream-boundary.mjs');
  });
});
