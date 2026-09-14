#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { compareThreeWaySchemaTruth } from './schema-truth-three-way.mjs';

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MIGRATION_PATH = /^supabase\/migrations\/\d{4}_[A-Za-z0-9._-]+\.sql$/;
const SURFACES = new Set(['columns', 'constraints', 'indexes', 'views', 'policies', 'routines', 'triggers']);
const TARGETS = new Set(['TEST', 'PRODUCTION']);
const CANONICAL_MAIN_REF = 'origin/main';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join('\n') !== expected.join('\n')) fail('UNKNOWN_OR_MISSING_FIELD', `${label} keys must be exactly: ${expected.join(', ')}`);
}

function normalizeSha(value, label = 'sha') {
  const sha = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(sha)) fail('INVALID_SHA', `${label} must be a 40-character commit SHA`);
  return sha;
}

function normalizeIso(value, label) {
  const text = String(value ?? '').trim();
  if (!ISO_UTC.test(text) || Number.isNaN(Date.parse(text))) fail('INVALID_TIMESTAMP', `${label} must be ISO UTC`);
  return text;
}

function normalizeCanonicalMigrationPath(value) {
  const normalized = String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!MIGRATION_PATH.test(normalized) || normalized.includes('/../') || normalized.includes('/./')) {
    fail('INVALID_MIGRATION_PATH', 'migration must be supabase/migrations/NNNN_name.sql');
  }
  return normalized;
}

function normalizeMainRef(value) {
  const ref = String(value ?? '').trim();
  if (ref !== CANONICAL_MAIN_REF) fail('INVALID_MAIN_REF', `mainRef must be ${CANONICAL_MAIN_REF}`);
  return ref;
}

function runGit(repoRoot, args, { binary = false } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: binary ? undefined : 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = binary ? Buffer.from(result.stderr ?? '').toString('utf8') : String(result.stderr ?? '');
    fail('GIT_COMMAND_FAILED', `git ${args.join(' ')} failed: ${detail.trim() || 'unknown error'}`);
  }
  return result.stdout;
}

function readMainFile(repoRoot, mainRef, migrationPath) {
  const result = spawnSync('git', ['-C', repoRoot, 'show', `${mainRef}:${migrationPath}`], {
    encoding: undefined,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail('MIGRATION_NOT_IN_CURRENT_MAIN', `${migrationPath} is not present in ${mainRef}`);
  }
  return Buffer.from(result.stdout);
}

export function admitCanonicalMigrationSource({
  repoRoot,
  migrationPath,
  targetEnvironment,
  mainRef = CANONICAL_MAIN_REF,
  expectedSha256 = null,
}) {
  const root = fs.realpathSync(path.resolve(repoRoot));
  const target = String(targetEnvironment ?? '').trim().toUpperCase();
  if (!TARGETS.has(target)) fail('INVALID_TARGET_ENVIRONMENT', 'targetEnvironment must be TEST or PRODUCTION');
  const relativePath = normalizeCanonicalMigrationPath(migrationPath);
  const canonicalMainRef = normalizeMainRef(mainRef);
  const currentMainSha = normalizeSha(String(runGit(root, ['rev-parse', canonicalMainRef])).trim(), 'current main SHA');
  const mainBytes = readMainFile(root, canonicalMainRef, relativePath);

  const localPath = path.resolve(root, relativePath);
  const relative = path.relative(root, localPath);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) fail('MIGRATION_OUTSIDE_REPO', relativePath);
  if (!fs.existsSync(localPath)) fail('LOCAL_MIGRATION_MISSING', relativePath);
  const info = fs.lstatSync(localPath);
  if (!info.isFile() || info.isSymbolicLink()) fail('LOCAL_MIGRATION_INVALID', `${relativePath} must be a regular file`);
  const realParent = fs.realpathSync(path.dirname(localPath));
  if (realParent !== path.dirname(localPath)) fail('MIGRATION_PARENT_SYMLINK_REJECTED', `${relativePath} parent directory must not be a symlink`);
  const realLocalPath = fs.realpathSync(localPath);
  const realRelative = path.relative(root, realLocalPath);
  if (realRelative.startsWith(`..${path.sep}`) || realRelative === '..' || path.isAbsolute(realRelative)) fail('MIGRATION_OUTSIDE_REPO', relativePath);
  const localBytes = fs.readFileSync(realLocalPath);
  if (!localBytes.equals(mainBytes)) fail('WORKTREE_MIGRATION_DIFFERS_FROM_MAIN', `${relativePath} bytes differ from ${canonicalMainRef}`);

  const digest = sha256(mainBytes);
  if (expectedSha256 !== null) {
    const expected = String(expectedSha256).trim().toLowerCase();
    if (!SHA256.test(expected)) fail('INVALID_EXPECTED_SHA256', 'expectedSha256 must be 64 lowercase hex characters');
    if (expected !== digest) fail('MIGRATION_DIGEST_MISMATCH', `${relativePath} does not match expected SHA256`);
  }

  return {
    schemaVersion: 1,
    status: 'SOURCE_ADMITTED',
    targetEnvironment: target,
    currentMainSha,
    mainRef: canonicalMainRef,
    migrationPath: relativePath,
    migrationSha256: digest,
    databaseMutationAuthorized: false,
  };
}

