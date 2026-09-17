import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueWorkstream, validateIssueProvenance } from '../../scripts/agents/issue-provenance-policy.mjs';
import { inspectClassification, observeClassifications } from '../../scripts/agents/workstream-classification-watch.mjs';

const GOV = 'MODEL_GOVERNANCE';
const PRODUCT = 'PRODUCT_MAINLINE';
const now = new Date('2026-09-16T00:00:00Z');
const policySha = 'a'.repeat(40);
const body = (stream = GOV) => `WORKSTREAM: ${stream}\nAGENT_LANE: ${stream === GOV ? 'GOVERNANCE' : 'TERRA_BUILD'}\nASTRA_RISK: NONE\nFINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY`;
const label = (stream = GOV) => stream === GOV ? 'workstream:model-governance' : 'workstream:product-mainline';
const issue = (overrides: Record<string, unknown> = {}) => ({
  number: 520, body: `WORKSTREAM: ${GOV}`, state: 'open', labels: [label()],
  created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z', ...overrides,
});
const pr = (overrides: Record<string, unknown> = {}) => ({
  ...issue(), number: 521, body: body(), head: { sha: 'b'.repeat(40) }, base: { sha: policySha },
  draft: false, changed_files: 1, ...overrides,
});
const files = (filename = 'docs/metrics/example.json') => [{ filename, status: 'modified' }];

afterEach(() => vi.unstubAllEnvs());

describe('Issue classification has one authority, not first-match wins (#520)', () => {
  it.each([`WORKSTREAM: ${GOV}`, `- WORKSTREAM: ${GOV}`, `## WORKSTREAM\n${GOV}`, `### WORKSTREAM\n${GOV}`])('accepts the existing form: %s', text => {
    expect(issueWorkstream(text)).toBe(GOV);
    expect(validateIssueProvenance(text, { requireWorkstream: true }).valid).toBe(true);
  });
  it.each([
    `WORKSTREAM: ${GOV}\nWORKSTREAM: ${PRODUCT}`,
    `WORKSTREAM: ${GOV}\nWORKSTREAM: ${GOV}`,
    `## WORKSTREAM\n${GOV}\n### WORKSTREAM\n${PRODUCT}`,
    `WORKSTREAM: ${PRODUCT}\n## WORKSTREAM\n${GOV}`,
    `WORKSTREAM:\n## WORKSTREAM\n${GOV}`,
  ])('rejects duplicate declarations including identical ones: %s', text => {
    expect(issueWorkstream(text)).toBe('AMBIGUOUS_WORKSTREAM');
    expect(validateIssueProvenance(text, { requireWorkstream: true }).errors.join(' ')).toContain('exactly one');
  });
  it.each(['', 'WORKSTREAM: anything', 'WORKSTREAM:\n## Summary\nnot a value'])('rejects missing or invalid declarations: %s', text => {
    expect(validateIssueProvenance(text, { requireWorkstream: true }).valid).toBe(false);
  });
  it('does not treat fenced or quoted examples as authority', () => {
    const example = `\n\`\`\`text\nWORKSTREAM: ${PRODUCT}\n\`\`\`\n> WORKSTREAM: ${PRODUCT}`;
    expect(issueWorkstream(`WORKSTREAM: ${GOV}${example}`)).toBe(GOV);
    expect(validateIssueProvenance(example, { requireWorkstream: true }).valid).toBe(false);
  });
});

