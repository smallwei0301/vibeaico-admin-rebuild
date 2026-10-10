import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { decideTestValidation } from '../../scripts/agents/agent-wip-policy.mjs';

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const steps = workflow.jobs.integration.steps;
const find = (name: string) => steps.find((step: any) => step.name === name);
const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);
const inputs = { dispatch_reason: 'main_manual', expected_head: sha, base_revision: base, test_baseline_0098: true };
const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test', BASELINE_0098: 'true', RELEASE_ID: '', PLANNED_AT: '', RELEASE_SCOPE: 'FULL_PENDING_SET',
  DISPATCH_REASON: 'main_manual', EXPECTED_HEAD: sha, GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main',
  RUN_TEST_VALIDATION: 'true', TEST_LANE_HOLDERS: '' };
const contract = () => find('Validate optional Production DB G3 dispatch contract').run;
const validate = (change: Record<string, string | undefined> = {}) => execFileSync('bash', ['-c', contract()], {
  env: { ...environment, ...change }, stdio: ['ignore', 'pipe', 'pipe'],
});

describe('explicit canonical TEST 0098 workflow entry #755', () => {
  it('defaults off and preserves the existing shared TEST admission and concurrency', () => {
    expect(workflow.on.workflow_dispatch.inputs.test_baseline_0098).toMatchObject({ type: 'boolean', default: false, required: false });
    expect(workflow.jobs.integration.concurrency).toMatchObject({ 'cancel-in-progress': false });
    expect(workflow.jobs.integration.concurrency.group).toContain('shared-test-supabase-integration');
    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(find('Validate optional Production DB G3 dispatch contract').env.RUN_TEST_VALIDATION).toBe("${{ needs.classify-changes.outputs.run_test_validation }}");
    expect(find('Validate optional Production DB G3 dispatch contract').env.TEST_LANE_HOLDERS).toBe("${{ needs.classify-changes.outputs.test_lane_holders }}");
    expect(() => validate()).not.toThrow();
  });

  it.each([
    { GITHUB_REF: 'refs/heads/feature' }, { DISPATCH_REASON: 'lane_transition' },
    { EXPECTED_HEAD: 'c'.repeat(40) }, { RUN_TEST_VALIDATION: 'false' }, { TEST_LANE_HOLDERS: '727' },
    { RELEASE_ID: 'existing-original-eight' }, { PLANNED_AT: '2026-10-09T00:00:00Z' },
    { RELEASE_SCOPE: 'ISSUE_46_0110_0136_CLOSURE' }, { BASELINE_0098: 'yes' },
  ])('fails closed on invalid baseline dispatch boundaries %j', (change) => {
    expect(() => validate(change)).toThrow();
  });

  it('uses the current exact-main policy and cannot gain admission on a branch, PR event, or stale head', () => {
    const input = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha, inputs,
      currentCommit: { sha, parents: [{ sha: base }] }, openPullRequests: [], repoFullName: 'smallwei0301/vibeaico-admin-rebuild' };
    expect(decideTestValidation(input).runTestValidation).toBe(true);
    expect(decideTestValidation({ ...input, inputs: { ...inputs, expected_head: 'c'.repeat(40) } }).runTestValidation).toBe(false);
    expect(decideTestValidation({ ...input, ref: 'refs/heads/feature' }).runTestValidation).toBe(false);
    expect(decideTestValidation({ ...input, eventName: 'pull_request' }).runTestValidation).toBe(false);
    expect(decideTestValidation({ ...input, docsOnly: true }).runTestValidation).toBe(false);
  });

  it('only invokes the baseline on authenticated manual main, before integration, with existing TEST credential and CA', () => {
    const step = find('Apply explicit canonical TEST 0098 baseline');
    expect(step.if).toBe("${{ needs.classify-changes.outputs.run_test_validation == 'true' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.dispatch_reason == 'main_manual' && inputs.expected_head == github.sha && inputs.test_baseline_0098 == true && inputs.production_db_release_id == '' && inputs.production_db_planned_at == '' }}");
    expect(step.env.TEST_DB_RELEASE_TOKEN).toBe('${{ secrets.TEST_DB_RELEASE_TOKEN }}');
    expect(step.env.NODE_EXTRA_CA_CERTS).toBe('${{ github.workspace }}/config/supabase-production-root-bundle.crt');
    expect(step.run).toContain('test -n "$TEST_DB_RELEASE_TOKEN"');
    expect(step.run).toContain('test -s "$NODE_EXTRA_CA_CERTS"');
    expect(step.run).toContain('test-baseline-0098');
    expect(step.run).not.toMatch(/continue-on-error|\|\| true|production-db-release-plan/);
    expect(steps.indexOf(step)).toBeLessThan(steps.indexOf(find('Run integration tests')));
    expect(() => execFileSync('bash', ['-c', step.run], { env: { NODE_ENV: 'test', TEST_DB_RELEASE_TOKEN: '', NODE_EXTRA_CA_CERTS: '/missing' }, stdio: 'pipe' })).toThrow();
  });

  it('keeps the independent baseline artifact out of original-eight G3 evidence and preserves default-off release behavior', () => {
    const step = find('Upload canonical TEST 0098 baseline evidence');
    expect(step.if).toBe(find('Apply explicit canonical TEST 0098 baseline').if);
    expect(step.with).toMatchObject({ name: 'test-baseline-0098-evidence-${{ github.sha }}-${{ github.run_id }}',
      path: '${{ runner.temp }}/test-baseline-0098-evidence.json', 'if-no-files-found': 'error' });
    expect(find('Upload Production DB G3 trusted evidence bundle').with.path).not.toContain('test-baseline-0098');
    expect(find('Assemble final Production DB G3 TEST_VERIFIED evidence').run).not.toContain('test-baseline-0098');
    expect(() => validate({ BASELINE_0098: 'false', RELEASE_ID: 'original-eight', PLANNED_AT: '2026-10-09T00:00:00Z', RELEASE_SCOPE: 'ISSUE_46_0110_0136_CLOSURE' })).not.toThrow();
    expect(() => validate({ BASELINE_0098: '', GITHUB_REF: 'refs/heads/feature', DISPATCH_REASON: 'lane_transition' })).not.toThrow();
  });
});
