import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { changeDigestOf, evaluateAstra, evaluateGithubAstra, isTrustedFinalRiskAgentUser, routing } from '../../scripts/agents/astra-review-policy.mjs';

const BOT = { login: 'claude[bot]', id: 209825114, type: 'Bot' };
const FILES = [
  { filename: 'src/server/tenant.ts', status: 'modified', sha: '1'.repeat(40) },
  { filename: 'src/server/http.ts', status: 'modified', sha: '2'.repeat(40) },
];
const DIGEST = changeDigestOf(FILES);
const TEST = 'reviewed-ci-run-123 with full unit and build pass';
const SCHEMA = 'migration-0095 local-isolated baseline verified';
const BODY = [
  'ASTRA_RISK: TENANT_AUTH_BOUNDARY',
  'ASTRA_RATIONALE: Cross-tenant impersonation is a high-consequence authorization boundary',
  `ASTRA_TEST_BASELINE: ${TEST}`,
  `ASTRA_SCHEMA_BASELINE: ${SCHEMA}`,
].join('\n');
const payload = (patch: Record<string, unknown> = {}) => ({
  repository: 'smallwei0301/vibeaico-admin-rebuild', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
  changeDigest: DIGEST, policyVersion: routing.version, testBaseline: TEST, schemaBaseline: SCHEMA,
  requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1', identityEvidence: 'OPERATOR_ATTESTED', verdict: 'PASS',
  report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/330', findings: 'Independent Final Risk PASS after fixes', ...patch,
});
const review = (user: Record<string, unknown> = BOT, patch = {}, record = {}) => ({
  id: 10, state: 'COMMENTED', commit_id: 'b'.repeat(40), submitted_at: '2026-09-10T03:00:00Z', user,
  body: `\`\`\`astra-review\n${JSON.stringify(payload(patch))}\n\`\`\``, ...record,
});
const current = { number: 330, changed_files: 2, body: BODY, base: { sha: 'c'.repeat(40) }, head: { sha: 'd'.repeat(40) } };
const context = { repository: 'smallwei0301/vibeaico-admin-rebuild', baseSha: current.base.sha, headSha: current.head.sha, changeDigest: DIGEST, policyVersion: routing.version, testBaseline: TEST, schemaBaseline: SCHEMA };
const changedFiles = FILES.map(f => f.filename);

const githubFor = (reviews: unknown[], permission = 'read') => {
  const listFiles = vi.fn(), listReviews = vi.fn();
  const getCollaboratorPermissionLevel = vi.fn(async () => ({ data: { permission } }));
  const paginate = vi.fn(async (fn: unknown) => fn === listFiles ? FILES : fn === listReviews ? reviews : Promise.reject(new Error('unexpected paginate target')));
  return { github: { paginate, rest: { pulls: { listFiles, listReviews }, repos: { getCollaboratorPermissionLevel } } }, getCollaboratorPermissionLevel };
};
const trusted = (patch = {}, record = {}) => ({ ...review(BOT, patch, record), trusted: true });

describe('Final Risk trusted Agent identity (#335)', () => {
  it('trusts only exact allowlisted login + immutable id + Bot type', () => {
    expect(isTrustedFinalRiskAgentUser(BOT)).toBe(true);
    for (const user of [{ ...BOT, id: 999 }, { ...BOT, type: 'User' }, { login: 'other[bot]', id: 209825114, type: 'Bot' }])
      expect(isTrustedFinalRiskAgentUser(user)).toBe(false);
  });

  it('fails closed for malformed trusted Agent catalogs', () => {
    for (const trustedAgentBots of [
      [{ login: 'claude[bot]', id: 'bad', type: 'Bot' }],
      [{ login: 'claude[bot]', id: 209825114, type: 'User' }],
      [BOT, BOT],
    ]) {
      expect(isTrustedFinalRiskAgentUser(BOT, { ...routing, finalRiskTrust: { version: 'test', trustedAgentBots } })).toBe(false);
    }
  });

  it('accepts allowlisted Agent evidence without collaborator permission', async () => {
    const { github, getCollaboratorPermissionLevel } = githubFor([review()]);
    const result = await evaluateGithubAstra({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current });
    expect(result.status).toBe('ASTRA_APPROVED');
    expect(result.errors).toEqual([]);
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
  });

  it('rejects unallowlisted bots but keeps the write-capable human fallback', async () => {
    const denied = githubFor([review({ ...BOT, id: 999 })], 'read');
    expect((await evaluateGithubAstra({ github: denied.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current })).status).toBe('ASTRA_PENDING');
    expect(denied.getCollaboratorPermissionLevel).toHaveBeenCalledOnce();
    const human = githubFor([review({ login: 'maintainer', id: 1, type: 'User' })], 'write');
    expect((await evaluateGithubAstra({ github: human.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current })).status).toBe('ASTRA_APPROVED');
  });

  it('keeps model, digest, schema and latest-negative checks fail closed', () => {
    expect(evaluateAstra({ body: BODY, changedFiles, context, reviews: [trusted({ actualModel: 'unknown' })] }).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra({ body: BODY, changedFiles, context: { ...context, changeDigest: '9'.repeat(64) }, reviews: [trusted()] }).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra({ body: BODY, changedFiles, context: { ...context, schemaBaseline: 'different schema baseline' }, reviews: [trusted()] }).status).toBe('ASTRA_PENDING');
    const newerFix = trusted({ verdict: 'FIX_REQUIRED' }, { id: 11, submitted_at: '2026-09-10T03:01:00Z' });
    expect(evaluateAstra({ body: BODY, changedFiles, context, reviews: [trusted(), newerFix] }).status).toBe('ASTRA_PENDING');
  });

  it('reuses Final Risk after pure rebase when digest and reviewed baseline are unchanged', () => {
    const rebased = { ...context, baseSha: 'e'.repeat(40), headSha: 'f'.repeat(40) };
    expect(evaluateAstra({ body: BODY, changedFiles, context: rebased, reviews: [{ ...review(), trusted: true }] }).status).toBe('ASTRA_APPROVED');
  });
});

describe('Final Risk Agent refresh workflow (#335)', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/agent-wip-guard.yml'), 'utf8');
  const docs = readFileSync(resolve(process.cwd(), 'docs/MODEL-ROUTING.md'), 'utf8');
  const skill = readFileSync(resolve(process.cwd(), '.agents/skills/vibeaico-astra-review/SKILL.md'), 'utf8');

  it('accepts tool footers and checks trusted Agent identity before collaborator permission', () => {
    expect(workflow).toContain("startsWith(github.event.comment.body, '/astra-review-check\\n')");
    expect(workflow).toContain('astra.isTrustedFinalRiskAgentUser(commentUser)');
    const trustedIndex = workflow.indexOf('astra.isTrustedFinalRiskAgentUser(commentUser)');
    expect(workflow.indexOf('getCollaboratorPermissionLevel', trustedIndex)).toBeGreaterThan(trustedIndex);
  });

  it('documents Agent-native evidence and pure-rebase reuse as the normal path', () => {
    for (const text of [docs, skill]) {
      expect(text).toContain('Owner action NOT_REQUIRED');
      expect(text).toContain('changeDigest');
      expect(text).toContain('不重跑 semantic Final Risk');
    }
    expect(docs).toContain('209825114');
    expect(skill).toContain('trustedAgentBots');
  });
});
