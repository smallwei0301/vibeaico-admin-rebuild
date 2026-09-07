import { describe, expect, it } from 'vitest';
import {
  buildProductionDeployEvidence,
  collectGitRangeEvidence,
  normalizeProductionAliasDeployment,
  parseGitNameStatusZ,
} from '../../scripts/ci/production-deploy-evidence.mjs';

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';
const SHA_C = '3333333333333333333333333333333333333333';
const HOSTNAME = 'admin.example.vercel.app';
const PROJECT = 'prj_example';
const REPO = 'vibeaico-admin-rebuild';

function aliasPayload(overrides: Record<string, unknown> = {}) {
  return {
    deployment: {
      id: 'dpl_current',
      target: 'production',
      readyState: 'READY',
      alias: [HOSTNAME, 'git-main.example.vercel.app'],
      project: { id: PROJECT, name: REPO },
      source: 'git',
      createdAt: 123,
      url: 'generated.example.vercel.app',
      meta: {
        githubCommitRepo: REPO,
        githubCommitRef: 'main',
        githubCommitSha: SHA_A,
      },
      ...overrides,
    },
  };
}

function gitRunner({
  diff = 'M\0docs/a.md\0',
  ancestorStatus = 0,
  diffStatus = 0,
  missingSha = '',
} = {}) {
  const calls: string[][] = [];
  const runGit = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'cat-file') {
      const sha = String(args[2]).split('^')[0];
      return { status: sha === missingSha ? 1 : 0, stdout: '', stderr: '', error: null };
    }
    if (args[0] === 'merge-base') {
      return { status: ancestorStatus, stdout: '', stderr: '', error: null };
    }
    if (args[0] === 'diff') {
      return { status: diffStatus, stdout: diff, stderr: '', error: null };
    }
    throw new Error(`Unexpected git command: ${args.join(' ')}`);
  };
  return { runGit, calls };
}

function build(overrides: Record<string, unknown> = {}) {
  const git = gitRunner();
  const result = buildProductionDeployEvidence({
    productionAliasPayload: aliasPayload(),
    repo: REPO,
    ref: 'main',
    hostname: HOSTNAME,
    projectId: PROJECT,
    currentSha: SHA_B,
    latestMainSha: SHA_B,
    checksState: 'SUCCESS',
    runGit: git.runGit,
    ...overrides,
  });
  return { result, calls: git.calls };
}

