#!/usr/bin/env node

/**
 * Vercel Ignored Build Step.
 *
 * Vercel interprets exit code 0 as "ignore this build" and exit code 1 as
 * "continue building".  Keep the decision fail-safe: an unknown main comparison
 * builds rather than risking a skipped Product deployment.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const RUNTIME_PATHS = Object.freeze([
  'src',
  'public',
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  'postcss.config.mjs',
  'tailwind.config.ts',
  'tsconfig.json',
  'vercel.json',
  'scripts/ci/vercel-ignore-build.mjs',
]);

export function classifyVercelBranch(ref) {
  if (ref === 'main') return 'MAIN';
  if (ref.startsWith('preview/')) return 'EXPLICIT_PREVIEW';
  return 'BLOCKED';
}

export function decideVercelBuild({ ref, comparable, runtimeChanged }) {
  const mode = classifyVercelBranch(ref);
  if (mode === 'BLOCKED') return 'IGNORE';
  if (mode === 'EXPLICIT_PREVIEW') return 'BUILD';
  if (!comparable) return 'BUILD';
  return runtimeChanged ? 'BUILD' : 'IGNORE';
}

export function runVercelIgnoreCommand(env = process.env) {
  const ref = String(env.VERCEL_GIT_COMMIT_REF ?? '').trim();
  const currentSha = String(env.VERCEL_GIT_COMMIT_SHA ?? '').trim();
  const previousSha = String(env.VERCEL_GIT_PREVIOUS_SHA ?? '').trim();
  const mode = classifyVercelBranch(ref);

  if (mode === 'BLOCKED') {
    console.log(`[vercel-ignore] skip automatic deployment for branch: ${ref || '(unknown)'}`);
    return 0;
  }

  if (mode === 'EXPLICIT_PREVIEW') {
    console.log(`[vercel-ignore] build explicit acceptance branch: ${ref}`);
    return 1;
  }

  if (!currentSha || !previousSha) {
    console.log('[vercel-ignore] main comparison SHA unavailable; build fail-safe');
    return 1;
  }

  const diff = spawnSync(
    'git',
    ['diff', '--quiet', previousSha, currentSha, '--', ...RUNTIME_PATHS],
    { stdio: 'inherit' },
  );

  if (diff.error || (diff.status !== 0 && diff.status !== 1)) {
    console.log('[vercel-ignore] git diff could not be trusted; build fail-safe');
    return 1;
  }

  const decision = decideVercelBuild({
    ref,
    comparable: true,
    runtimeChanged: diff.status === 1,
  });

  if (decision === 'IGNORE') {
    console.log('[vercel-ignore] main changed only docs/tests/governance; skip full build');
    return 0;
  }

  console.log('[vercel-ignore] main contains runtime/build changes; continue deployment');
  return 1;
}

const directRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (directRun) {
  process.exitCode = runVercelIgnoreCommand();
}
