#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildProductionDeployEvidence } from './production-deploy-evidence.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const TERMINAL_FAILURES = new Set(['ERROR', 'CANCELED', 'CANCELLED', 'FAILED']);

function required(value, name) {
  const out = String(value ?? '').trim();
  if (!out) throw new Error(`${name} is required`);
  return out;
}

function fullSha(value, name) {
  const out = required(value, name).toLowerCase();
  if (!FULL_SHA.test(out)) throw new Error(`${name} must be a full 40-character Git SHA`);
  return out;
}

function deploymentOf(payload) {
  return payload?.deployment ?? payload ?? {};
}

function statusOf(payload) {
  const deployment = deploymentOf(payload);
  return String(deployment.readyState ?? deployment.state ?? deployment.status ?? '').toUpperCase();
}

function safeApiMessage(payload, fallback) {
  const message = payload?.error?.message ?? payload?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

export async function vercelJson({
  path,
  token,
  teamId,
  method = 'GET',
  body,
  fetchImpl = fetch,
}) {
  const auth = required(token, 'VERCEL_TOKEN');
  const team = required(teamId, 'VERCEL_TEAM_ID');
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetchImpl(`https://api.vercel.com${path}${separator}teamId=${encodeURIComponent(team)}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Vercel API ${method} ${path} failed (${response.status}): ${safeApiMessage(payload, 'unknown error')}`);
  }
  return payload;
}

export function verifyPreviewDeployment(payload, expected) {
  const deployment = deploymentOf(payload);
  const meta = deployment.meta ?? {};
  const projectId = deployment.project?.id ?? deployment.projectId ?? '';
  const errors = [];

  if (statusOf(deployment) !== 'READY') errors.push('PREVIEW_NOT_READY');
  if (String(deployment.target ?? '') === 'production') errors.push('PREVIEW_TARGET_IS_PRODUCTION');
  if (String(projectId) !== expected.projectId) errors.push('PREVIEW_PROJECT_MISMATCH');
  if (String(deployment.source ?? '') !== 'git') errors.push('PREVIEW_SOURCE_NOT_GIT');
  if (String(meta.githubCommitOrg ?? '') !== expected.owner) errors.push('PREVIEW_GIT_OWNER_MISMATCH');
  if (String(meta.githubCommitRepo ?? '') !== expected.repo) errors.push('PREVIEW_GIT_REPO_MISMATCH');
  if (String(meta.githubCommitSha ?? '').toLowerCase() !== expected.sha) errors.push('PREVIEW_GIT_SHA_MISMATCH');

  if (errors.length) {
    const error = new Error(`Preview canary identity check failed: ${errors.join(', ')}`);
    error.codes = errors;
    throw error;
  }

  return {
    deploymentId: required(deployment.id, 'preview deployment id'),
    url: required(deployment.url, 'preview deployment url'),
    projectId: String(projectId),
    source: String(deployment.source),
    target: deployment.target ?? null,
    sha: expected.sha,
  };
}

export async function createPreviewDeployment({
  token,
  teamId,
  projectId,
  projectName,
  owner,
  repo,
  sha,
  fetchImpl = fetch,
}) {
  const expectedSha = fullSha(sha, 'current SHA');
  return vercelJson({
    path: '/v13/deployments',
    token,
    teamId,
    method: 'POST',
    fetchImpl,
    body: {
      name: required(projectName, 'VERCEL_PROJECT_NAME'),
      project: required(projectId, 'VERCEL_PROJECT_ID'),
      gitSource: {
        type: 'github',
        org: required(owner, 'GITHUB_OWNER'),
        repo: required(repo, 'GITHUB_REPO'),
        ref: expectedSha,
      },
      meta: {
        deploymentController: 'issue-228-preview-canary',
        expectedMainSha: expectedSha,
      },
    },
  });
}

