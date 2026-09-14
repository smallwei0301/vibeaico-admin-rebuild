import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.yml', '.yaml']);
const ALLOWED_WRITE_ENDPOINT_FILES = new Set([
  'scripts/db/controlled-production-db-release.mjs',
  'scripts/db/run-migrations.mjs',
]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

/** @param {string} root @param {string} dir @param {Record<string,string>} out */
function walk(root, dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, path, out);
    else if (SCANNED_EXTENSIONS.has(extname(entry.name))) out[relative(root, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8');
  }
}

/** @returns {Record<string,string>} */
export function collectProductionDbExecutableSources(repoRoot = process.cwd()) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const path of ['scripts', '.github/workflows']) walk(repoRoot, join(repoRoot, path), out);
  return out;
}

function hasWriteEndpoint(source) {
  return /\/database\/query(?!\/read-only)/.test(source);
}

function assertLegacyTestRunnerCannotWriteProduction(source) {
  const environmentGuard = source.indexOf("targetEnvironment === 'PRODUCTION'");
  const guardFailure = source.indexOf('PRODUCTION_CONTROLLED_WRITER_REQUIRED');
  const execution = source.lastIndexOf('executeMigrationPlan({');
  if (environmentGuard < 0 || guardFailure <= environmentGuard || execution <= guardFailure) {
    fail('LEGACY_RUNNER_PRODUCTION_GUARD_MISSING', 'run-migrations Production fail-closed guard must execute before migration apply');
  }
}

function assertFingerprintToolIsReadOnly(source) {
  if (!source.includes('/database/query/read-only')) fail('FINGERPRINT_READ_ONLY_ENDPOINT_MISSING', 'schema fingerprint tool must use read-only endpoint');
  if (!source.includes('SCHEMA_OBSERVER_TOKEN')) fail('FINGERPRINT_OBSERVER_TOKEN_MISSING', 'schema fingerprint tool must use observer credential');
  if (!source.includes('拒絕 broad SUPABASE_ACCESS_TOKEN fallback')) fail('FINGERPRINT_BROAD_TOKEN_GUARD_MISSING', 'schema fingerprint tool must reject broad-token fallback');
}

/** @param {Record<string,string>} sources */
export function auditProductionDbWriterBypasses(sources = {}) {
  const writeEndpointFiles = [];
  const broadTokenConsumers = [];

  for (const [path, sourceValue] of Object.entries(sources)) {
    const source = String(sourceValue);
    if (hasWriteEndpoint(source)) writeEndpointFiles.push(path);
    if (/process\.env\.SUPABASE_ACCESS_TOKEN/.test(source) && path !== 'scripts/db/run-migrations.mjs' && path !== 'scripts/db/schema-fingerprint-diff.mjs') {
      broadTokenConsumers.push(path);
    }
    if (/secrets\.SUPABASE_ACCESS_TOKEN/.test(source)) broadTokenConsumers.push(path);
  }

  const unexpectedWriters = writeEndpointFiles.filter((path) => !ALLOWED_WRITE_ENDPOINT_FILES.has(path));
  if (unexpectedWriters.length) fail('UNAPPROVED_PRODUCTION_DB_WRITE_PATH', `unapproved Management API write endpoint: ${unexpectedWriters.join(', ')}`);
  if (broadTokenConsumers.length) fail('BROAD_SUPABASE_TOKEN_CONSUMER', `broad SUPABASE_ACCESS_TOKEN is consumed by: ${[...new Set(broadTokenConsumers)].join(', ')}`);

  const legacy = sources['scripts/db/run-migrations.mjs'];
  if (!legacy) fail('LEGACY_RUNNER_MISSING', 'run-migrations source is unavailable');
  assertLegacyTestRunnerCannotWriteProduction(String(legacy));

  const fingerprint = sources['scripts/db/schema-fingerprint-diff.mjs'];
  if (!fingerprint) fail('FINGERPRINT_TOOL_MISSING', 'schema-fingerprint-diff source is unavailable');
  assertFingerprintToolIsReadOnly(String(fingerprint));

  const controlled = String(sources['scripts/db/controlled-production-db-release.mjs'] ?? '');
  if (!controlled || !hasWriteEndpoint(controlled)) fail('CONTROLLED_WRITER_MISSING', 'controlled Production writer endpoint is unavailable');
  if (controlled.includes('SUPABASE_ACCESS_TOKEN')) fail('CONTROLLED_WRITER_BROAD_TOKEN_REFERENCE', 'controlled writer must not reference broad SUPABASE_ACCESS_TOKEN');

  return {
    status: 'PRODUCTION_DB_WRITE_BYPASS_AUDIT_CLEAN',
    writeEndpointFiles: writeEndpointFiles.sort(),
    broadTokenConsumers: [],
    databaseMutationAuthorized: false,
  };
}

if (process.argv[1]?.endsWith('production-db-writer-bypass-audit.mjs')) {
  try {
    console.log(JSON.stringify(auditProductionDbWriterBypasses(collectProductionDbExecutableSources()), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
