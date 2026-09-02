#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const REQUIRED_PATHS = [
  'package.json',
  'package-lock.json',
  'src/app/',
  'src/server/',
];

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/i;
const STANDALONE_SHA = /^\s*[0-9a-f]{40}\s*$/i;

export function findStandaloneGitShas(path, content) {
  if (!SOURCE_EXTENSION.test(path)) return [];

  return String(content).split(/\r?\n/).flatMap((line, index) => (
    STANDALONE_SHA.test(line)
      ? [`${path}:${index + 1}: standalone 40-character Git SHA`]
      : []
  ));
}

export function evaluateRepositoryIntegrity({
  trackedPaths,
  baselineTrackedCount,
  deletedPaths,
  shaFindings,
}) {
  const paths = Array.isArray(trackedPaths) ? trackedPaths : [];
  const deletions = Array.isArray(deletedPaths) ? deletedPaths : [];
  const findings = Array.isArray(shaFindings) ? shaFindings : [];
  const errors = [];

  for (const requiredPath of REQUIRED_PATHS) {
    const exists = requiredPath.endsWith('/')
      ? paths.some((path) => path.startsWith(requiredPath))
      : paths.includes(requiredPath);
    if (!exists) errors.push(`required path is missing: ${requiredPath}`);
  }

  const baselineCount = Number(baselineTrackedCount);
  const deletionRatio = baselineCount > 0 ? deletions.length / baselineCount : 1;
  if (deletions.length >= 50 || (deletions.length >= 10 && deletionRatio >= 0.2)) {
    errors.push(
      `unexpected mass deletion: ${deletions.length} files ` +
      `(${Math.round(deletionRatio * 100)}% of the baseline tree)`,
    );
  }

  errors.push(...findings);
  return { ok: errors.length === 0, errors };
}

function gitLines(...args) {
  const output = execFileSync('git', args, { encoding: 'utf8' }).trim();
  return output ? output.split('\n') : [];
}

function main() {
  const baseRevision = process.env.BASE_REVISION || 'HEAD^';
  const headRevision = process.env.HEAD_REVISION || 'HEAD';
  const trackedPaths = gitLines('ls-tree', '-r', '--name-only', headRevision);
  const baselineTrackedCount = gitLines('ls-tree', '-r', '--name-only', baseRevision).length;
  const deletedPaths = gitLines('diff', '--diff-filter=D', '--name-only', baseRevision, headRevision);
  const shaFindings = trackedPaths.flatMap((path) => {
    if (!SOURCE_EXTENSION.test(path)) return [];
    try {
      return findStandaloneGitShas(
        path,
        execFileSync('git', ['show', `${headRevision}:${path}`], { encoding: 'utf8' }),
      );
    } catch {
      return [`tracked source file cannot be read: ${path}`];
    }
  });

  const result = evaluateRepositoryIntegrity({
    trackedPaths,
    baselineTrackedCount,
    deletedPaths,
    shaFindings,
  });

  console.log(JSON.stringify({
    ...result,
    baseRevision,
    headRevision,
    trackedCount: trackedPaths.length,
    deletedCount: deletedPaths.length,
  }, null, 2));

  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
