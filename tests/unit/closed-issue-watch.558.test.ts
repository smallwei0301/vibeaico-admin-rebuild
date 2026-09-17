import { describe, expect, it, vi } from 'vitest';
import { inspectClassification, observeClassifications } from '../../scripts/agents/workstream-classification-watch.mjs';

const now = new Date('2026-09-17T02:00:00Z');
const policySha = 'a'.repeat(40);
const label = 'workstream:model-governance';
const issue = (extra: Record<string, unknown> = {}): any => ({
  number: 558, state: 'closed', body: 'WORKSTREAM: MODEL_GOVERNANCE', labels: [label],
  created_at: '2026-09-15T00:00:00Z', updated_at: now.toISOString(), ...extra,
});
const pr = (extra: Record<string, unknown> = {}): any => issue({
  number: 559, head: { sha: 'b'.repeat(40) }, base: { sha: policySha }, changed_files: 1,
  body: 'WORKSTREAM: MODEL_GOVERNANCE\nAGENT_LANE: GOVERNANCE\nASTRA_RISK: NONE\nFINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
  ...extra,
});
const files = [{ filename: 'docs/metrics/example.md', status: 'modified' }];
function provider(options: { race?: boolean; unavailable?: boolean; truncated?: boolean; badDate?: boolean; old?: boolean; duplicate?: boolean } = {}) {
  let reads = 0;
  const request = vi.fn(async (route: string, params: any = {}) => {
    expect(route.startsWith('GET ')).toBe(true);
    const resource = route.split('/{repo}/')[1];
    if (resource === 'issues') {
      if (params.state === 'open') return { data: options.duplicate ? [issue({ state: 'open' })] : [] };
      expect(params.state).toBe('closed');
      expect(params.since).toBe('2026-09-14T02:00:00.000Z');
      if (options.unavailable) throw new Error('PRIVATE PROVIDER ERROR');
      if (options.truncated) return { data: Array.from({ length: 100 }, (_, i) => issue({ number: 600 + i })) };
      return { data: [issue({
        ...(options.badDate ? { updated_at: null } : {}),
        ...(options.old ? { updated_at: '2026-09-14T01:59:59Z' } : {}),
      }), { ...pr(), pull_request: {} }] };
    }
    if (resource === 'pulls') return { data: [pr()] };
    if (resource === 'issues/558') {
      reads++;
      return { data: issue({ labels: [label, ...(options.race && reads === 2 ? [] : ['state:active'])] }) };
    }
    if (resource === 'pulls/559') return { data: pr() };
    if (resource === 'pulls/559/files') return { data: files };
    throw new Error(`Unexpected route ${route}`);
  });
  return { request };
}
const observe = (github: any, maxPages = 20) => observeClassifications({ github, owner: 'test', repo: 'repo', now, policySha, maxPages });

