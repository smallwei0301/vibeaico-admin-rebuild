#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const IDENTITY = /^(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)$/;
const MAIN_MIGRATION_PATH = /^supabase\/migrations\/(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const PROJECT_REFS = Object.freeze({
  TEST: 'nmwhwngojosmagjuvxol',
  PRODUCTION: 'egehnijjpgijmccagxac',
});
const LEDGER_STATES = new Set(['PRESENT', 'ABSENT', 'UNAVAILABLE']);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function assertKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SNAPSHOT', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\n') !== wanted.join('\n')) fail('UNKNOWN_OR_MISSING_FIELD', `${label} keys must be exactly: ${wanted.join(', ')}`);
}

function normalizeEvidenceRef(value) {
  if (typeof value !== 'string') fail('INVALID_EVIDENCE_REF', 'evidenceRef must be a string');
  const text = value.trim();
  if (text !== value || !/^[a-z][a-z0-9+.-]*:[A-Za-z0-9._/#:-]{1,299}$/i.test(text) || text.includes('://')) {
    fail('INVALID_EVIDENCE_REF', 'evidenceRef must be a compact non-secret evidence reference');
  }
  return text;
}

function normalizeIdentity(value, label) {
  if (typeof value !== 'string' || !IDENTITY.test(value)) fail('INVALID_MIGRATION_IDENTITY', `${label} must be NNNN_name`);
  return value;
}

function normalizeCurrentMainSha(value) {
  const mainSha = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(mainSha)) fail('INVALID_MAIN_SHA', 'currentMainSha must be a 40-character SHA');
  return mainSha;
}

export function normalizeMigrationIdentitySnapshot(value, expectedEnvironment, currentMainSha) {
  const mainSha = normalizeCurrentMainSha(currentMainSha);
  assertKeys(value, ['environment', 'projectRef', 'observedAt', 'observedMainSha', 'evidenceRef', 'ledgerState', 'identities'], 'snapshot');

  const environment = typeof value.environment === 'string' ? value.environment.trim().toUpperCase() : '';
  if (!Object.hasOwn(PROJECT_REFS, environment)) fail('INVALID_ENVIRONMENT', 'environment must be TEST or PRODUCTION');
  if (expectedEnvironment && environment !== expectedEnvironment) fail('ENVIRONMENT_MISMATCH', `expected ${expectedEnvironment}, got ${environment}`);

  const projectRef = typeof value.projectRef === 'string' ? value.projectRef.trim().toLowerCase() : '';
  if (projectRef !== PROJECT_REFS[environment]) fail('PROJECT_REF_MISMATCH', `expected ${environment} project ${PROJECT_REFS[environment]}`);

  if (typeof value.observedAt !== 'string' || !ISO_UTC.test(value.observedAt) || Number.isNaN(Date.parse(value.observedAt))) {
    fail('INVALID_OBSERVED_AT', 'observedAt must be an ISO UTC timestamp');
  }
  const observedMainSha = typeof value.observedMainSha === 'string' ? value.observedMainSha.trim().toLowerCase() : '';
  if (!SHA.test(observedMainSha) || observedMainSha !== mainSha) fail('STALE_MAIN_SHA', `snapshot does not match ${mainSha}`);

  const ledgerState = typeof value.ledgerState === 'string' ? value.ledgerState.trim().toUpperCase() : '';
  if (!LEDGER_STATES.has(ledgerState)) fail('INVALID_LEDGER_STATE', 'ledgerState must be PRESENT, ABSENT, or UNAVAILABLE');
  if (!Array.isArray(value.identities)) fail('INVALID_MIGRATION_IDENTITIES', 'identities must be an array');
  const identities = value.identities.map((item, index) => normalizeIdentity(item, `identities[${index}]`));
  if (new Set(identities).size !== identities.length) fail('DUPLICATE_IDENTITY', 'identities must be unique');
  if (ledgerState !== 'PRESENT' && identities.length > 0) fail('INVALID_LEDGER_STATE', `${ledgerState} requires an empty identities array`);

  return {
    environment,
    projectRef,
    observedAt: value.observedAt,
    observedMainSha,
    evidenceRef: normalizeEvidenceRef(value.evidenceRef),
    ledgerState,
    identities: [...identities].sort(),
  };
}

function mainIdentities(migrationManifest) {
  if (!migrationManifest || typeof migrationManifest !== 'object' || !Array.isArray(migrationManifest.files)) {
    fail('INVALID_MIGRATION_MANIFEST', 'migrationManifest.files must be an array');
  }
  const identities = migrationManifest.files.map((file, index) => {
    const match = typeof file?.path === 'string' ? MAIN_MIGRATION_PATH.exec(file.path) : null;
    if (!match) fail('INVALID_MAIN_MIGRATION_IDENTITY', `files[${index}] must be supabase/migrations/NNNN_name.sql`);
    return match[1];
  });
  if (new Set(identities).size !== identities.length) fail('DUPLICATE_MAIN_MIGRATION_IDENTITY', 'main migration identities must be unique');
  const prefixes = identities.map((identity) => identity.slice(0, 4));
  if (new Set(prefixes).size !== prefixes.length) fail('DUPLICATE_MAIN_MIGRATION_PREFIX', 'main migration prefixes must be unique');
  return identities.sort();
}

function isOutsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function readMigrationPaths(root, current = root) {
  const paths = [];
  for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, item.name);
    if (item.isSymbolicLink()) fail('MIGRATION_SYMLINK_REJECTED', `symlink is not allowed: ${absolute}`);
    if (item.isDirectory()) paths.push(...readMigrationPaths(root, absolute));
    else if (item.isFile() && item.name.endsWith('.sql')) paths.push(`supabase/migrations/${path.relative(root, absolute).split(path.sep).join('/')}`);
  }
  return paths;
}

