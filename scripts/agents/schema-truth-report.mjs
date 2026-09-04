#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const PROJECT_REF = /^[a-z0-9]{6,32}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const OBJECT_KINDS = ['columns', 'constraints', 'views', 'indexes', 'policies', 'routines', 'triggers'];
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
  if (actual.join('\n') !== wanted.join('\n')) {
    fail('UNKNOWN_OR_MISSING_FIELD', `${label} keys must be exactly: ${wanted.join(', ')}`);
  }
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeDigest(value, label) {
  assertKeys(value, ['algorithm', 'value'], label);
  const algorithm = String(value.algorithm ?? '').trim().toUpperCase();
  const digest = String(value.value ?? '').trim().toLowerCase();
  const length = algorithm === 'MD5' ? 32 : algorithm === 'SHA256' ? 64 : 0;
  if (!length || !new RegExp(`^[0-9a-f]{${length}}$`).test(digest)) {
    fail('INVALID_DIGEST', `${label} must contain a valid MD5 or SHA256 digest`);
  }
  return { algorithm, value: digest };
}

function normalizeCount(value, label) {
  if (!Number.isInteger(value) || value < 0) fail('INVALID_COUNT', `${label} must be a non-negative integer`);
  return value;
}

function normalizeEvidenceRef(value, label) {
  const text = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9+.-]*:[A-Za-z0-9._/#:-]{1,299}$/i.test(text) || text.includes('://')) {
    fail('INVALID_EVIDENCE_REF', `${label} must be a compact non-secret evidence reference`);
  }
  return text;
}

function normalizeLedger(value, label) {
  assertKeys(value, ['state', 'count', 'latestVersion', 'latestName', 'versionsDigest', 'evidenceRef'], label);
  const state = String(value.state ?? '').trim().toUpperCase();
  if (!LEDGER_STATES.has(state)) fail('INVALID_LEDGER_STATE', `${label}.state is invalid`);
  const evidenceRef = normalizeEvidenceRef(value.evidenceRef, `${label}.evidenceRef`);
  if (state !== 'PRESENT') {
    if ([value.count, value.latestVersion, value.latestName, value.versionsDigest].some((item) => item !== null)) {
      fail('INVALID_LEDGER_STATE', `${state} requires count/latest/digest to be null`);
    }
    return { state, count: null, latestVersion: null, latestName: null, versionsDigest: null, evidenceRef };
  }
  const count = normalizeCount(value.count, `${label}.count`);
  const latestVersion = value.latestVersion === null ? null : String(value.latestVersion).trim();
  const latestName = value.latestName === null ? null : String(value.latestName).trim();
  if (count === 0 && (latestVersion !== null || latestName !== null)) fail('INVALID_LEDGER_STATE', `${label} count=0 requires null latest migration`);
  if (count > 0 && (!/^\d{8,20}$/.test(latestVersion ?? '') || !/^[A-Za-z0-9._-]{1,160}$/.test(latestName ?? ''))) {
    fail('INVALID_LEDGER_STATE', `${label} PRESENT requires latestVersion and latestName`);
  }
  return {
    state,
    count,
    latestVersion,
    latestName,
    versionsDigest: normalizeDigest(value.versionsDigest, `${label}.versionsDigest`),
    evidenceRef,
  };
}

function normalizeObservation(value, label) {
  assertKeys(value, ['type', 'subject', 'evidenceRef'], label);
  if (value.type !== 'OUT_OF_LEDGER') fail('INVALID_OBSERVATION', `${label}.type must be OUT_OF_LEDGER`);
  const subject = String(value.subject ?? '').trim();
  if (!subject || subject.length > 300 || /[\r\n|]/.test(subject)) fail('INVALID_OBSERVATION', `${label}.subject is invalid`);
  return { type: 'OUT_OF_LEDGER', subject, evidenceRef: normalizeEvidenceRef(value.evidenceRef, `${label}.evidenceRef`) };
}