describe('#558 closed Issue lifecycle observation', () => {
  it.each(['state:active', 'candidate:active', 'state:reserve-ready', 'state:ready-for-promotion'])('detects stale closed label %s without rewriting labels', name => {
    const item = issue({ labels: [label, name] }); const saved = JSON.stringify(item);
    expect(inspectClassification(item).errors).toContain(`CLOSED_ITEM_ACTIVE_LABEL:${name}`);
    expect(inspectClassification(pr({ labels: [label, name] }), files).status).toBe('FAIL');
    expect(JSON.stringify(item)).toBe(saved);
    expect(inspectClassification(issue({ state: 'open', labels: [label, name] })).status).toBe('PASS');
  });
  it.each(['LANE_STATE: ACTIVE', 'LANE_STATE: READY_FOR_PROMOTION', 'ACTIVE_CANDIDATE: true'])('finds real stale declaration %s', line => {
    expect(inspectClassification(issue({ body: `WORKSTREAM: MODEL_GOVERNANCE\n${line}` })).errors.join(' ')).toMatch(/CLOSED_ITEM_ACTIVE_FIELD/);
  });
  it('does not turn quoted, fenced, indented or commented examples into current declarations', () => {
    const body = 'WORKSTREAM: MODEL_GOVERNANCE\nLANE_STATE: COMPLETE\nACTIVE_CANDIDATE: false\n'
      + '> LANE_STATE: ACTIVE\n```text\nACTIVE_CANDIDATE: true\n```\n'
      + '    LANE_STATE: ACTIVE\n<!-- ACTIVE_CANDIDATE: true -->\n';
    expect(inspectClassification(issue({ body })).status).toBe('PASS');
    expect(inspectClassification(issue({ labels: [label, 'state:complete', 'lane:governance'] })).status).toBe('PASS');
  });
  it('does not silently accept duplicate or malformed current lifecycle fields', () => {
    for (const tail of ['LANE_STATE: COMPLETE\nLANE_STATE: ACTIVE', 'ACTIVE_CANDIDATE: false\nACTIVE_CANDIDATE: true']) {
      expect(inspectClassification(issue({ body: `WORKSTREAM: MODEL_GOVERNANCE\n${tail}` })).errors.join(' ')).toContain('CLOSED_ITEM_AMBIGUOUS_FIELD');
    }
  });
  it('legacy classification does not hide a closed active lane', () => {
    const item = pr({ body: 'Historical work', created_at: '2026-08-01T00:00:00Z', labels: ['state:active'] });
    const result = inspectClassification(item, [{ filename: 'src/legacy.ts', status: 'modified' }]);
    expect(result.workstream).toBe('LEGACY_UNCLASSIFIED');
    expect(result.status).toBe('FAIL');
    expect(result.errors).toContain('CLOSED_ITEM_ACTIVE_LABEL:state:active');
  });
  it('actually inventories recent closed Issues, excludes duplicated PR rows, and preserves read-only behavior', async () => {
    const github = provider(); const report = await observe(github);
    expect(report.inventoryVersion).toBe(2);
    expect(report.issueScope).toBe('OPEN_AND_UPDATED_CLOSED_72H');
    expect(report.status).toBe('DRIFT_DETECTED');
    expect(report.counts).toEqual({ issues: 1, pullRequests: 1, checked: 2, legacy: 0 });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ number: 558, kind: 'ISSUE' });
    expect(report.findings[0].errors).toContain('CLOSED_ITEM_ACTIVE_LABEL:state:active');
    expect(github.request.mock.calls.filter(([r]) => r.endsWith('/pulls/559'))).toHaveLength(2);
  });
  it('a lifecycle-only label race is unavailable, not a stale successful snapshot', async () => {
    const report = await observe(provider({ race: true }));
    expect(report.status).toBe('EVIDENCE_UNAVAILABLE');
    expect(report.counts.checked).toBe(1);
    expect(report.unavailable).toContainEqual({ number: 558, kind: 'ISSUE', reason: 'EVIDENCE_UNAVAILABLE_INCOMPLETE_OR_CHANGED' });
    expect(report.findings).toHaveLength(0);
  });
  it.each([{ unavailable: true }, { truncated: true }, { badDate: true }])('failed closed inventory is unknown, not zero: %j', async options => {
    const report = await observe(provider(options), 1);
    expect(report.status).toBe('EVIDENCE_UNAVAILABLE');
    expect(report.counts.issues).toBeNull();
    expect(report.counts.pullRequests).toBe(1);
    expect(JSON.stringify(report)).not.toContain('PRIVATE PROVIDER ERROR');
  });
  it('only includes closed Issues updated inside the 72-hour window', async () => {
    const report = await observe(provider({ old: true }));
    expect(report.status).toBe('PASS');
    expect(report.counts).toEqual({ issues: 0, pullRequests: 1, checked: 1, legacy: 0 });
  });
  it('duplicate/moving inventory cannot be reported as a complete clean scan', async () => {
    const report = await observe(provider({ duplicate: true }));
    expect(report.status).toBe('EVIDENCE_UNAVAILABLE');
    expect(report.unavailable).toContainEqual({ reason: 'INVALID_OR_CHANGING_INVENTORY' });
  });
});
