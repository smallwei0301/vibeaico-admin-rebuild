#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  ACL_METADATA_SQL,
  EXPECTED_PROJECT_REFS,
  MIGRATION_LEDGER_SQL,
  METADATA_QUERY_DIGEST,
  METADATA_QUERY_VERSION,
  PUBLIC_SCHEMA_METADATA_SQL,
  SURFACES,
  compareText,
  compareMetadataEvidence,
  normalizeMetadataEvidencePacket,
  sha256,
  stableStringify,
} from './schema-truth-evidence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const API = 'https://api.supabase.com';
export const READ_ONLY_QUERY_PATH = '/database/query/read-only';

export const READ_ONLY_QUERY_CONTRACTS = Object.freeze({
  metadata: PUBLIC_SCHEMA_METADATA_SQL,
  acl: ACL_METADATA_SQL,
  ledger: MIGRATION_LEDGER_SQL,
});

const SHA = /^[0-9a-f]{40}$/;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_READONLY_EVIDENCE', `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\n') !== wanted.join('\n')) {
    fail('INVALID_READONLY_EVIDENCE', `${label} keys must be exactly: ${wanted.join(', ')}`);
  }
}

function digest(value) {
  return { algorithm: 'SHA256', value: sha256(stableStringify(value)) };
}

function runGit(repoRoot, args, runner = spawnSync) {
  const result = runner('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail('GIT_COMMAND_FAILED', `git ${args.join(' ')} failed`);
  }
  return String(result.stdout ?? '');
}

export function refreshCanonicalMain(repoRoot = REPO_ROOT, runner = spawnSync) {
  runGit(repoRoot, ['fetch', '--quiet', 'origin', 'main'], runner);
  const sha = runGit(repoRoot, ['rev-parse', 'origin/main'], runner).trim().toLowerCase();
  if (!SHA.test(sha)) fail('INVALID_MAIN_SHA', 'origin/main did not resolve to a commit SHA');
  return sha;
}

export function resolveCaptureEnvironment(value) {
  const environment = String(value ?? '').trim().toUpperCase();
  if (environment === 'TEST' || environment === 'PRODUCTION') return environment;
  fail('INVALID_CAPTURE_ENVIRONMENT', 'environment must be TEST or PRODUCTION');
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail('UNPARSEABLE_READONLY_RESPONSE', `${label} did not return JSON`);
  }
}

function parseSnapshotCell(value, label) {
  const parsed = typeof value === 'string' ? parseJson(value, `${label}.snapshot`) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('INVALID_READONLY_EVIDENCE', `${label}.snapshot must be an object`);
  }
  return parsed;
}

function singleSnapshot(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    fail('INVALID_READONLY_EVIDENCE', `${label} must return exactly one snapshot row`);
  }
  assertExactKeys(rows[0], ['snapshot'], `${label}[0]`);
  return parseSnapshotCell(rows[0].snapshot, label);
}