describe('watcher reuses actual-file classification, not titles or parent Runs', () => {
  it('accepts pure governance with one matching label', () => {
    expect(inspectClassification(pr(), files()).status).toBe('PASS');
  });
  it.each(['docs/metrics/run.json', 'docs/schema-truth/report.md'])('catches Product-labelled bookkeeping: %s', filename => {
    const result = inspectClassification(pr({ body: body(PRODUCT), labels: [label(PRODUCT)] }), files(filename));
    expect(result.status).toBe('FAIL');
    expect(result.errors.join(' ')).toContain('Pure metrics/schema-truth');
  });
  it('does not turn mixed Product code + bookkeeping into governance', () => {
    const result = inspectClassification(pr({ body: body(PRODUCT), labels: [label(PRODUCT)], changed_files: 2 }),
      [...files(), ...files('src/server/orders.ts')]);
    expect(result.status).toBe('PASS');
  });
  it('rejects runtime disguised as governance even with matching governance labels', () => {
    expect(inspectClassification(pr(), files('src/server/orders.ts')).errors.join(' ')).toContain('Product/non-governance');
  });
  it('checks both rename endpoints', () => {
    const result = inspectClassification(pr(), [{ filename: 'docs/metrics/new.md', previous_filename: 'src/server/orders.ts', status: 'renamed' }]);
    expect(result.status).toBe('FAIL');
  });
  it.each([{ labels: [] }, { labels: [label(), label(PRODUCT)] }, { labels: [label(PRODUCT)] }])('detects missing, duplicate or conflicting labels: %j', ({ labels }) => {
    expect(inspectClassification(issue({ labels })).errors).toContain('WORKSTREAM_BODY_LABEL_MISMATCH');
  });
  it('rejects an ambiguous PR field through the existing classifier', () => {
    expect(inspectClassification(pr({ body: `${body()}\nWORKSTREAM: ${PRODUCT}` }), files()).status).toBe('FAIL');
  });
  it('keeps legacy unclassified PRs grandfathered', () => {
    const result = inspectClassification(pr({ body: 'Historical work', created_at: '2026-08-01T00:00:00Z', labels: [] }), files('src/legacy.ts'));
    expect(result.status).toBe('LEGACY_GRANDFATHERED');
  });
  it('does not grandfather new PRs missing classification', () => {
    expect(inspectClassification(pr({ body: 'New work', labels: [] }), files()).status).toBe('FAIL');
  });
  it.each([{ evidence: null }, { evidence: [] }, { evidence: [{ filename: 'docs/metrics/a', status: 'renamed' }] }])('missing or partial file evidence never proves governance: %j', ({ evidence }) => {
    if (Array.isArray(evidence) && evidence.length === 0) {
      expect(inspectClassification(pr({ changed_files: 0 }), evidence)).toMatchObject({
        status: 'PASS', contentEvidence: 'CONFIRMED_ZERO_CONTENT',
      });
      return;
    }
    expect(() => inspectClassification(pr(), evidence)).toThrow();
  });
  it('rejects duplicate file rows and path traversal', () => {
    expect(() => inspectClassification(pr({ changed_files: 2 }), [...files(), ...files()])).toThrow();
    expect(() => inspectClassification(pr(), files('docs/metrics/../../src/code.ts'))).toThrow();
  });
});

function provider(options: { mismatch?: boolean; unavailable?: boolean; stale?: boolean; truncated?: boolean; zeroContent?: boolean } = {}) {
  let reads = 0;
  const request = vi.fn(async (route: string, params: { state?: string } = {}) => {
    // The test rejects every mutation method; the collector must stay read-only.
    expect(route.startsWith('GET ')).toBe(true);
    const resource = route.split('/{repo}/')[1];
    if (resource === 'issues') {
      if (params.state === 'closed') return { data: [] };
      if (options.unavailable) throw new Error('do not leak this provider detail');
      return { data: [issue(), { ...pr(), pull_request: {} }] };
    }
    if (resource === 'pulls') return { data: options.truncated ? Array.from({ length: 100 }, (_, i) => pr({ number: 600 + i })) : [] };
    if (resource === 'issues/520') return { data: structuredClone(issue()) };
    if (resource === 'pulls/521/files') return { data: options.zeroContent ? [] : files() };
    if (resource === 'pulls/521') {
      reads += 1;
      return { data: structuredClone(pr({
        ...(options.zeroContent ? { changed_files: 0 } : {}),
        labels: options.mismatch ? [label(PRODUCT)] : [label()],
        ...(options.stale && reads > 1 ? { head: { sha: 'c'.repeat(40) } } : {}),
      })) };
    }
    throw new Error(`Unexpected API ${resource}`);
  });
  return { request };
}