describe('Issue #228 Production evidence adapter', () => {
  it('trusts the deployment resolved by the Production hostname only when alias/project/Git metadata all match', () => {
    expect(normalizeProductionAliasDeployment(aliasPayload(), {
      repo: REPO,
      ref: 'main',
      hostname: HOSTNAME,
      projectId: PROJECT,
    })).toEqual({
      valid: true,
      errors: [],
      deployment: {
        deploymentId: 'dpl_current',
        sha: SHA_A,
        target: 'production',
        state: 'READY',
        aliases: [HOSTNAME, 'git-main.example.vercel.app'],
        projectId: PROJECT,
        gitRepo: REPO,
        gitRef: 'main',
        source: 'git',
        createdAt: 123,
        url: 'generated.example.vercel.app',
      },
    });
  });

  it('blocks an alias response that is not the expected current Production truth', () => {
    const wrongAlias = normalizeProductionAliasDeployment(aliasPayload({ alias: ['other.example.vercel.app'] }), {
      repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
    });
    expect(wrongAlias.valid).toBe(false);
    expect(wrongAlias.errors).toContain('PRODUCTION_HOSTNAME_NOT_ASSIGNED');

    const cancelled = normalizeProductionAliasDeployment(aliasPayload({ readyState: 'CANCELED' }), {
      repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
    });
    expect(cancelled.errors).toContain('PRODUCTION_ALIAS_NOT_READY');

    const wrongProject = normalizeProductionAliasDeployment(aliasPayload({ project: { id: 'prj_wrong' } }), {
      repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
    });
    expect(wrongProject.errors).toContain('PRODUCTION_PROJECT_MISMATCH');
  });

  it('does not infer the baseline from deployment creation order', () => {
    const result = normalizeProductionAliasDeployment(aliasPayload({
      id: 'dpl_rolled_back_old',
      createdAt: 10,
      meta: {
        githubCommitRepo: REPO,
        githubCommitRef: 'main',
        githubCommitSha: SHA_A,
      },
    }), {
      repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
    });
    expect(result.deployment).toMatchObject({ deploymentId: 'dpl_rolled_back_old', sha: SHA_A });
  });

  it('parses rename/copy evidence with both old and new paths', () => {
    expect(parseGitNameStatusZ(
      'A\0docs/b.md\0R100\0src/old.ts\0docs/new.ts\0C75\0src/base.ts\0src/copy.ts\0',
    )).toEqual([
      'docs/b.md',
      'src/old.ts',
      'docs/new.ts',
      'src/base.ts',
      'src/copy.ts',
    ]);
  });

  it('rejects malformed git name-status output instead of dropping unknown evidence', () => {
    expect(() => parseGitNameStatusZ('Q\0docs/a.md\0')).toThrow(/Untrusted git name-status token/);
    expect(() => parseGitNameStatusZ('R100\0src/old.ts\0')).toThrow(/Untrusted path/);
    expect(() => parseGitNameStatusZ('M\0docs/bad\nname.md\0')).toThrow(/Untrusted path/);
  });

  it('proves both commits exist, proves ancestry, then reads the complete local Git range', () => {
    const git = gitRunner({ diff: 'R100\0src/old.ts\0docs/new.ts\0M\0docs/a.md\0' });
    expect(collectGitRangeEvidence({ baseSha: SHA_A, headSha: SHA_B, runGit: git.runGit }))
      .toEqual({
        comparisonBaseSha: SHA_A,
        currentSha: SHA_B,
        comparisonBaseIsAncestor: true,
        changedPathsComplete: true,
        changedPaths: ['src/old.ts', 'docs/new.ts', 'docs/a.md'],
        error: null,
      });
    expect(git.calls.map((call) => call[0])).toEqual(['cat-file', 'cat-file', 'merge-base', 'diff']);
  });

  it('blocks non-ancestor or shallow/missing comparison baselines', () => {
    const diverged = gitRunner({ ancestorStatus: 1 });
    expect(collectGitRangeEvidence({ baseSha: SHA_A, headSha: SHA_B, runGit: diverged.runGit }))
      .toMatchObject({ comparisonBaseIsAncestor: false, changedPathsComplete: false, error: 'BASE_NOT_ANCESTOR' });

    const shallow = gitRunner({ missingSha: SHA_A });
    expect(collectGitRangeEvidence({ baseSha: SHA_A, headSha: SHA_B, runGit: shallow.runGit }))
      .toMatchObject({ comparisonBaseIsAncestor: false, changedPathsComplete: false, error: `MISSING_COMMIT:${SHA_A}` });
  });

  it('turns a complete docs-only alias-to-main range into POLICY_SKIP evidence', () => {
    const { result } = build();
    expect(result.baseline).toMatchObject({ deploymentId: 'dpl_current', sha: SHA_A });
    expect(result.comparison).toMatchObject({
      comparisonBaseIsAncestor: true,
      changedPathsComplete: true,
      changedPaths: ['docs/a.md'],
    });
    expect(result.decision).toMatchObject({ action: 'SKIP', reason: 'NON_RUNTIME_DELTA' });
  });

  it('keeps a renamed-away src path as runtime and produces WOULD_DEPLOY', () => {
    const git = gitRunner({ diff: 'R100\0src/old.ts\0docs/new.ts\0' });
    const result = buildProductionDeployEvidence({
      productionAliasPayload: aliasPayload(),
      repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
      currentSha: SHA_B, latestMainSha: SHA_B, checksState: 'SUCCESS', runGit: git.runGit,
    });
    expect(result.decision).toMatchObject({
      action: 'WOULD_DEPLOY',
      reason: 'RUNTIME_DELTA',
      runtimePaths: ['src/old.ts'],
    });
  });

  it('blocks an untrusted Production alias before any Git comparison runs', () => {
    const git = gitRunner();
    const result = buildProductionDeployEvidence({
      productionAliasPayload: aliasPayload({ alias: ['wrong.example.vercel.app'] }),
      repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
      currentSha: SHA_B, latestMainSha: SHA_B, checksState: 'SUCCESS', runGit: git.runGit,
    });
    expect(result.decision).toEqual({ action: 'BLOCK', reason: 'PRODUCTION_BASELINE_UNTRUSTED' });
    expect(result.baselineErrors).toContain('PRODUCTION_HOSTNAME_NOT_ASSIGNED');
    expect(git.calls).toEqual([]);
  });

  it('does no Git diff for stale, pending, failed, or already-deployed candidates', () => {
    for (const scenario of [
      { currentSha: SHA_B, latestMainSha: SHA_C, checksState: 'SUCCESS', reason: 'STALE_SHA' },
      { currentSha: SHA_B, latestMainSha: SHA_B, checksState: 'PENDING', reason: 'CHECKS_PENDING' },
      { currentSha: SHA_B, latestMainSha: SHA_B, checksState: 'FAILURE', reason: 'CHECKS_NOT_GREEN' },
      { productionAliasPayload: aliasPayload({ meta: { githubCommitRepo: REPO, githubCommitRef: 'main', githubCommitSha: SHA_B } }), currentSha: SHA_B, latestMainSha: SHA_B, checksState: 'SUCCESS', reason: 'ALREADY_DEPLOYED' },
    ]) {
      const git = gitRunner();
      const result = buildProductionDeployEvidence({
        productionAliasPayload: scenario.productionAliasPayload ?? aliasPayload(),
        repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
        currentSha: scenario.currentSha,
        latestMainSha: scenario.latestMainSha,
        checksState: scenario.checksState,
        runGit: git.runGit,
      });
      expect(result.decision.reason).toBe(scenario.reason);
      expect(git.calls).toEqual([]);
    }
  });

  it('fails safe to WOULD_DEPLOY if local Git diff cannot be completed after ancestry is proven', () => {
    const git = gitRunner({ diffStatus: 2 });
    const result = buildProductionDeployEvidence({
      productionAliasPayload: aliasPayload(),
      repo: REPO, ref: 'main', hostname: HOSTNAME, projectId: PROJECT,
      currentSha: SHA_B, latestMainSha: SHA_B, checksState: 'SUCCESS', runGit: git.runGit,
    });
    expect(result.comparison).toMatchObject({
      comparisonBaseIsAncestor: true,
      changedPathsComplete: false,
      error: 'GIT_DIFF_FAILED',
    });
    expect(result.decision).toMatchObject({ action: 'WOULD_DEPLOY', reason: 'INCOMPLETE_DIFF_FAIL_SAFE' });
  });
});
