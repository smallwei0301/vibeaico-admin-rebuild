import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  changeDigestOf,
  evaluateAstra,
  evaluateGithubAstra,
  isTrustedFinalRiskAgentUser,
  routing,
} from '../../scripts/agents/astra-review-policy.mjs';

const TRUSTED_BOT = { login: 'claude[bot]', id: 209825114, type: 'Bot' };
const FILES = [
  { filename: 'src/server/tenant.ts', status: 'modified', sha: '1'.repeat(40) },
  { filename: 'src/server/http.ts', status: 'modified', sha: '2'.repeat(40) },
];
const DIGEST = changeDigestOf(FILES);
const TEST_BASELINE = 'reviewed-ci-run-123 with full unit and build pass';
const SCHEMA_BASELINE = 'migration-0095 local-isolated baseline verified';
const BODY = [
  'ASTRA_RISK: TENANT_AUTH_BOUNDARY',
  'ASTRA_RATIONALE: Cross-tenant impersonation is a high-consequence authorization boundary',
  `ASTRA_TEST_BASELINE: ${TEST_BASELINE}`,
  `ASTRA_SCHEMA_BASELINE: ${SCHEMA_BASELINE}`,
].join('\n');

const reviewBody = (patch: Record<string, unknown> = {}) => '```astra-review\n' + JSON.stringify({
  repository: 'smallwei0301/vibeaico-admin-rebuild',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  changeDigest: DIGEST,
  policyVersion: routing.version,
  testBaseline: TEST_BASELINE,
  schemaBaseline: SCHEMA_BASELINE,
  requestedModel: 'claude-fable-5-1',
  actualModel: 'claude-fable-5-1',
  identityEvidence: 'OPERATOR_ATTESTED',
  verdict: 'PASS',
  report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/330',
  findings: 'Independent Final Risk review found no unresolved blocking finding after fixes',
  ...patch,
}) + '\n```';

const review = (user: Record<string, unknown> = TRUSTED_BOT, patch: Record<string, unknown> = {}, record: Record<string, unknown> = {}) => ({
  id: 10,
  state: 'COMMENTED',
  commit_id: 'b'.repeat(40),
  submitted_at: '2026-09-10T03:00:00Z',
  user,
  body: reviewBody(patch),
  ...record,
});

const current = {
  number: 330,
  changed_files: FILES.length,
  body: BODY,
  base: { sha: 'c'.repeat(40) },
  head: { sha: 'd'.repeat(40) },
};

const githubFor = (reviews: unknown[], permission = 'read') => {
  const listFiles = vi.fn();
  const listReviews = vi.fn();
  const getCollaboratorPermissionLevel = vi.fn(async () => ({ data: { permission } }));
  const paginate = vi.fn(async (fn: unknown) => {
    if (fn === listFiles) return FILES;
    if (fn === listReviews) return reviews;
    throw new Error('unexpected paginate target');
  });
  return {
    github: { paginate, rest: { pulls: { listFiles, listReviews }, repos: { getCollaboratorPermissionLevel } } },
    getCollaboratorPermissionLevel,
  };
};