export function normalizeSnapshot(value, expectedEnvironment, expectedMainSha) {
  assertKeys(value, ['schemaVersion', 'environment', 'observedAt', 'projectRef', 'observedMainSha', 'migrationLedger', 'objects', 'observations'], 'snapshot');
  if (value.schemaVersion !== 1) fail('INVALID_SNAPSHOT', 'schemaVersion must be 1');
  const environment = String(value.environment ?? '').trim().toUpperCase();
  if (environment !== expectedEnvironment) fail('ENVIRONMENT_MISMATCH', `expected ${expectedEnvironment}, got ${environment || '<empty>'}`);
  const observedAt = String(value.observedAt ?? '').trim();
  if (!ISO_UTC.test(observedAt) || Number.isNaN(Date.parse(observedAt))) fail('INVALID_OBSERVED_AT', 'observedAt must be an ISO UTC timestamp');
  const projectRef = String(value.projectRef ?? '').trim().toLowerCase();
  if (!PROJECT_REF.test(projectRef)) fail('INVALID_PROJECT_REF', 'projectRef is invalid');
  const observedMainSha = String(value.observedMainSha ?? '').trim().toLowerCase();
  if (!SHA.test(observedMainSha) || observedMainSha !== expectedMainSha) fail('STALE_MAIN_SHA', `${environment} snapshot does not match ${expectedMainSha}`);

  assertKeys(value.objects, OBJECT_KINDS, 'snapshot.objects');
  const objects = {};
  for (const kind of OBJECT_KINDS) {
    assertKeys(value.objects[kind], ['count', 'digest'], `snapshot.objects.${kind}`);
    objects[kind] = {
      count: normalizeCount(value.objects[kind].count, `snapshot.objects.${kind}.count`),
      digest: normalizeDigest(value.objects[kind].digest, `snapshot.objects.${kind}.digest`),
    };
  }
  if (!Array.isArray(value.observations)) fail('INVALID_OBSERVATION', 'observations must be an array');
  const observations = value.observations.map((item, index) => normalizeObservation(item, `observations[${index}]`));
  observations.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  if (new Set(observations.map(stableStringify)).size !== observations.length) fail('DUPLICATE_OBSERVATION', 'observations must be unique');

  return {
    schemaVersion: 1,
    environment,
    observedAt,
    projectRef,
    observedMainSha,
    migrationLedger: normalizeLedger(value.migrationLedger, 'snapshot.migrationLedger'),
    objects,
    observations,
  };
}

function normalizeMigrationPath(value) {
  const normalized = String(value).replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || !normalized.endsWith('.sql')) {
    fail('INVALID_MIGRATION_PATH', `invalid migration path: ${value}`);
  }
  return `supabase/migrations/${normalized}`;
}

export function buildMigrationManifestFromEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail('NO_MIGRATIONS', 'at least one migration SQL file is required');
  const files = entries.map((entry) => {
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes ?? '');
    return { path: normalizeMigrationPath(entry.path), bytes: bytes.length, sha256: sha256(bytes) };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (new Set(files.map((file) => file.path)).size !== files.length) fail('DUPLICATE_MIGRATION_PATH', 'migration paths must be unique');
  return { count: files.length, manifestDigest: sha256(Buffer.from(stableStringify(files))), files };
}

function readEntries(root, current = root) {
  const entries = [];
  for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const absolute = path.join(current, item.name);
    if (item.isSymbolicLink()) fail('MIGRATION_SYMLINK_REJECTED', `symlink is not allowed: ${absolute}`);
    if (item.isDirectory()) entries.push(...readEntries(root, absolute));
    else if (item.isFile() && item.name.endsWith('.sql')) entries.push({ path: path.relative(root, absolute), bytes: fs.readFileSync(absolute) });
  }
  return entries;
}

export function readMigrationManifest(repoRoot) {
  const root = path.resolve(repoRoot, 'supabase', 'migrations');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('MIGRATION_DIRECTORY_MISSING', root);
  return buildMigrationManifestFromEntries(readEntries(root));
}

function compareLedger(test, production) {
  if (test.state === 'UNAVAILABLE' || production.state === 'UNAVAILABLE') return 'LEDGER_UNAVAILABLE';
  if (test.state === 'ABSENT' || production.state === 'ABSENT') return 'LEDGER_ABSENT';
  return stableStringify({ count: test.count, latestVersion: test.latestVersion, latestName: test.latestName, versionsDigest: test.versionsDigest }) ===
    stableStringify({ count: production.count, latestVersion: production.latestVersion, latestName: production.latestName, versionsDigest: production.versionsDigest })
    ? 'MATCH' : 'ENVIRONMENT_DIFF';
}

export function buildSchemaTruthReport({ testSnapshot, productionSnapshot, migrationManifest, currentMainSha }) {
  const mainSha = String(currentMainSha ?? '').trim().toLowerCase();
  if (!SHA.test(mainSha)) fail('INVALID_MAIN_SHA', 'currentMainSha must be a 40-character SHA');
  const test = normalizeSnapshot(testSnapshot, 'TEST', mainSha);
  const production = normalizeSnapshot(productionSnapshot, 'PRODUCTION', mainSha);
  const objectComparison = {};
  for (const kind of OBJECT_KINDS) {
    objectComparison[kind] = stableStringify(test.objects[kind]) === stableStringify(production.objects[kind]) ? 'MATCH' : 'ENVIRONMENT_DIFF';
  }
  const ledgerStatus = compareLedger(test.migrationLedger, production.migrationLedger);
  const explicitOutOfLedger = [
    ...test.observations.map((item) => ({ environment: 'TEST', ...item })),
    ...production.observations.map((item) => ({ environment: 'PRODUCTION', ...item })),
  ].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  const incomplete = ledgerStatus === 'LEDGER_UNAVAILABLE';
  const differs = ledgerStatus !== 'MATCH' || Object.values(objectComparison).includes('ENVIRONMENT_DIFF') || explicitOutOfLedger.length > 0;
  const core = {
    schemaVersion: 1,
    observedMainSha: mainSha,
    repoMigrations: migrationManifest,
    environments: { TEST: test, PRODUCTION: production },
    comparison: {
      overall: incomplete ? 'EVIDENCE_INCOMPLETE' : differs ? 'DRIFT_OBSERVED' : 'MATCH',
      migrationLedger: ledgerStatus,
      publicObjects: objectComparison,
      explicitOutOfLedger,
    },
    safety: {
      productionMutationAuthorized: false,
      databaseConnectionUsedByReporter: false,
      rawTableDataIncluded: false,
    },
  };
  return { ...core, reportDigest: sha256(Buffer.from(stableStringify(core))) };
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}