describe('read-only patrol proves what it read and preserves unknown', () => {
  it('reports a complete matching inventory and GET-only calls', async () => {
    const result = await observeClassifications({ github: provider(), owner: 'test', repo: 'repo', now, policySha });
    expect(result.status).toBe('PASS');
    expect(result.counts).toEqual({ issues: 1, pullRequests: 1, checked: 2, legacy: 0 });
  });
  it('reports a concrete mismatch instead of changing labels', async () => {
    const result = await observeClassifications({ github: provider({ mismatch: true }), owner: 'test', repo: 'repo', now, policySha });
    expect(result.status).toBe('DRIFT_DETECTED');
    expect(result.findings[0].number).toBe(521);
  });
  it('treats a stable, fully paginated zero-file PR as confirmed zero content', async () => {
    const result = await observeClassifications({ github: provider({ zeroContent: true }), owner: 'test', repo: 'repo', now, policySha });
    expect(result.status).toBe('PASS');
    expect(result.unavailable).toEqual([]);
  });
  it.each([{ unavailable: true }, { stale: true }, { truncated: true }])('unavailable, racing or truncated evidence is not PASS: %j', options => {
    return observeClassifications({ github: provider(options), owner: 'test', repo: 'repo', now, policySha, maxPages: 1 }).then(result => {
      expect(result.status).toBe('EVIDENCE_UNAVAILABLE');
      expect(result.unavailable.length).toBeGreaterThan(0);
      if (options.unavailable) expect(result.counts.issues).toBeNull();
      expect(JSON.stringify(result)).not.toContain('do not leak');
    });
  });
});

describe('Issue workflow executes current state and owns only its labels', () => {
  it('ignores a stale event body, preserves concurrent labels and refuses duplicate classification', async () => {
    const yaml = readFileSync(path.resolve('.github/workflows/issue-provenance.yml'), 'utf8');
    const script = yaml.split('          script: |\n')[1].split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
    vi.stubEnv('GITHUB_WORKSPACE', process.cwd());
    const current = issue({ body: `WORKSTREAM: ${GOV}\nWORKSTREAM: ${PRODUCT}`, labels: [label(), 'state:active', 'custom:keep'] });
    const labels = new Set(current.labels as string[]);
    const failed = vi.fn();
    const summary = { addHeading: vi.fn().mockReturnThis(), addTable: vi.fn().mockReturnThis(), write: vi.fn() };
    const api = {
      get: vi.fn(async () => ({ data: { ...current, labels: [...labels] } })),
      getLabel: vi.fn(async () => ({})),
      removeLabel: vi.fn(async ({ name }: { name: string }) => { labels.delete(name); }),
      addLabels: vi.fn(async ({ labels: names }: { labels: string[] }) => { names.forEach(name => labels.add(name)); }),
      setLabels: vi.fn(() => { throw new Error('whole-label replacement forbidden'); }),
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    // Vitest's VM cannot import inside AsyncFunction. Inject only the loader, not policy results.
    const executable = script.replace('await import(', 'await importPolicy(');
    const loadPolicy = async (url: string) => {
      expect(url).toBe(pathToFileURL(path.resolve('scripts/agents/issue-provenance-policy.mjs')).href);
      return { validateIssueProvenance };
    };
    await new AsyncFunction('github', 'context', 'core', 'require', 'importPolicy', executable)(
      { rest: { issues: api } }, { repo: { owner: 'test', repo: 'repo' }, payload: { issue: issue() } },
      { summary, setFailed: failed }, createRequire(import.meta.url), loadPolicy,
    );
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.setLabels).not.toHaveBeenCalled();
    expect(labels.has('state:active') && labels.has('custom:keep')).toBe(true);
    expect(labels.has('governance:workstream-incomplete')).toBe(true);
    expect(labels.has(label())).toBe(false);
    expect(failed).toHaveBeenCalled();
  });
  it('wires label/reopen events and a read-only scheduled trusted-main watcher', () => {
    for (const name of ['issue-provenance.yml', 'agent-workstream-classification.yml']) {
      const text = readFileSync(path.resolve('.github/workflows', name), 'utf8');
      expect(text).toContain('reopened');
      expect(text).toContain('labeled, unlabeled');
      expect(text).not.toContain('await github.rest.issues.setLabels(');
    }
    const watch = readFileSync(path.resolve('.github/workflows/agent-workstream-watch.yml'), 'utf8');
    expect(watch).toContain('schedule:');
    expect(watch).toContain('workflow_dispatch:');
    expect(watch).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(watch).toContain('observeClassifications({ github, ...context.repo, policySha })');
    expect(watch).not.toMatch(/: write|secrets\.|pull_request_target|npm (ci|install)/);
  });
});
