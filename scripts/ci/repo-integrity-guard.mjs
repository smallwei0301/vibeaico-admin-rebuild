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
const MIGRATION_DIR = 'supabase/migrations/';
const MIGRATION_FILE = /^supabase\/migrations\/(\d{4})_[^/]+\.sql$/;

export function findStandaloneGitShas(path, content) {
  if (!SOURCE_EXTENSION.test(path)) return [];

  return String(content).split(/\r?\n/).flatMap((line, index) => (
    STANDALONE_SHA.test(line)
      ? [`${path}:${index + 1}: standalone 40-character Git SHA`]
      : []
  ));
}

function migrationIdentity(path) {
  const match = MIGRATION_FILE.exec(path);
  if (!match) return null;
  return { path, prefix: Number(match[1]), prefixText: match[1] };
}

export function findMigrationIntegrityIssues({
  trackedPaths,
  baselineTrackedPaths,
  modifiedPaths,
}) {
  const headPaths = (Array.isArray(trackedPaths) ? trackedPaths : [])
    .filter((path) => path.startsWith(MIGRATION_DIR));
  const basePaths = Array.isArray(baselineTrackedPaths)
    ? baselineTrackedPaths.filter((path) => path.startsWith(MIGRATION_DIR))
    : null;
  const modified = new Set(Array.isArray(modifiedPaths) ? modifiedPaths : []);
  const errors = [];

  const headIdentities = [];
  for (const path of headPaths) {
    const identity = migrationIdentity(path);
    if (!identity) {
      errors.push(`invalid migration filename: ${path} (expected NNNN_name.sql)`);
      continue;
    }
    headIdentities.push(identity);
  }

  const byPrefix = new Map();
  for (const identity of headIdentities) {
    const paths = byPrefix.get(identity.prefixText) || [];
    paths.push(identity.path);
    byPrefix.set(identity.prefixText, paths);
  }
  for (const [prefix, paths] of byPrefix) {
    if (paths.length > 1) {
      errors.push(`duplicate migration prefix on head: ${prefix} -> ${paths.sort().join(', ')}`);
    }
  }

  if (basePaths === null) return errors;

  const headSet = new Set(headPaths);
  const baseSet = new Set(basePaths);
  const baseIdentities = basePaths.map(migrationIdentity).filter(Boolean);
  const maxBasePrefix = baseIdentities.length > 0
    ? Math.max(...baseIdentities.map((identity) => identity.prefix))
    : -1;

  for (const path of basePaths) {
    if (!headSet.has(path)) {
      errors.push(`existing migration removed or renamed: ${path}`);
    }
  }

  for (const path of modified) {
    if (baseSet.has(path)) {
      errors.push(`existing migration modified in place: ${path}`);
    }
  }

  for (const identity of headIdentities) {
    if (baseSet.has(identity.path)) continue;
    if (identity.prefix <= maxBasePrefix) {
      errors.push(
        `new migration prefix must be greater than base max ${String(maxBasePrefix).padStart(4, '0')}: ` +
        `${identity.path}`,
      );
    }
  }

  return errors;
}

export function evaluateRepositoryIntegrity({
  trackedPaths,
  baselineTrackedCount,
  deletedPaths,
  shaFindings,
  baselineTrackedPaths,
  modifiedPaths,
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

  errors.push(...findMigrationIntegrityIssues({
    trackedPaths: paths,
    baselineTrackedPaths,
    modifiedPaths,
  }));
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
  const baselineTrackedPaths = gitLines('ls-tree', '-r', '--name-only', baseRevision);
  const baselineTrackedCount = baselineTrackedPaths.length;
  const deletedPaths = gitLines('diff', '--diff-filter=D', '--name-only', baseRevision, headRevision);
  const modifiedPaths = gitLines(
    'diff', '--diff-filter=M', '--name-only', baseRevision, headRevision,
    '--', MIGRATION_DIR,
  );
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
    baselineTrackedPaths,
    modifiedPaths,
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
