import { describe, expect, it } from 'vitest';
import {
  buildGovernanceObservation,
  classifyGovernancePr,
  renderGovernanceObservation,
} from '../../scripts/metrics/governance-observation.mjs';

const since = '2026-09-15T00:00:00Z';
const until = '2026-09-15T02:00:00Z';

function pr(overrides: Record<string, any> = {}): any {
  return {
    number: 1,
    state: 'open',
    body: 'WORKSTREAM: MODEL_GOVERNANCE\nLANE_STATE: ACTIVE',
    labels: [{ name: 'workstream:model-governance' }, { name: 'state:active' }],
    created_at: '2026-09-15T00:00:00Z',
    updated_at: '2026-09-15T01:00:00Z',
    merged_at: null,
    closed_at: null,
    changed_files: 2,
    additions: 20,
    deletions: 5,
    head: { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ...overrides,
  };
}

function run(name: string, conclusion: string, createdAt: string, headSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'): any {
  return { name, conclusion, status: 'completed', created_at: createdAt, head_sha: headSha };
}

function status(state: string, createdAt: string, context = 'Agent WIP Policy'): any {
  return { context, state, created_at: createdAt };
}

function observe(
  prs: any[],
  workflowRunsBySha: Record<string, any[]> = {},
  workflowUnavailableShas: string[] = [],
  statusHistoryBySha: Record<string, any[]> = {},
  statusUnavailableShas: string[] = [],
): any {
  return buildGovernanceObservation({
    repo: 'smallwei0301/vibeaico-admin-rebuild',
    since,
    until,
    generatedAt: '2026-09-15T02:01:00Z',
    prs,
    workflowRunsBySha,
    workflowUnavailableShas,
    statusHistoryBySha,
    statusUnavailableShas,
  });
}

describe('governance current observation (#466)', () => {
  it('includes body-governance PR even without label and reports mismatch', () => {
    const item = pr({ labels: [] });
    expect(classifyGovernancePr(item)).toMatchObject({ candidate: true, mismatch: true });

    const result = observe([item], { [item.head.sha]: [] });
    expect(result.counts.totalGovernancePrs).toBe(1);
    expect(result.counts.workstreamMismatches).toBe(1);
  });

  it('includes governance label with Product body and reports mismatch', () => {
    const item = pr({ body: 'WORKSTREAM: PRODUCT_MAINLINE\nLANE_STATE: PARKED', labels: [{ name: 'workstream:model-governance' }] });
    expect(classifyGovernancePr(item)).toMatchObject({ candidate: true, mismatch: true, bodyProduct: true });

    const result = observe([item], { [item.head.sha]: [] });
    expect(result.openInventory.parked).toBe(1);
    expect(result.counts.workstreamMismatches).toBe(1);
  });

  it('derives merged PR cycle-time median from timestamps', () => {
    const a = pr({
      number: 1,
      state: 'closed',
      merged_at: '2026-09-15T01:00:00Z',
      body: '<!-- pr-lifecycle\nstate: COMPLETE\n-->\nWORKSTREAM: MODEL_GOVERNANCE',
    });
    const b = pr({
      number: 2,
      state: 'closed',
      created_at: '2026-09-15T00:10:00Z',
      merged_at: '2026-09-15T00:40:00Z',
      head: { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      body: '<!-- pr-lifecycle\nstate: COMPLETE\n-->\nWORKSTREAM: MODEL_GOVERNANCE',
    });
    const result = observe([a, b], { [a.head.sha]: [], [b.head.sha]: [] });
    expect(result.cycleTime).toEqual({ mergedSampleCount: 2, medianMinutes: 45 });
  });

  it('counts same-final-head CI reruns but ignores runs from a different SHA', () => {
    const item = pr();
    const result = observe([item], {
      [item.head.sha]: [
        run('ci', 'failure', '2026-09-15T00:20:00Z'),
        run('ci', 'success', '2026-09-15T00:30:00Z'),
        run('ci', 'success', '2026-09-15T00:40:00Z', 'cccccccccccccccccccccccccccccccccccccccc'),
      ],
    });
    expect(result.ci.attempts).toBe(2);
    expect(result.ci.redundantSameHeadReruns).toBe(1);
    expect(result.ci.firstPass).toEqual({ numerator: 0, denominator: 1, percent: 0 });
  });

  it('derives first-pass numerator/denominator across PRs', () => {
    const a = pr();
    const b = pr({ number: 2, head: { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } });
    const result = observe([a, b], {
      [a.head.sha]: [run('ci', 'success', '2026-09-15T00:10:00Z')],
      [b.head.sha]: [
        run('ci', 'failure', '2026-09-15T00:10:00Z', b.head.sha),
        run('ci', 'success', '2026-09-15T00:20:00Z', b.head.sha),
      ],
    });
    expect(result.ci.firstPass).toEqual({ numerator: 1, denominator: 2, percent: 50 });
  });

  it('derives WIP failure→success from final-head commit status history', () => {
    const item = pr();
    const result = observe(
      [item],
      { [item.head.sha]: [run('ci', 'success', '2026-09-15T00:30:00Z')] },
      [],
      {
        [item.head.sha]: [
          status('failure', '2026-09-15T00:10:00Z'),
          status('success', '2026-09-15T00:20:00Z'),
        ],
      },
    );
    expect(result.ci.metadataGateRecoveryCount).toBe(1);
  });

  it('keeps WIP recovery unknown when status history is unavailable while preserving CI metrics', () => {
    const item = pr();
    const result = observe(
      [item],
      { [item.head.sha]: [run('ci', 'success', '2026-09-15T00:10:00Z')] },
      [],
      {},
      [item.head.sha],
    );

    expect(result.ci.attempts).toBe(1);
    expect(result.ci.firstPass).toEqual({ numerator: 1, denominator: 1, percent: 100 });
    expect(result.ci.metadataGateRecoveryCount).toBeNull();
    expect(result.unavailableMetrics).toContain('metadataGateRecoveryCount');
    expect(result.unavailableMetrics).not.toContain('firstPassCi');
  });

  it('reports scope-budget violations and stale active lifecycle', () => {
    const item = pr({
      state: 'closed',
      merged_at: '2026-09-15T01:00:00Z',
      changed_files: 9,
      additions: 900,
      body: '<!-- pr-lifecycle\nstate: ACTIVE\n-->\nWORKSTREAM: MODEL_GOVERNANCE\nMERGE_STATUS: NOT_REQUESTED',
    });
    const result = observe([item], { [item.head.sha]: [] });
    expect(result.counts.scopeBudgetViolations).toBe(1);
    expect(result.counts.staleLifecycle).toBe(1);
  });

  it.each([
    ['MERGE_STATUS: VERIFIED_MERGED', 'COMPLETION_CLAIM: VERIFIED_MERGED'],
    ['MERGE_STATUS: VERIFIED_MERGED', 'COMPLETION_CLAIM: VERIFIED_CLOSED'],
    ['MERGE_STATUS: MERGED', 'COMPLETION_CLAIM: VERIFIED_FIXED'],
  ])('accepts current terminal completion values without false stale count', (mergeLine, completionLine) => {
    const item = pr({
      state: 'closed',
      merged_at: '2026-09-15T01:00:00Z',
      body: `WORKSTREAM: MODEL_GOVERNANCE\n${mergeLine}\n${completionLine}`,
    });
    const result = observe([item], { [item.head.sha]: [] });
    expect(result.counts.staleLifecycle).toBe(0);
    expect(result.counts.lifecycleUnknown).toBe(0);
  });

  it('excludes governance PRs that do not touch the requested window', () => {
    const outside = pr({
      updated_at: '2026-09-14T22:00:00Z',
      merged_at: null,
      closed_at: null,
    });
    const inside = pr({
      number: 2,
      head: { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      updated_at: '2026-09-15T00:30:00Z',
    });
    const result = observe([outside, inside], { [inside.head.sha]: [] });
    expect(result.counts.totalGovernancePrs).toBe(1);
  });

  it('keeps workflow-derived CI metrics null when Actions history is unavailable while preserving status-derived facts', () => {
    const item = pr();
    const result = observe(
      [item],
      {},
      [item.head.sha],
      { [item.head.sha]: [status('success', '2026-09-15T00:10:00Z')] },
    );
    expect(result.counts.totalGovernancePrs).toBe(1);
    expect(result.openInventory.active).toBe(1);
    expect(result.ci).toEqual({
      attempts: null,
      redundantSameHeadReruns: null,
      firstPass: { numerator: null, denominator: null, percent: null },
      metadataGateRecoveryCount: 0,
    });
    expect(result.unavailableMetrics).toContain('firstPassCi');
    expect(result.unavailableMetrics).not.toContain('metadataGateRecoveryCount');
    expect(result.comparisonEligible).toBe(false);
  });

  it('renders current numeric facts even when comparison is not eligible', () => {
    const item = pr();
    const result = observe([item], {}, [item.head.sha], {}, [item.head.sha]);
    const markdown = renderGovernanceObservation(result);
    expect(markdown).toContain('Governance PRs: 1 total / 0 merged / 1 open');
    expect(markdown).toContain('Comparison eligible: **NO**');
    expect(markdown).toContain('firstPassCi');
    expect(markdown).not.toContain('/ 100');
  });
});