export function renderMarkdown(report) {
  const rows = OBJECT_KINDS.map((kind) => {
    const test = report.environments.TEST.objects[kind];
    const production = report.environments.PRODUCTION.objects[kind];
    return `| ${kind} | ${test.count} | ${production.count} | ${report.comparison.publicObjects[kind]} |`;
  }).join('\n');
  const observations = report.comparison.explicitOutOfLedger.length
    ? report.comparison.explicitOutOfLedger.map((item) => `- ${item.environment}: ${markdownEscape(item.subject)} — \`${item.evidenceRef}\``).join('\n')
    : '- none';
  const ledger = (environment) => {
    const value = report.environments[environment].migrationLedger;
    return `| ${environment} | ${value.state} | ${value.count ?? 'null'} | ${value.latestVersion ?? 'null'} | ${value.latestName ?? 'null'} |`;
  };
  return `# Schema Truth Report\n\n- observed main: \`${report.observedMainSha}\`\n- report digest: \`${report.reportDigest}\`\n- overall: **${report.comparison.overall}**\n- repo migrations: ${report.repoMigrations.count} files / \`${report.repoMigrations.manifestDigest}\`\n\n## Migration ledger\n\n| Environment | State | Count | Latest version | Latest name |\n|---|---:|---:|---|---|\n${ledger('TEST')}\n${ledger('PRODUCTION')}\n\nComparison: **${report.comparison.migrationLedger}**\n\n## Public schema fingerprints\n\n| Kind | TEST count | Production count | Status |\n|---|---:|---:|---|\n${rows}\n\n## Explicit out-of-ledger evidence\n\n${observations}\n\n## Safety\n\nThis report is read-only evidence. It is **not** authorization to apply a Production migration, DDL, DML, promote, rollback, or force-push. Fingerprint differences identify a truth gap; they do not prove which environment is correct.\n`;
}

function gitHead(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) fail('GIT_HEAD_UNAVAILABLE', (result.stderr || result.stdout || 'git failed').trim());
  return result.stdout.trim().toLowerCase();
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const result = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--') || !rest[index + 1] || rest[index + 1].startsWith('--')) fail('INVALID_ARGUMENT', token);
    result[token.slice(2)] = rest[++index];
  }
  return result;
}

function writeAtomic(target, content) {
  const absolute = path.resolve(target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, absolute);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command !== 'report') fail('USAGE', 'schema-truth-report.mjs report --test-snapshot <json> --production-snapshot <json> --repo-root <path> --current-main-sha <sha> --json-out <json> --markdown-out <md>');
  for (const key of ['test-snapshot', 'production-snapshot', 'repo-root', 'current-main-sha', 'json-out', 'markdown-out']) {
    if (!args[key]) fail('MISSING_ARGUMENT', `--${key} is required`);
  }
  if (path.resolve(args['json-out']) === path.resolve(args['markdown-out'])) fail('OUTPUT_COLLISION', 'JSON and Markdown outputs must differ');
  const repoRoot = path.resolve(args['repo-root']);
  const currentMainSha = String(args['current-main-sha']).toLowerCase();
  if (gitHead(repoRoot) !== currentMainSha) fail('STALE_REPO_HEAD', 'checked-out git HEAD does not match --current-main-sha');
  const report = buildSchemaTruthReport({
    testSnapshot: JSON.parse(fs.readFileSync(path.resolve(args['test-snapshot']), 'utf8')),
    productionSnapshot: JSON.parse(fs.readFileSync(path.resolve(args['production-snapshot']), 'utf8')),
    migrationManifest: readMigrationManifest(repoRoot),
    currentMainSha,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  writeAtomic(args['json-out'], json);
  writeAtomic(args['markdown-out'], markdown);
  console.log(`SCHEMA_TRUTH_REPORT ${report.comparison.overall} ${report.reportDigest}`);
  return report;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