export async function waitForPreviewDeployment({
  deploymentId,
  token,
  teamId,
  expected,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  maxAttempts = 90,
  pollMs = 10_000,
}) {
  const id = required(deploymentId, 'preview deployment id');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const payload = await vercelJson({
      path: `/v13/deployments/${encodeURIComponent(id)}`,
      token,
      teamId,
      fetchImpl,
    });
    const state = statusOf(payload);
    if (state === 'READY') return verifyPreviewDeployment(payload, expected);
    if (TERMINAL_FAILURES.has(state)) throw new Error(`Preview canary ended in ${state}`);
    if (attempt < maxAttempts) await sleep(pollMs);
  }
  throw new Error(`Preview canary did not reach READY after ${maxAttempts} checks`);
}

export async function runProductionCutoverCanary({
  token,
  teamId,
  projectId,
  projectName,
  owner,
  repo,
  hostname,
  currentSha,
  latestMainSha,
  checksState,
  mode = 'observe',
  fetchImpl = fetch,
  runGit,
  sleep,
}) {
  const sha = fullSha(currentSha, 'CURRENT_SHA');
  const latest = fullSha(latestMainSha, 'LATEST_MAIN_SHA');
  if (!['observe', 'preview_canary'].includes(mode)) throw new Error(`Unsupported CANARY_MODE: ${mode}`);

  const productionAliasPayload = await vercelJson({
    path: `/v13/deployments/${encodeURIComponent(required(hostname, 'PRODUCTION_HOSTNAME'))}`,
    token,
    teamId,
    fetchImpl,
  });

  const evidence = buildProductionDeployEvidence({
    productionAliasPayload,
    owner: required(owner, 'GITHUB_OWNER'),
    repo: required(repo, 'GITHUB_REPO'),
    ref: 'main',
    hostname,
    projectId,
    currentSha: sha,
    latestMainSha: latest,
    checksState,
    ...(runGit ? { runGit } : {}),
  });

  if (['BLOCK', 'WAIT'].includes(evidence.decision.action)) {
    return {
      status: 'BLOCKED',
      mode,
      currentSha: sha,
      decision: evidence.decision,
      baseline: evidence.baseline ?? null,
      preview: null,
    };
  }

  if (mode === 'observe') {
    return {
      status: 'OBSERVED',
      mode,
      currentSha: sha,
      decision: evidence.decision,
      baseline: evidence.baseline ?? null,
      preview: null,
    };
  }

  const created = await createPreviewDeployment({
    token,
    teamId,
    projectId,
    projectName,
    owner,
    repo,
    sha,
    fetchImpl,
  });
  const deploymentId = required(deploymentOf(created).id, 'preview deployment id');
  const preview = await waitForPreviewDeployment({
    deploymentId,
    token,
    teamId,
    expected: { projectId, owner, repo, sha },
    fetchImpl,
    ...(sleep ? { sleep } : {}),
  });

  return {
    status: 'PREVIEW_CANARY_GREEN',
    mode,
    currentSha: sha,
    decision: evidence.decision,
    baseline: evidence.baseline ?? null,
    preview,
  };
}

async function main(env = process.env) {
  const result = await runProductionCutoverCanary({
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID,
    projectId: env.VERCEL_PROJECT_ID,
    projectName: env.VERCEL_PROJECT_NAME,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    hostname: env.PRODUCTION_HOSTNAME,
    currentSha: env.CURRENT_SHA,
    latestMainSha: env.LATEST_MAIN_SHA,
    checksState: env.CHECKS_STATE,
    mode: env.CANARY_MODE ?? 'observe',
  });

  const path = env.CANARY_RESULT_PATH ?? 'production-canary-result.json';
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (env.GITHUB_OUTPUT) {
    await writeFile(env.GITHUB_OUTPUT, [
      `canary_status=${result.status}`,
      `decision_action=${result.decision.action}`,
      `decision_reason=${result.decision.reason}`,
      `preview_deployment_id=${result.preview?.deploymentId ?? ''}`,
      '',
    ].join('\n'), { encoding: 'utf8', flag: 'a' });
  }
  console.log(`[production-canary] ${result.status} / ${result.decision.action}:${result.decision.reason}`);
  if (result.preview) console.log(`[production-canary] preview deployment verified: ${result.preview.deploymentId}`);
  if (result.status === 'BLOCKED') process.exitCode = 1;
}

const directRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directRun) {
  main().catch((error) => {
    console.error(`[production-canary] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