function sortByCodeUnit(left, right) {
  const a = stableStringify(left);
  const b = stableStringify(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizePublicMetadataSnapshot(snapshot) {
  assertExactKeys(snapshot, ['counts', 'items'], 'metadataSnapshot');
  if (!snapshot.counts || typeof snapshot.counts !== 'object' || Array.isArray(snapshot.counts)) {
    fail('INVALID_READONLY_EVIDENCE', 'metadataSnapshot.counts must be an object');
  }
  if (!Array.isArray(snapshot.items)) {
    fail('INVALID_READONLY_EVIDENCE', 'metadataSnapshot.items must be an array');
  }

  for (const key of Object.keys(snapshot.counts)) {
    if (!SURFACES.includes(key)) fail('UNKNOWN_METADATA_SURFACE', `unknown count surface: ${key}`);
  }

  const grouped = Object.fromEntries(SURFACES.map((surface) => [surface, []]));
  for (const [index, item] of snapshot.items.entries()) {
    assertExactKeys(item, ['surface', 'key', 'value'], `metadataSnapshot.items[${index}]`);
    if (!SURFACES.includes(item.surface)) {
      fail('UNKNOWN_METADATA_SURFACE', `metadataSnapshot.items[${index}].surface is unknown`);
    }
    if (typeof item.key !== 'string' || !item.key || /[\0\r\n]/.test(item.key)) {
      fail('INVALID_METADATA_ITEM', `metadataSnapshot.items[${index}].key is invalid`);
    }
    if (typeof item.value !== 'string' || item.value.includes('\0')) {
      fail('INVALID_METADATA_ITEM', `metadataSnapshot.items[${index}].value is invalid`);
    }
    grouped[item.surface].push({ key: item.key, value: item.value });
  }

  const result = {};
  for (const surface of SURFACES) {
    const items = grouped[surface].sort(sortByCodeUnit);
    const keys = items.map((item) => item.key);
    if (new Set(keys).size !== keys.length) {
      fail('DUPLICATE_METADATA_ITEM', `${surface} contains a duplicate key`);
    }
    const declared = Object.prototype.hasOwnProperty.call(snapshot.counts, surface)
      ? snapshot.counts[surface]
      : 0;
    if (!Number.isInteger(declared) || declared < 0 || declared !== items.length) {
      fail('METADATA_COUNT_MISMATCH', `${surface} count does not match returned items`);
    }
    result[surface] = { count: items.length, digest: digest(items) };
  }
  return result;
}

function canonicalizePrivileges(value, label) {
  if (!Array.isArray(value)) fail('INVALID_READONLY_EVIDENCE', `${label} must be an array`);
  return value.map((item, index) => {
    assertExactKeys(item, ['grantee', 'privilege', 'grantable'], `${label}[${index}]`);
    return {
      grantee: item.grantee,
      privilege: typeof item.privilege === 'string' ? item.privilege.toUpperCase() : item.privilege,
      grantable: item.grantable,
    };
  }).sort((left, right) => compareText(`${left.grantee}|${left.privilege}`, `${right.grantee}|${right.privilege}`));
}

export function canonicalizeAclSnapshot(snapshot) {
  assertExactKeys(snapshot, ['tables', 'functions'], 'aclSnapshot');
  if (!Array.isArray(snapshot.tables) || !Array.isArray(snapshot.functions)) {
    fail('INVALID_READONLY_EVIDENCE', 'aclSnapshot tables/functions must be arrays');
  }

  const tables = snapshot.tables.map((table, index) => {
    assertExactKeys(
      table,
      ['schema', 'name', 'rowSecurity', 'forceRowSecurity', 'policyCount', 'privileges'],
      `aclSnapshot.tables[${index}]`,
    );
    return {
      schema: table.schema,
      name: table.name,
      rowSecurity: table.rowSecurity,
      forceRowSecurity: table.forceRowSecurity,
      policyCount: table.policyCount,
      privileges: canonicalizePrivileges(table.privileges, `aclSnapshot.tables[${index}].privileges`),
    };
  }).sort((left, right) => compareText(String(left.name), String(right.name)));

  const functions = snapshot.functions.map((fn, index) => {
    assertExactKeys(
      fn,
      ['schema', 'name', 'identityArguments', 'owner', 'securityDefiner', 'privileges'],
      `aclSnapshot.functions[${index}]`,
    );
    return {
      schema: fn.schema,
      name: fn.name,
      identityArguments: fn.identityArguments,
      owner: fn.owner,
      securityDefiner: fn.securityDefiner,
      privileges: canonicalizePrivileges(fn.privileges, `aclSnapshot.functions[${index}].privileges`),
    };
  }).sort((left, right) => compareText(`${left.name}(${left.identityArguments})`, `${right.name}(${right.identityArguments})`));

  return { tables, functions };
}

export function normalizeMigrationLedgerRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    fail('INVALID_READONLY_EVIDENCE', 'migration ledger must return at least one row');
  }
  const identities = rows.map((row, index) => {
    assertExactKeys(row, ['version', 'name'], `migrationLedgerRows[${index}]`);
    if (typeof row.version !== 'string' || typeof row.name !== 'string') {
      fail('INVALID_READONLY_EVIDENCE', `migrationLedgerRows[${index}] must preserve exact string identities`);
    }
    return { version: row.version, name: row.name };
  }).sort((left, right) => compareText(left.version, right.version) || compareText(left.name, right.name));

  return { state: 'PRESENT', identities, digest: digest(identities) };
}