export function schemaTruthEntryDigest(surface, entry) {
  if (!SURFACES.has(surface)) fail('INVALID_SURFACE', `unsupported surface: ${surface}`);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('INVALID_ENTRY', 'schema truth entry must be an object');
  return sha256(Buffer.from(stableStringify({ surface, entry })));
}

function normalizeException(value, index, currentMainSha, nowMs) {
  const label = `exceptions[${index}]`;
  assertKeys(value, ['surface', 'key', 'entryDigest', 'issue', 'owner', 'reason', 'expiresAt', 'currentMainSha'], label);
  const surface = String(value.surface ?? '').trim();
  if (!SURFACES.has(surface)) fail('INVALID_EXCEPTION', `${label}.surface is invalid`);
  const key = String(value.key ?? '').trim();
  if (!key || key.length > 300 || /[\r\n]/.test(key)) fail('INVALID_EXCEPTION', `${label}.key is invalid`);
  const digest = String(value.entryDigest ?? '').trim().toLowerCase();
  if (!SHA256.test(digest)) fail('INVALID_EXCEPTION', `${label}.entryDigest must be SHA256`);
  const issue = String(value.issue ?? '').trim();
  if (!/^#\d+$/.test(issue)) fail('INVALID_EXCEPTION', `${label}.issue must be #number`);
  const owner = String(value.owner ?? '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) fail('INVALID_EXCEPTION', `${label}.owner is invalid`);
  const reason = String(value.reason ?? '').trim();
  if (!reason || reason.length > 500 || /[\r\n]/.test(reason)) fail('INVALID_EXCEPTION', `${label}.reason is invalid`);
  const expiresAt = normalizeIso(value.expiresAt, `${label}.expiresAt`);
  const exceptionMainSha = normalizeSha(value.currentMainSha, `${label}.currentMainSha`);
  if (exceptionMainSha !== currentMainSha) fail('STALE_EXCEPTION_MAIN_SHA', `${label} is not bound to current main`);
  return {
    surface,
    key,
    entryDigest: digest,
    issue,
    owner,
    reason,
    expiresAt,
    currentMainSha: exceptionMainSha,
    expired: Date.parse(expiresAt) <= nowMs,
  };
}

function snapshotAge(snapshot, label, currentMainSha, nowMs, maxAgeMs) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('INVALID_SNAPSHOT', `${label} snapshot is required`);
  const observedMainSha = normalizeSha(snapshot.observedMainSha, `${label}.observedMainSha`);
  if (observedMainSha !== currentMainSha) fail('STALE_MAIN_SHA', `${label} snapshot is not bound to current main`);
  const observedAt = normalizeIso(snapshot.observedAt, `${label}.observedAt`);
  const observedMs = Date.parse(observedAt);
  if (observedMs > nowMs + 5 * 60 * 1000) fail('FUTURE_EVIDENCE', `${label} evidence is too far in the future`);
  return { observedAt, ageMs: Math.max(0, nowMs - observedMs), stale: nowMs - observedMs > maxAgeMs };
}

function isCleanEntry(entry) {
  return entry.presence === 'ALL_THREE' && entry.definitionStatus === 'DEFINITION_MATCH';
}

function isExpectedPendingTest(entry) {
  return entry.presence === 'REPO_ONLY' && entry.definitionStatus === 'DEFINITION_NOT_COMPARABLE';
}

function isExpectedPendingProduction(entry) {
  return entry.presence === 'REPO_TEST' && entry.definitionStatus === 'DEFINITION_MATCH';
}

export function evaluateSchemaDriftPolicy({
  repoFixture,
  testSnapshot,
  productionSnapshot,
  currentMainSha,
  exceptions = [],
  now = new Date().toISOString(),
  maxEvidenceAgeMinutes = 60,
}) {
  const mainSha = normalizeSha(currentMainSha, 'currentMainSha');
  const nowIso = normalizeIso(now, 'now');
  const nowMs = Date.parse(nowIso);
  if (!Number.isInteger(maxEvidenceAgeMinutes) || maxEvidenceAgeMinutes < 1 || maxEvidenceAgeMinutes > 24 * 60) {
    fail('INVALID_EVIDENCE_AGE', 'maxEvidenceAgeMinutes must be an integer between 1 and 1440');
  }
  if (!Array.isArray(exceptions)) fail('INVALID_EXCEPTIONS', 'exceptions must be an array');
  const normalizedExceptions = exceptions.map((entry, index) => normalizeException(entry, index, mainSha, nowMs));
  const exceptionKeys = normalizedExceptions.map((entry) => `${entry.surface}\n${entry.key}\n${entry.entryDigest}`);
  if (new Set(exceptionKeys).size !== exceptionKeys.length) fail('DUPLICATE_EXCEPTION', 'exceptions must be unique');

  const maxAgeMs = maxEvidenceAgeMinutes * 60 * 1000;
  const evidence = {
    TEST: snapshotAge(testSnapshot, 'TEST', mainSha, nowMs, maxAgeMs),
    PRODUCTION: snapshotAge(productionSnapshot, 'PRODUCTION', mainSha, nowMs, maxAgeMs),
  };
  const report = compareThreeWaySchemaTruth({ repoFixture, testSnapshot, productionSnapshot, currentMainSha: mainSha });

  const expectedPendingTest = [];
  const expectedPendingProduction = [];
  const intentionalDifferences = [];
  const unknownDrift = [];
  const evidenceIncomplete = [];

  for (const surface of SURFACES) {
    const entries = report.surfaces?.[surface]?.entries;
    if (!Array.isArray(entries)) fail('INVALID_THREE_WAY_REPORT', `${surface}.entries is missing`);
    for (const entry of entries) {
      const digest = schemaTruthEntryDigest(surface, entry);
      const item = { surface, key: entry.key, presence: entry.presence, definitionStatus: entry.definitionStatus, entryDigest: digest };
      if (isCleanEntry(entry)) continue;
      if (entry.presence === 'REPO_UNVERIFIED') {
        evidenceIncomplete.push(item);
        continue;
      }
      if (isExpectedPendingTest(entry)) {
        expectedPendingTest.push(item);
        continue;
      }
      if (isExpectedPendingProduction(entry)) {
        expectedPendingProduction.push(item);
        continue;
      }
      const approved = normalizedExceptions.find((exception) => (
        !exception.expired && exception.surface === surface && exception.key === entry.key && exception.entryDigest === digest
      ));
      if (approved) intentionalDifferences.push({ ...item, issue: approved.issue, owner: approved.owner, expiresAt: approved.expiresAt });
      else unknownDrift.push(item);
    }
  }

  const staleEvidence = Object.entries(evidence).filter(([, value]) => value.stale).map(([environment, value]) => ({ environment, ...value }));
  let overall = 'MATCH';
  if (staleEvidence.length) overall = 'EVIDENCE_STALE';
  else if (evidenceIncomplete.length) overall = 'EVIDENCE_INCOMPLETE';
  else if (unknownDrift.length) overall = 'DRIFT_BLOCKED';
  else if (expectedPendingTest.length) overall = 'EXPECTED_PENDING_TEST';
  else if (expectedPendingProduction.length) overall = 'EXPECTED_PENDING_PRODUCTION';
  else if (intentionalDifferences.length) overall = 'INTENTIONAL_DIFFERENCE';

  return {
    schemaVersion: 1,
    currentMainSha: mainSha,
    evaluatedAt: nowIso,
    maxEvidenceAgeMinutes,
    overall,
    blocked: ['EVIDENCE_STALE', 'EVIDENCE_INCOMPLETE', 'DRIFT_BLOCKED'].includes(overall),
    evidence,
    expectedPendingTest,
    expectedPendingProduction,
    intentionalDifferences,
    unknownDrift,
    evidenceIncomplete,
    staleEvidence,
    expiredExceptions: normalizedExceptions.filter((entry) => entry.expired).map(({ expired, ...entry }) => entry),
    databaseMutationAuthorized: false,
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) fail('USAGE', `unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) fail('USAGE', `missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'admit-migration') {
    const result = admitCanonicalMigrationSource({
      repoRoot: args['repo-root'] ?? '.',
      migrationPath: args.migration,
      targetEnvironment: args.target,
      mainRef: args['main-ref'] ?? CANONICAL_MAIN_REF,
      expectedSha256: args['expected-sha256'] ?? null,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (args.command === 'drift-policy') {
    for (const required of ['repo-fixture', 'test-snapshot', 'production-snapshot', 'current-main-sha']) {
      if (!args[required]) fail('USAGE', `--${required} is required`);
    }
    const result = evaluateSchemaDriftPolicy({
      repoFixture: readJson(args['repo-fixture']),
      testSnapshot: readJson(args['test-snapshot']),
      productionSnapshot: readJson(args['production-snapshot']),
      currentMainSha: args['current-main-sha'],
      exceptions: args.exceptions ? readJson(args.exceptions).entries ?? [] : [],
      now: args.now ?? new Date().toISOString(),
      maxEvidenceAgeMinutes: args['max-age-minutes'] ? Number(args['max-age-minutes']) : 60,
    });
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (args['json-out']) fs.writeFileSync(path.resolve(args['json-out']), json);
    else process.stdout.write(json);
    if (result.blocked) process.exitCode = 2;
    return result;
  }
  fail('USAGE', 'commands: admit-migration | drift-policy');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