function readMainMigrationManifest(repoRoot) {
  const repository = fs.realpathSync(path.resolve(repoRoot));
  const supabase = path.resolve(repository, 'supabase');
  const migrations = path.resolve(supabase, 'migrations');
  for (const candidate of [supabase, migrations]) {
    if (!fs.existsSync(candidate)) fail('MIGRATION_DIRECTORY_MISSING', candidate);
    const info = fs.lstatSync(candidate);
    if (info.isSymbolicLink()) fail('MIGRATION_SYMLINK_REJECTED', `symlink is not allowed: ${candidate}`);
    if (!info.isDirectory()) fail('MIGRATION_DIRECTORY_MISSING', candidate);
  }
  const realMigrations = fs.realpathSync(migrations);
  if (isOutsideRoot(repository, realMigrations)) fail('MIGRATION_DIRECTORY_OUTSIDE_REPO', realMigrations);
  return { files: readMigrationPaths(realMigrations).map((filePath) => ({ path: filePath })) };
}

function verifyExactRepositoryHead(repoRoot, currentMainSha) {
  const repository = path.resolve(repoRoot);
  const result = spawnSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) fail('GIT_HEAD_UNAVAILABLE', 'repoRoot must resolve a Git HEAD');
  const head = result.stdout.trim().toLowerCase();
  if (!SHA.test(head) || head !== currentMainSha) fail('STALE_REPOSITORY_HEAD', `repo HEAD ${head || '<invalid>'} does not match ${currentMainSha}`);
}

function comparisonState(ledgerState) {
  if (ledgerState === 'ABSENT') return 'LEDGER_ABSENT';
  if (ledgerState === 'UNAVAILABLE') return 'LEDGER_UNAVAILABLE';
  return 'COMPARED';
}

export function compareMigrationIdentitySnapshot({ snapshot, migrationManifest, currentMainSha }) {
  const normalized = normalizeMigrationIdentitySnapshot(snapshot, undefined, currentMainSha);
  const main = mainIdentities(migrationManifest);
  const ledgerByPrefix = new Map();
  for (const identity of normalized.identities) {
    const prefix = identity.slice(0, 4);
    ledgerByPrefix.set(prefix, [...(ledgerByPrefix.get(prefix) ?? []), identity]);
  }
  const mainByPrefix = new Map(main.map((identity) => [identity.slice(0, 4), identity]));
  const prefixes = [...new Set([...ledgerByPrefix.keys(), ...mainByPrefix.keys()])].sort();
  const entries = prefixes.flatMap((prefix) => {
    const ledgerIdentities = ledgerByPrefix.get(prefix) ?? [];
    const mainIdentity = mainByPrefix.get(prefix) ?? null;
    if (normalized.ledgerState !== 'PRESENT' || ledgerIdentities.length === 0) {
      return [{ prefix, ledgerIdentity: null, mainIdentity, status: 'MAIN_ONLY_FILE' }];
    }
    return ledgerIdentities.map((ledgerIdentity) => ({
      prefix,
      ledgerIdentity,
      mainIdentity,
      status: mainIdentity === null
        ? 'LEDGER_ONLY_IDENTITY'
        : ledgerIdentity === mainIdentity ? 'ON_MAIN_EXACT' : 'PREFIX_COLLISION_NAME_MISMATCH',
    }));
  });

  return {
    environment: normalized.environment,
    projectRef: normalized.projectRef,
    observedAt: normalized.observedAt,
    observedMainSha: normalized.observedMainSha,
    evidenceRef: normalized.evidenceRef,
    ledgerState: normalized.ledgerState,
    comparisonState: comparisonState(normalized.ledgerState),
    entries,
  };
}

export function compareMigrationIdentityAtRepo({ snapshot, repoRoot, currentMainSha }) {
  const mainSha = normalizeCurrentMainSha(currentMainSha);
  verifyExactRepositoryHead(repoRoot, mainSha);
  return compareMigrationIdentitySnapshot({
    snapshot,
    migrationManifest: readMainMigrationManifest(repoRoot),
    currentMainSha: mainSha,
  });
}

function parseCompareArguments(argv) {
  if (argv[0] !== 'compare') fail('INVALID_COMMAND', 'usage: compare --ledger-snapshot <file> --repo-root <dir> --current-main-sha <sha> --json-out <file>');
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--ledger-snapshot', '--repo-root', '--current-main-sha', '--json-out'].includes(key) || typeof value !== 'string' || Object.hasOwn(options, key)) {
      fail('INVALID_COMMAND', 'usage: compare --ledger-snapshot <file> --repo-root <dir> --current-main-sha <sha> --json-out <file>');
    }
    options[key] = value;
  }
  for (const key of ['--ledger-snapshot', '--repo-root', '--current-main-sha', '--json-out']) {
    if (!Object.hasOwn(options, key)) fail('INVALID_COMMAND', 'usage: compare --ledger-snapshot <file> --repo-root <dir> --current-main-sha <sha> --json-out <file>');
  }
  return options;
}

function readSnapshotFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch (error) {
    fail('INVALID_LEDGER_SNAPSHOT_JSON', error instanceof Error ? error.message : 'unable to read ledger snapshot');
  }
}

function writeJsonAtomically(filePath, value) {
  const destination = path.resolve(filePath);
  const directory = path.dirname(destination);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) fail('INVALID_OUTPUT_PATH', directory);
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function runCli() {
  const options = parseCompareArguments(process.argv.slice(2));
  const report = compareMigrationIdentityAtRepo({
    snapshot: readSnapshotFile(options['--ledger-snapshot']),
    repoRoot: options['--repo-root'],
    currentMainSha: options['--current-main-sha'],
  });
  writeJsonAtomically(options['--json-out'], report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