export function buildMetadataEvidencePacket({
  environment,
  currentMainSha,
  metadataRows,
  aclRows,
  ledgerRows,
  observedAt = new Date().toISOString(),
}) {
  const target = resolveCaptureEnvironment(environment);
  const projectRef = EXPECTED_PROJECT_REFS[target];
  const metadataSnapshot = singleSnapshot(metadataRows, 'metadata');
  const aclSnapshot = singleSnapshot(aclRows, 'acl');
  const normalizedBase = {
    schemaVersion: 1,
    queryVersion: METADATA_QUERY_VERSION,
    queryDigest: METADATA_QUERY_DIGEST,
    environment: target,
    projectRef,
    observedAt,
    observedMainSha: String(currentMainSha ?? '').trim().toLowerCase(),
    evidenceRef: `supabase-readonly:${target.toLowerCase()}/${projectRef}/${observedAt.replace(/[-:.]/g, '')}`,
    migrationLedger: normalizeMigrationLedgerRows(ledgerRows),
    surfaces: normalizePublicMetadataSnapshot(metadataSnapshot),
    acl: canonicalizeAclSnapshot(aclSnapshot),
    rawDataIncluded: false,
  };
  const packet = { ...normalizedBase, captureDigest: digest(normalizedBase) };
  return normalizeMetadataEvidencePacket(packet, currentMainSha);
}

export async function executeReadOnlyContract({
  environment,
  contract,
  token,
  fetchImpl = fetch,
}) {
  const target = resolveCaptureEnvironment(environment);
  if (!token) fail('MISSING_READONLY_TOKEN', 'SUPABASE_READONLY_ACCESS_TOKEN is required');
  if (!Object.prototype.hasOwnProperty.call(READ_ONLY_QUERY_CONTRACTS, contract)) {
    fail('UNKNOWN_READONLY_CONTRACT', 'only checked-in metadata, acl, and ledger contracts are allowed');
  }
  const projectRef = EXPECTED_PROJECT_REFS[target];
  let response;
  try {
    response = await fetchImpl(`${API}/v1/projects/${projectRef}${READ_ONLY_QUERY_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: READ_ONLY_QUERY_CONTRACTS[contract] }),
    });
  } catch {
    fail('READONLY_QUERY_NETWORK_FAILURE', `${contract} query failed before a response was received`);
  }
  const text = await response.text();
  if (!response.ok) {
    fail('READONLY_QUERY_HTTP_FAILURE', `${contract} query failed with HTTP ${response.status}`);
  }
  const rows = parseJson(text, contract);
  if (!Array.isArray(rows)) fail('INVALID_READONLY_RESPONSE', `${contract} response must be an array`);
  return rows;
}

export async function captureEnvironmentEvidence({
  environment,
  currentMainSha,
  token,
  fetchImpl = fetch,
  observedAt = new Date().toISOString(),
}) {
  const target = resolveCaptureEnvironment(environment);
  const metadataRows = await executeReadOnlyContract({ environment: target, contract: 'metadata', token, fetchImpl });
  const aclRows = await executeReadOnlyContract({ environment: target, contract: 'acl', token, fetchImpl });
  const ledgerRows = await executeReadOnlyContract({ environment: target, contract: 'ledger', token, fetchImpl });
  return buildMetadataEvidencePacket({
    environment: target,
    currentMainSha,
    metadataRows,
    aclRows,
    ledgerRows,
    observedAt,
  });
}

export async function captureEnvironmentPair({
  currentMainSha,
  token,
  fetchImpl = fetch,
  observedAt = new Date().toISOString(),
}) {
  const testPacket = await captureEnvironmentEvidence({
    environment: 'TEST', currentMainSha, token, fetchImpl, observedAt,
  });
  const productionPacket = await captureEnvironmentEvidence({
    environment: 'PRODUCTION', currentMainSha, token, fetchImpl, observedAt,
  });
  return {
    testPacket,
    productionPacket,
    comparison: compareMetadataEvidence({ testPacket, productionPacket, currentMainSha }),
  };
}

async function main() {
  const mode = String(process.argv[2] ?? '').trim().toUpperCase();
  const token = process.env.SUPABASE_READONLY_ACCESS_TOKEN;
  if (!['TEST', 'PRODUCTION', 'BOTH'].includes(mode)) {
    console.error('[schema-truth-readonly] 用法：SUPABASE_READONLY_ACCESS_TOKEN=... node scripts/agents/schema-truth-readonly-capture.mjs TEST|PRODUCTION|BOTH');
    process.exitCode = 1;
    return;
  }
  try {
    const currentMainSha = refreshCanonicalMain();
    const output = mode === 'BOTH'
      ? await captureEnvironmentPair({ currentMainSha, token })
      : await captureEnvironmentEvidence({ environment: mode, currentMainSha, token });
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error('[schema-truth-readonly] 中止：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await main();
