import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.yml', '.yaml']);
const AUDIT_SOURCE_PATH = 'scripts/agents/production-db-writer-bypass-audit.mjs';
const G3_POST_TEST_SCHEMA_PATH = 'scripts/agents/production-db-g3-post-test-schema.mjs';
const ALLOWED_WRITE_ENDPOINT_FILES = new Set([
  'scripts/db/controlled-production-db-release.mjs',
  'scripts/db/run-migrations.mjs',
  'scripts/db/validate-production-db-release-on-test.mjs',
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

function assertReleaseTestValidatorCannotWriteProduction(source) {
  if (!source.includes("const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';")) {
    fail('G3_TEST_PROJECT_PIN_MISSING', 'release TEST validator must pin canonical TEST');
  }
  if (!source.includes("const PRODUCTION_PROJECT_REF = 'egehnijjpgijmccagxac';")) {
    fail('G3_PRODUCTION_PROJECT_GUARD_MISSING', 'release TEST validator must know the forbidden Production project');
  }
  if (!source.includes('PRODUCTION_TARGET_FORBIDDEN')) {
    fail('G3_PRODUCTION_FAIL_CLOSED_MISSING', 'release TEST validator must fail closed on Production target');
  }
  if (!source.includes('TEST_DB_RELEASE_TOKEN')) {
    fail('G3_SCOPED_TOKEN_NAME_MISSING', 'release TEST validator must use the dedicated TEST release token');
  }
  if (source.includes('SUPABASE_ACCESS_TOKEN')) {
    fail('G3_BROAD_TOKEN_REFERENCE', 'release TEST validator must not reference broad SUPABASE_ACCESS_TOKEN');
  }
  const executionStart = source.indexOf('async function executeAtomicTestRelease');
  const targetGuard = source.indexOf('assertTestReleaseTarget(projectRef);', executionStart);
  const writeEndpoint = source.indexOf('/database/query`', executionStart);
  if (executionStart < 0 || targetGuard <= executionStart || writeEndpoint <= targetGuard) {
    fail('G3_TEST_TARGET_GUARD_ORDER_INVALID', 'canonical TEST target guard must run before the mutable endpoint');
  }
}

function assertG3PostTestSchemaObserverRejectsBroadToken(source) {
  const broadRefs = source.match(/process\.env\.SUPABASE_ACCESS_TOKEN/g) ?? [];
  const exactReject = "if (process.env.SUPABASE_ACCESS_TOKEN) fail('BROAD_SCHEMA_TOKEN_FORBIDDEN'";
  if (broadRefs.length !== 1 || !source.includes(exactReject)) {
    fail('G3_POST_TEST_BROAD_TOKEN_GUARD_INVALID', 'post-TEST schema observer may reference broad SUPABASE_ACCESS_TOKEN exactly once, only to reject its presence');
  }
  if (!source.includes('SCHEMA_OBSERVER_TOKEN')) {
    fail('G3_POST_TEST_OBSERVER_TOKEN_MISSING', 'post-TEST schema capture must use SCHEMA_OBSERVER_TOKEN');
  }
  if (!source.includes("environment: 'TEST'")) {
    fail('G3_POST_TEST_PROJECT_PIN_MISSING', 'post-TEST schema capture must pin the TEST environment');
  }
  if (!source.includes("comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED'")) {
    fail('G3_POST_TEST_COMPARISON_BOUNDARY_MISSING', 'post-TEST schema capture must not claim the G2 comparison');
  }
  if (hasWriteEndpoint(source)) {
    fail('G3_POST_TEST_WRITE_ENDPOINT_FORBIDDEN', 'post-TEST schema observer must not contain a Management API write endpoint');
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
    // This audit source contains the endpoint-matching regex as inert source text.
    // Exclude only this scanner file from endpoint discovery so it cannot classify
    // its own detector literal as a database writer. All other scripts/workflows
    // remain in the executable-surface scan.
    if (path !== AUDIT_SOURCE_PATH && hasWriteEndpoint(source)) writeEndpointFiles.push(path);
    const broadEnvReference = /process\.env\.SUPABASE_ACCESS_TOKEN/.test(source);
    if (
      broadEnvReference &&
      path !== 'scripts/db/run-migrations.mjs' &&
      path !== 'scripts/db/schema-fingerprint-diff.mjs' &&
      path !== G3_POST_TEST_SCHEMA_PATH
    ) {
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

  const g3Validator = sources['scripts/db/validate-production-db-release-on-test.mjs'];
  if (!g3Validator) fail('G3_TEST_VALIDATOR_MISSING', 'release TEST validator source is unavailable');
  assertReleaseTestValidatorCannotWriteProduction(String(g3Validator));

  const postTestSchema = sources[G3_POST_TEST_SCHEMA_PATH];
  if (!postTestSchema) fail('G3_POST_TEST_SCHEMA_OBSERVER_MISSING', 'post-TEST schema observer source is unavailable');
  assertG3PostTestSchemaObserverRejectsBroadToken(String(postTestSchema));

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
