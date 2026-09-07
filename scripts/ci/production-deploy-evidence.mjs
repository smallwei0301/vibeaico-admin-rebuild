import { spawnSync } from 'node:child_process';
import { decideProductionDeployCandidate } from './production-deploy-decision.mjs';

const FULL_SHA = /^(?!0{40}$)[0-9a-f]{40}$/i;

/** @typedef {{ status: number | null, stdout: string, stderr: string, error: Error | null }} GitRunResult */
/** @typedef {(args: string[]) => GitRunResult} RunGit */

function normalizeSha(value = '') {
  return String(value ?? '').trim().toLowerCase();
}

function isValidSha(value) {
  return FULL_SHA.test(normalizeSha(value));
}

function lower(value = '') {
  return String(value ?? '').trim().toLowerCase();
}

function unwrapDeployment(payload) {
  if (payload && typeof payload === 'object' && payload.deployment && typeof payload.deployment === 'object') {
    return payload.deployment;
  }
  return payload && typeof payload === 'object' ? payload : null;
}

/**
 * Normalize the deployment currently resolved by the configured Production
 * hostname. Do not replace this with "newest READY deployment" selection: a
 * rollback can point Production at an older deployment while newer READY builds
 * remain in deployment history.
 *
 * During the pre-cutover phase this adapter accepts only Vercel Git Integration
 * deployments. The future controlled deployment path must add its own durable,
 * repository-verifiable attestation before this source requirement is relaxed.
 *
 * @param {any} payload
 * @param {{ owner?: string, repo?: string, ref?: string, hostname?: string, projectId?: string }} [options]
 */
export function normalizeProductionAliasDeployment(payload, options = {}) {
  const {
    owner,
    repo,
    ref = 'main',
    hostname,
    projectId,
  } = options;
  const raw = unwrapDeployment(payload);
  const errors = [];
  if (!raw) {
    return { valid: false, errors: ['PRODUCTION_ALIAS_RESPONSE_MISSING'], deployment: null };
  }

  const expectedOwner = lower(owner);
  const expectedRepo = lower(repo);
  const expectedRef = String(ref ?? '').trim();
  const expectedHostname = lower(hostname);
  const expectedProjectId = String(projectId ?? '').trim();

  if (!expectedOwner) errors.push('EXPECTED_GIT_OWNER_MISSING');
  if (!expectedRepo) errors.push('EXPECTED_GIT_REPO_MISSING');
  if (!expectedRef) errors.push('EXPECTED_GIT_REF_MISSING');
  if (!expectedHostname) errors.push('EXPECTED_PRODUCTION_HOSTNAME_MISSING');
  if (!expectedProjectId) errors.push('EXPECTED_VERCEL_PROJECT_MISSING');

  const deploymentId = String(raw.id ?? raw.uid ?? '').trim();
  const target = lower(raw.target);
  const state = String(raw.readyState ?? raw.state ?? raw.status ?? '').trim().toUpperCase();
  const aliases = Array.isArray(raw.alias)
    ? raw.alias.map((value) => lower(value)).filter(Boolean)
    : [];
  const resolvedProjectId = String(raw.project?.id ?? raw.projectId ?? '').trim();
  const source = lower(raw.source);
  const meta = raw.meta ?? {};
  const gitOwner = lower(meta.githubCommitOrg ?? meta.githubOrg);
  const gitRepo = lower(meta.githubCommitRepo ?? meta.githubRepo);
  const gitRef = String(meta.githubCommitRef ?? '').trim();
  const sha = normalizeSha(meta.githubCommitSha);

  if (!deploymentId) errors.push('PRODUCTION_DEPLOYMENT_ID_MISSING');
  if (target !== 'production') errors.push('PRODUCTION_ALIAS_TARGET_INVALID');
  if (state !== 'READY') errors.push('PRODUCTION_ALIAS_NOT_READY');
  if (source !== 'git') errors.push('PRODUCTION_SOURCE_UNTRUSTED');
  if (expectedHostname && !aliases.includes(expectedHostname)) errors.push('PRODUCTION_HOSTNAME_NOT_ASSIGNED');
  if (expectedProjectId && resolvedProjectId !== expectedProjectId) errors.push('PRODUCTION_PROJECT_MISMATCH');
  if (expectedOwner && gitOwner !== expectedOwner) errors.push('PRODUCTION_GIT_OWNER_MISMATCH');
  if (expectedRepo && gitRepo !== expectedRepo) errors.push('PRODUCTION_GIT_REPO_MISMATCH');
  if (expectedRef && gitRef !== expectedRef) errors.push('PRODUCTION_GIT_REF_MISMATCH');
  if (!isValidSha(sha)) errors.push('PRODUCTION_GIT_SHA_INVALID');

  if (errors.length) return { valid: false, errors: [...new Set(errors)], deployment: null };

  return {
    valid: true,
    errors: [],
    deployment: {
      deploymentId,
      sha,
      target,
      state,
      aliases,
      projectId: resolvedProjectId,
      gitOwner,
      gitRepo,
      gitRef,
      source,
      createdAt: Number(raw.createdAt ?? raw.created ?? 0) || null,
      url: String(raw.url ?? '').trim(),
    },
  };
}

function normalizeGitPath(path = '') {
  return String(path).replaceAll('\\', '/').replace(/^\.\/+/, '');
}

/**
 * Parse `git diff --name-status -z --find-renames BASE..HEAD`.
 * Rename/copy entries intentionally preserve BOTH old and new paths so moving a
 * runtime file into docs cannot erase the runtime change from classification.
 */
