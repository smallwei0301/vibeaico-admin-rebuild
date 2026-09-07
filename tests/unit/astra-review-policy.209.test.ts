import { describe, it, expect } from 'vitest';
import { classifyAstra, evaluateAstra, evaluateGithubAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';

const body = 'ASTRA_RISK: NONE\nASTRA_RATIONALE: Change only an ordinary heading\n';
const context = {
  repository: 'smallwei0301/vibeaico-admin-rebuild', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  policyVersion: routing.version, testBaseline: 'unit-run-123:no-db', schemaBaseline: 'NOT_APPLICABLE: no schema changes',
};
const makeReview = (patch = {}, record = {}) => ({
  trusted: true, id: 1, state: 'COMMENTED', commit_id: context.headSha, submitted_at: '2026-09-07T00:00:00Z',
  body: '```astra-review\n' + JSON.stringify({ ...context, requestedModel: routing.models.finalRisk,
    actualModel: routing.models.finalRisk, identityEvidence: 'OPERATOR_ATTESTED', verdict: 'PASS',
    report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/209', findings: 'No unresolved blocking findings in this scope', ...patch }) + '\n```',
  ...record,
});
const candidate = (reviews = [makeReview()], extra = {}) => ({ body, changedFiles: ['scripts/agents/model-routing.json'], context, reviews, ...extra });

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
    expect(evaluateAstra(candidate([makeReview({}, { commit_id: 'c'.repeat(40) })])).status).toBe('ASTRA_PENDING');
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
