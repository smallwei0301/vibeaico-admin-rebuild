import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPreviewDeployment,
  runProductionCutoverCanary,
  verifyPreviewDeployment,
} from '../../scripts/ci/production-deploy-canary.mjs';

const PROD_SHA = '1111111111111111111111111111111111111111';
const MAIN_SHA = '2222222222222222222222222222222222222222';
const PROJECT_ID = 'prj_example';
const PROJECT_NAME = 'vibeaico-admin-rebuild';
const TEAM_ID = 'team_example';
const OWNER = 'smallwei0301';
const REPO = 'vibeaico-admin-rebuild';
const HOSTNAME = 'vibeaico-admin-rebuild.vercel.app';

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function productionAlias(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dpl_prod',
    target: 'production',
    readyState: 'READY',
    source: 'git',
    alias: [HOSTNAME],
    project: { id: PROJECT_ID },
    meta: {
      githubCommitOrg: OWNER,
      githubCommitRepo: REPO,
      githubCommitRef: 'main',
      githubCommitSha: PROD_SHA,
    },
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dpl_preview',
    url: 'preview.example.vercel.app',
    target: null,
    readyState: 'READY',
    source: 'git',
    project: { id: PROJECT_ID },
    meta: {
      githubCommitOrg: OWNER,
      githubCommitRepo: REPO,
      githubCommitRef: 'main',
      githubCommitSha: MAIN_SHA,
    },
    ...overrides,
  };
}