export function parseGitNameStatusZ(output = '') {
  const tokens = String(output).split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const paths = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) {
      throw new Error(`Untrusted git name-status token: ${JSON.stringify(status)}`);
    }
    const count = status[0] === 'R' || status[0] === 'C' ? 2 : 1;
    for (let offset = 0; offset < count; offset += 1) {
      const rawPath = tokens[index++];
      const path = normalizeGitPath(rawPath);
      if (!rawPath || !path || /[\r\n]/.test(path)) {
        throw new Error(`Untrusted path for git status ${status}`);
      }
      paths.push(path);
    }
  }

  return [...new Set(paths)];
}

/**
 * @param {string[]} args
 * @returns {GitRunResult}
 */
function defaultRunGit(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

/**
 * Build complete local Git comparison evidence without GitHub Compare's
 * changed-file cap. The runner must fetch both commits first; missing shallow
 * history is treated as untrusted evidence, never silently as docs-only.
 *
 * @param {{ baseSha?: string, headSha?: string, runGit?: RunGit }} [input]
 */
export function collectGitRangeEvidence(input = {}) {
  const { baseSha, headSha, runGit = defaultRunGit } = input;
  const base = normalizeSha(baseSha);
  const head = normalizeSha(headSha);
  const empty = {
    comparisonBaseSha: base,
    currentSha: head,
    comparisonBaseIsAncestor: false,
    changedPathsComplete: false,
    changedPaths: [],
    error: null,
  };

  if (!isValidSha(base) || !isValidSha(head)) {
    return { ...empty, error: 'UNTRUSTED_SHA' };
  }

  for (const sha of [base, head]) {
    const exists = runGit(['cat-file', '-e', `${sha}^{commit}`]);
    if (exists.error || exists.status !== 0) {
      return { ...empty, error: `MISSING_COMMIT:${sha}` };
    }
  }

  const ancestor = runGit(['merge-base', '--is-ancestor', base, head]);
  if (ancestor.error || ![0, 1].includes(ancestor.status)) {
    return { ...empty, error: 'ANCESTRY_CHECK_FAILED' };
  }
  if (ancestor.status === 1) {
    return { ...empty, error: 'BASE_NOT_ANCESTOR' };
  }

  const diff = runGit(['diff', '--name-status', '-z', '--find-renames', `${base}..${head}`]);
  if (diff.error || diff.status !== 0) {
    return {
      ...empty,
      comparisonBaseIsAncestor: true,
      error: 'GIT_DIFF_FAILED',
    };
  }

  try {
    return {
      ...empty,
      comparisonBaseIsAncestor: true,
      changedPathsComplete: true,
      changedPaths: parseGitNameStatusZ(diff.stdout),
    };
  } catch {
    return {
      ...empty,
      comparisonBaseIsAncestor: true,
      error: 'GIT_DIFF_PARSE_FAILED',
    };
  }
}

/**
 * Provider-contact-free orchestration. A future workflow supplies the already
 * fetched Vercel alias response and GitHub check state; this module validates the
 * baseline, gathers local Git evidence, and calls the pure decision policy.
 *
 * @param {{
 *   productionAliasPayload?: any,
 *   owner?: string,
 *   repo?: string,
 *   ref?: string,
 *   hostname?: string,
 *   projectId?: string,
 *   currentSha?: string,
 *   latestMainSha?: string,
 *   checksState?: string,
 *   runGit?: RunGit,
 * }} [input]
 */
export function buildProductionDeployEvidence(input = {}) {
  const {
    productionAliasPayload,
    owner,
    repo,
    ref = 'main',
    hostname,
    projectId,
    currentSha,
    latestMainSha = currentSha,
    checksState,
    runGit = defaultRunGit,
  } = input;
  const baselineResult = normalizeProductionAliasDeployment(productionAliasPayload, {
    owner,
    repo,
    ref,
    hostname,
    projectId,
  });

  if (!baselineResult.valid) {
    return {
      schemaVersion: 1,
      baseline: null,
      baselineErrors: baselineResult.errors,
      comparison: null,
      decision: {
        action: 'BLOCK',
        reason: 'PRODUCTION_BASELINE_UNTRUSTED',
      },
    };
  }

  const baseline = baselineResult.deployment;
  const preliminary = decideProductionDeployCandidate({
    currentSha,
    latestMainSha,
    lastProductionSha: baseline.sha,
    comparisonBaseSha: baseline.sha,
    checksState,
    comparisonBaseIsAncestor: undefined,
    changedPathsComplete: undefined,
    changedPaths: null,
  });

  // Stale, pending/failed, or already-deployed decisions happen before a range
  // comparison is relevant. Avoid unnecessary Git work in those cases.
  if (preliminary.reason !== 'UNTRUSTED_COMPARISON_ANCESTRY') {
    return {
      schemaVersion: 1,
      baseline,
      baselineErrors: [],
      comparison: null,
      decision: preliminary,
    };
  }

  const comparison = collectGitRangeEvidence({
    baseSha: baseline.sha,
    headSha: currentSha,
    runGit,
  });
  const decision = decideProductionDeployCandidate({
    currentSha,
    latestMainSha,
    lastProductionSha: baseline.sha,
    comparisonBaseSha: comparison.comparisonBaseSha,
    checksState,
    comparisonBaseIsAncestor: comparison.comparisonBaseIsAncestor,
    changedPathsComplete: comparison.changedPathsComplete,
    changedPaths: comparison.changedPaths,
  });

  return {
    schemaVersion: 1,
    baseline,
    baselineErrors: [],
    comparison,
    decision,
  };
}