describe('Final Risk trusted Agent identity (#335)', () => {
  it('trusts only the exact allowlisted bot identity', () => {
    expect(isTrustedFinalRiskAgentUser(TRUSTED_BOT)).toBe(true);
    expect(isTrustedFinalRiskAgentUser({ ...TRUSTED_BOT, id: 999 })).toBe(false);
    expect(isTrustedFinalRiskAgentUser({ ...TRUSTED_BOT, type: 'User' })).toBe(false);
    expect(isTrustedFinalRiskAgentUser({ login: 'other[bot]', id: 209825114, type: 'Bot' })).toBe(false);
  });

  it('fails closed when the trusted Agent catalog is malformed', () => {
    for (const trustedAgentBots of [
      [{ login: 'claude[bot]', id: 'bad', type: 'Bot' }],
      [{ login: 'claude[bot]', id: 209825114, type: 'User' }],
      [TRUSTED_BOT, TRUSTED_BOT],
    ]) {
      const policy = { ...routing, finalRiskTrust: { version: 'test', trustedAgentBots } };
      expect(isTrustedFinalRiskAgentUser(TRUSTED_BOT, policy)).toBe(false);
    }
  });

  it('accepts an allowlisted Agent review without requiring collaborator permission', async () => {
    const { github, getCollaboratorPermissionLevel } = githubFor([review()]);
    const result = await evaluateGithubAstra({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current });
    expect(result.status).toBe('ASTRA_APPROVED');
    expect(result.errors).toEqual([]);
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
  });

  it('rejects an unallowlisted bot and keeps the write-capable human fallback', async () => {
    const wrongBot = { ...TRUSTED_BOT, id: 999 };
    const denied = githubFor([review(wrongBot)], 'read');
    expect((await evaluateGithubAstra({ github: denied.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current })).status).toBe('ASTRA_PENDING');
    expect(denied.getCollaboratorPermissionLevel).toHaveBeenCalledOnce();

    const human = githubFor([review({ login: 'maintainer', id: 1, type: 'User' })], 'write');
    expect((await evaluateGithubAstra({ github: human.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current })).status).toBe('ASTRA_APPROVED');
  });

  it('does not weaken model, digest, schema or latest-negative evidence checks', () => {
    const context = {
      repository: 'smallwei0301/vibeaico-admin-rebuild',
      baseSha: current.base.sha,
      headSha: current.head.sha,
      changeDigest: DIGEST,
      policyVersion: routing.version,
      testBaseline: TEST_BASELINE,
      schemaBaseline: SCHEMA_BASELINE,
    };
    const trusted = (patch: Record<string, unknown> = {}, record: Record<string, unknown> = {}) => ({ ...review(TRUSTED_BOT, patch, record), trusted: true });

    expect(evaluateAstra({ body: BODY, changedFiles: FILES.map(f => f.filename), context, reviews: [trusted({ actualModel: 'unknown' })] }).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra({ body: BODY, changedFiles: FILES.map(f => f.filename), context: { ...context, changeDigest: '9'.repeat(64) }, reviews: [trusted()] }).status).toBe('ASTRA_PENDING');
    expect(evaluateAstra({ body: BODY, changedFiles: FILES.map(f => f.filename), context: { ...context, schemaBaseline: 'different schema baseline' }, reviews: [trusted()] }).status).toBe('ASTRA_PENDING');

    const newerFix = trusted({ verdict: 'FIX_REQUIRED' }, { id: 11, submitted_at: '2026-09-10T03:01:00Z' });
    expect(evaluateAstra({ body: BODY, changedFiles: FILES.map(f => f.filename), context, reviews: [trusted(), newerFix] }).status).toBe('ASTRA_PENDING');
  });

  it('reuses semantic Final Risk after a pure rebase when content and reviewed baseline are unchanged', () => {
    const context = {
      repository: 'smallwei0301/vibeaico-admin-rebuild',
      baseSha: 'e'.repeat(40),
      headSha: 'f'.repeat(40),
      changeDigest: DIGEST,
      policyVersion: routing.version,
      testBaseline: TEST_BASELINE,
      schemaBaseline: SCHEMA_BASELINE,
    };
    const oldHeadReview = { ...review(), trusted: true, commit_id: 'b'.repeat(40) };
    expect(evaluateAstra({ body: BODY, changedFiles: FILES.map(f => f.filename), context, reviews: [oldHeadReview] }).status).toBe('ASTRA_APPROVED');
  });
});

describe('Final Risk Agent refresh workflow (#335)', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/agent-wip-guard.yml'), 'utf8');
  const docs = readFileSync(resolve(process.cwd(), 'docs/MODEL-ROUTING.md'), 'utf8');
  const skill = readFileSync(resolve(process.cwd(), '.agents/skills/vibeaico-astra-review/SKILL.md'), 'utf8');

  it('accepts command footers and checks trusted Agent identity before collaborator permission', () => {
    expect(workflow).toContain("startsWith(github.event.comment.body, '/astra-review-check\\n')");
    expect(workflow).toContain('astra.isTrustedFinalRiskAgentUser(commentUser)');
    const trustedIndex = workflow.indexOf('astra.isTrustedFinalRiskAgentUser(commentUser)');
    const permissionIndex = workflow.indexOf('getCollaboratorPermissionLevel', trustedIndex);
    expect(permissionIndex).toBeGreaterThan(trustedIndex);
  });

  it('documents Agent-native review and pure-rebase reuse as the normal path', () => {
    for (const text of [docs, skill]) {
      expect(text).toContain('Owner action NOT_REQUIRED');
      expect(text).toContain('changeDigest');
      expect(text).toContain('不重跑 semantic Final Risk');
    }
    expect(docs).toContain('209825114');
    expect(skill).toContain('trustedAgentBots');
  });
});