function docsOnlyGit() {
  return (args: string[]) => {
    if (args[0] === 'cat-file') return { status: 0, stdout: '', stderr: '', error: null };
    if (args[0] === 'merge-base') return { status: 0, stdout: '', stderr: '', error: null };
    if (args[0] === 'diff') return { status: 0, stdout: 'M\0docs/a.md\0', stderr: '', error: null };
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
}

function incompleteGit() {
  return (args: string[]) => {
    if (args[0] === 'cat-file') return { status: 0, stdout: '', stderr: '', error: null };
    if (args[0] === 'merge-base') return { status: 0, stdout: '', stderr: '', error: null };
    if (args[0] === 'diff') return { status: 2, stdout: '', stderr: 'simulated diff failure', error: null };
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
}

function baseArgs() {
  return {
    token: 'secret-for-test-only',
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    owner: OWNER,
    repo: REPO,
    hostname: HOSTNAME,
    currentSha: MAIN_SHA,
    latestMainSha: MAIN_SHA,
    checksState: 'SUCCESS',
    runGit: docsOnlyGit(),
    sleep: async () => {},
  };
}

describe('Issue #228 production cutover preview canary', () => {
  it('creates a Git-backed Preview for the exact SHA and never asks Vercel for a Production target', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return response({ id: 'dpl_preview', readyState: 'QUEUED' });
    };

    await createPreviewDeployment({
      token: 'secret-for-test-only',
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      projectName: PROJECT_NAME,
      owner: OWNER,
      repo: REPO,
      sha: MAIN_SHA,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v13/deployments?teamId=');
    expect(calls[0].init.method).toBe('POST');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.target).toBeUndefined();
    expect(body.gitSource).toEqual({ type: 'github', org: OWNER, repo: REPO, ref: MAIN_SHA });
    expect(body.meta).toMatchObject({ deploymentController: 'issue-228-preview-canary', expectedMainSha: MAIN_SHA });
  });

  it('accepts only a READY explicit-null Preview target with exact project/repo/SHA identity', () => {
    expect(verifyPreviewDeployment(preview(), {
      projectId: PROJECT_ID,
      owner: OWNER,
      repo: REPO,
      sha: MAIN_SHA,
    })).toMatchObject({
      deploymentId: 'dpl_preview',
      projectId: PROJECT_ID,
      source: 'git',
      target: null,
      sha: MAIN_SHA,
    });
  });

  it('rejects Production target regardless of case', () => {
    for (const target of ['production', 'Production', 'PRODUCTION']) {
      expect(() => verifyPreviewDeployment(preview({ target }), {
        projectId: PROJECT_ID,
        owner: OWNER,
        repo: REPO,
        sha: MAIN_SHA,
      })).toThrow(/PREVIEW_TARGET_IS_PRODUCTION/);
    }
  });

  it('rejects missing, unknown, boolean and object target representations', () => {
    const missingTarget = preview();
    delete (missingTarget as Record<string, unknown>).target;
    expect(() => verifyPreviewDeployment(missingTarget, {
      projectId: PROJECT_ID,
      owner: OWNER,
      repo: REPO,
      sha: MAIN_SHA,
    })).toThrow(/PREVIEW_TARGET_MISSING/);

    for (const target of ['preview', '', false, true, {}]) {
      expect(() => verifyPreviewDeployment(preview({ target }), {
        projectId: PROJECT_ID,
        owner: OWNER,
        repo: REPO,
        sha: MAIN_SHA,
      })).toThrow(/PREVIEW_TARGET_UNTRUSTED/);
    }
  });

  it('rejects wrong source or wrong exact SHA before it can count as a green canary', () => {
    expect(() => verifyPreviewDeployment(preview({ source: 'cli' }), {
      projectId: PROJECT_ID,
      owner: OWNER,
      repo: REPO,
      sha: MAIN_SHA,
    })).toThrow(/PREVIEW_SOURCE_NOT_GIT/);
    expect(() => verifyPreviewDeployment(preview({
      meta: {
        githubCommitOrg: OWNER,
        githubCommitRepo: REPO,
        githubCommitRef: 'main',
        githubCommitSha: PROD_SHA,
      },
    }), {
      projectId: PROJECT_ID,
      owner: OWNER,
      repo: REPO,
      sha: MAIN_SHA,
    })).toThrow(/PREVIEW_GIT_SHA_MISMATCH/);
  });

  it('observe mode proves Production baseline/complete Git range but does not create a Preview', async () => {
    const methods: string[] = [];
    const fetchImpl = async (_url: string | URL | Request, init: RequestInit = {}) => {
      methods.push(String(init.method ?? 'GET'));
      return response(productionAlias());
    };
    const result = await runProductionCutoverCanary({
      ...baseArgs(),
      mode: 'observe',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.status).toBe('OBSERVED');
    expect(result.decision).toMatchObject({ action: 'SKIP', reason: 'NON_RUNTIME_DELTA' });
    expect(methods).toEqual(['GET']);
    expect(result.preview).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret-for-test-only');
  });

  it('preview_canary may build a deliberate non-runtime Preview, while keeping Production untouched', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let deploymentReads = 0;
    const fetchImpl = async (url: string | URL | Request, init: RequestInit = {}) => {
      const method = String(init.method ?? 'GET');
      calls.push({ url: String(url), method, body: init.body ? String(init.body) : undefined });
      if (method === 'POST') return response({ id: 'dpl_preview', readyState: 'QUEUED' });
      if (String(url).includes('/v13/deployments/dpl_preview')) {
        deploymentReads += 1;
        return response(preview());
      }
      return response(productionAlias());
    };
    const result = await runProductionCutoverCanary({
      ...baseArgs(),
      mode: 'preview_canary',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.status).toBe('PREVIEW_CANARY_GREEN');
    expect(result.decision).toMatchObject({ action: 'SKIP', reason: 'NON_RUNTIME_DELTA' });
    expect(result.preview).toMatchObject({ deploymentId: 'dpl_preview', sha: MAIN_SHA });
    expect(deploymentReads).toBe(1);
    const post = calls.find((call) => call.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post?.body)).target).toBeUndefined();
    expect(calls.some((call) => call.url.includes('/promote/'))).toBe(false);
  });

  it('fails closed before provider contact when current SHA is stale', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      calls.push(String(url));
      return response(productionAlias());
    };
    const result = await runProductionCutoverCanary({
      ...baseArgs(),
      currentSha: MAIN_SHA,
      latestMainSha: PROD_SHA,
      mode: 'preview_canary',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.decision).toMatchObject({ action: 'BLOCK', reason: 'STALE_SHA' });
    expect(calls).toEqual([]);
  });

  it('fails closed and never POSTs when complete Git diff evidence cannot be produced', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = async (url: string | URL | Request, init: RequestInit = {}) => {
      const method = String(init.method ?? 'GET');
      calls.push({ url: String(url), method });
      return response(productionAlias());
    };
    const result = await runProductionCutoverCanary({
      ...baseArgs(),
      mode: 'preview_canary',
      runGit: incompleteGit(),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.decision).toMatchObject({ action: 'BLOCK', reason: 'COMPARISON_EVIDENCE_INCOMPLETE' });
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('fails closed and never creates a Preview when the Production baseline is untrusted', async () => {
    const methods: string[] = [];
    const fetchImpl = async (_url: string | URL | Request, init: RequestInit = {}) => {
      methods.push(String(init.method ?? 'GET'));
      return response(productionAlias({ alias: ['wrong.example.vercel.app'] }));
    };
    const result = await runProductionCutoverCanary({
      ...baseArgs(),
      mode: 'preview_canary',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.decision).toEqual({ action: 'BLOCK', reason: 'PRODUCTION_BASELINE_UNTRUSTED' });
    expect(methods).toEqual(['GET']);
  });

  it('the workflow binds required check to exact SHA, GitHub Actions app and ci.yml push run', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/production-deploy-canary.yml'), 'utf8');
    expect(workflow).toContain("String(check.head_sha || '').toLowerCase() === expected");
    expect(workflow).toContain("check.app?.slug === 'github-actions'");
    expect(workflow).toContain('check.app?.id === 15368');
    expect(workflow).toContain('github.rest.actions.getWorkflowRun');
    expect(workflow).toContain("run.path !== '.github/workflows/ci.yml'");
    expect(workflow).toContain("run.event !== 'push'");
  });

  it('the workflow is manual-only, secret-backed, read-only at GitHub, and has no Production mutation verbs', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/production-deploy-canary.yml'), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/\n\s*push:/);
    expect(workflow).not.toMatch(/\n\s*pull_request:/);
    expect(workflow).toContain('permissions:\n  contents: read\n  checks: read\n  actions: read');
    expect(workflow).not.toMatch(/^\s+[\w-]+:\s*write\s*$/m);
    expect(workflow).toContain('secrets.VERCEL_TOKEN');
    expect(workflow).toContain('preview_canary');
    expect(workflow).not.toContain('target: production');
    expect(workflow).not.toMatch(/vercel\s+promote/i);
    expect(workflow).not.toMatch(/delete.*deployment/i);
  });
});
