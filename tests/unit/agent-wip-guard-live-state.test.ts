import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/agent-wip-guard.yml'),
  'utf8',
);

describe('agent WIP Guard live-state dispatch', () => {
  it('re-reads the current PR before parsing metadata or deciding a TEST transition', () => {
    const payloadIndex = workflow.indexOf(
      'const payloadCurrent = context.payload.pull_request ?? { number: context.payload.issue.number };',
    );
    const liveReadIndex = workflow.indexOf(
      'const { data: current } = await github.rest.pulls.get({',
    );
    const metadataIndex = workflow.indexOf(
      'const metadata = policy.parseLaneMetadata(current);',
    );

    expect(payloadIndex).toBeGreaterThan(-1);
    expect(liveReadIndex).toBeGreaterThan(payloadIndex);
    expect(metadataIndex).toBeGreaterThan(liveReadIndex);
    expect(workflow).toContain('pull_number: payloadCurrent.number');
    expect(workflow).not.toContain(
      'const current = context.payload.pull_request;',
    );
  });

  it('uses live labels rather than stale event labels for one-shot remote TEST dispatch', () => {
    const liveLabelsIndex = workflow.indexOf(
      'const liveExisting = (current.labels ?? [])',
    );
    const labelWriteIndex = workflow.indexOf(
      'await github.rest.issues.setLabels({',
    );
    const dispatchDecisionIndex = workflow.indexOf(
      "!liveExisting.includes('lane:test-validation')",
    );
    const dispatchIndex = workflow.indexOf(
      'await github.rest.actions.createWorkflowDispatch({',
    );

    expect(liveLabelsIndex).toBeGreaterThan(-1);
    expect(labelWriteIndex).toBeGreaterThan(liveLabelsIndex);
    expect(dispatchDecisionIndex).toBeGreaterThan(labelWriteIndex);
    expect(dispatchIndex).toBeGreaterThan(dispatchDecisionIndex);
    expect(workflow).not.toContain(
      "!rawExisting.includes('lane:test-validation')",
    );
  });

  it('serializes only the same PR and cancels stale in-flight guard runs', () => {
    expect(workflow).toContain(
      'group: agent-wip-guard-${{ github.repository }}-${{ github.event.pull_request.number || github.event.issue.number }}',
    );
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).not.toMatch(/^concurrency:/m);
    expect(workflow).toMatch(/^    concurrency:/m);
    expect(workflow).not.toContain('  pull_request_review:');
    expect(workflow).toContain("github.event.comment.body == '/astra-review-check'");
    expect(workflow).not.toContain('group: agent-wip-guard-${{ github.repository }}\n');
  });

  it('writes a dedicated policy status that remains failed even when duplicate email noise is suppressed', () => {
    expect(workflow).toContain('statuses: write');
    expect(workflow).toContain("context: 'Agent WIP Policy'");
    expect(workflow).toContain("state: errors.length ? 'failure' : 'success'");
    expect(workflow).toContain('const duplicateFailure = Boolean(');
    expect(workflow).toContain('alert.isDuplicateWipFailure({');
    expect(workflow).toContain('DUPLICATE_NOTIFICATION_SUPPRESSED: ${duplicateFailure}');

    const statusIndex = workflow.indexOf('await github.rest.repos.createCommitStatus({');
    const duplicateWarningIndex = workflow.indexOf('core.warning(`Duplicate WIP failure suppressed');
    const firstFailureIndex = workflow.indexOf('core.setFailed(errors.join');
    expect(statusIndex).toBeGreaterThan(-1);
    expect(duplicateWarningIndex).toBeGreaterThan(statusIndex);
    expect(firstFailureIndex).toBeGreaterThan(duplicateWarningIndex);
  });

  it('binds the fingerprint to the PR number, exact head and complete error set', () => {
    expect(workflow).toContain('alert.buildWipErrorFingerprint({');
    expect(workflow).toContain('prNumber: current.number');
    expect(workflow).toContain('headSha: current.head.sha');
    expect(workflow).toContain('errors,');
    expect(workflow).toContain('- EXACT_HEAD: ${current.head.sha}');
    expect(workflow).toContain('- ERROR_FINGERPRINT: ${fingerprint}');
  });
});

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
  it('accepts either configured final-risk reviewer model', () => {
    expect(routing.models.finalRiskAllowedModels).toEqual(['gpt-6-astra', 'claude-fable-5-1']);
    for (const model of ['gpt-6-astra', 'claude-fable-5-1']) {
      expect(evaluateAstra(candidate([makeReview({ requestedModel: model, actualModel: model })])).status).toBe('ASTRA_APPROVED');
    }
  });
  it('fails closed when the configured final-risk allowlist is empty', () => {
    const emptyAllowlistPolicy = { ...routing, models: { ...routing.models, finalRiskAllowedModels: [] } };
    expect(evaluateAstra(candidate(), emptyAllowlistPolicy).status).toBe('ASTRA_PENDING');
  });
  it('rejects unknown or mixed final-risk reviewer models', () => {
    expect(evaluateAstra(candidate([makeReview({ requestedModel: 'unknown-model', actualModel: 'unknown-model' })])).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra(candidate([makeReview({ requestedModel: 'gpt-6-astra', actualModel: 'claude-fable-5-1' })])).status).toBe('ASTRA_PENDING');
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
