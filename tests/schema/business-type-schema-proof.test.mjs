import { test } from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { assertDisposableTarget, buildCases, MIGRATION } from '../../scripts/test/verify-business-type-schema.mjs';

const safeEnv = {
  TEST_PROFILE: 'LOCAL_ISOLATED', LOCAL_PROJECT_ID: 'schema-proof-0103',
  EXPECTED_HEAD: 'a'.repeat(40), TEST_SUPABASE_URL: 'http://127.0.0.1:54321',
};
const safeSql = '-- canonical business type contract';
const safeEvidence = {
  observedHead: safeEnv.EXPECTED_HEAD,
  remoteDatabaseUsed: false,
  candidateOverlayIncluded: false,
  canonicalApproved: false,
  files: [{ sourcePath: MIGRATION, sha256: crypto.createHash('sha256').update(safeSql).digest('hex') }],
};

test('accepts only the disposable local schema-proof target', () => {
  assert.doesNotThrow(() => assertDisposableTarget(safeEnv, safeEvidence, safeSql));
});

for (const [key, value] of [
  ['TEST_PROFILE', 'SHARED_CANONICAL'],
  ['LOCAL_PROJECT_ID', 'nmwhwngojosmagjuvxol'],
  ['LOCAL_PROJECT_ID', 'schema-proof-../production'],
  ['EXPECTED_HEAD', 'main'],
  ['TEST_SUPABASE_URL', 'https://example.supabase.co'],
  ['TEST_SUPABASE_URL', 'http://user:password@localhost:54321'],
  ['TEST_SUPABASE_URL', 'http://localhost:54321/proxy'],
]) test(`refuses unsafe ${key}`, () => {
  assert.throws(() => assertDisposableTarget({ ...safeEnv, [key]: value }, safeEvidence, safeSql));
});

test('refuses unverified candidate evidence or altered migration bytes', () => {
  assert.throws(() => assertDisposableTarget(safeEnv, { ...safeEvidence, remoteDatabaseUsed: true }, safeSql), /UNVERIFIED_BUSINESS_TYPE_PROOF_SOURCE/);
  assert.throws(() => assertDisposableTarget(safeEnv, safeEvidence, `${safeSql} altered`), /UNVERIFIED_BUSINESS_TYPE_PROOF_SOURCE/);
});

test('contains each contract and rollback counterexample', () => {
  const cases = buildCases('-- migration body');
  assert.equal(cases.length, 9);
  assert.equal(new Set(cases.map((item) => item.name)).size, cases.length);
  assert.deepEqual(cases.filter((item) => item.error).map((item) => item.error), [
    'BUSINESS_TYPE_INVALID_DATA',
    'BUSINESS_TYPE_COLUMN_SHAPE',
    'BUSINESS_TYPE_CHECK_NAME_COLLISION',
    'BUSINESS_TYPE_UNKNOWN_CHECK_SHAPE',
  ]);
  for (const name of [
    'missing-column-creates-exact-contract', 'exact-contract-is-idempotent',
    'differently-named-validated-check-is-preserved', 'no-check-adds-and-validates-canonical-check',
    'all-three-valid-values-and-one-invalid-value',
  ]) assert.ok(cases.some((item) => item.name === name));
  assert.ok(cases.find((item) => item.name === 'invalid-row-fails-and-rolls-back').sql.includes('NOT_A_TYPE'));
  assert.equal(MIGRATION, 'supabase/migrations/0103_tenants_business_type_contract.sql');
});


test('pins catalog deparsing and one-statement atomic locking', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /DO \$business_type\$/);
  assert.match(sql, /pg_get_constraintdef\(c\.oid, false\)/);
  assert.doesNotMatch(sql, /pg_get_constraintdef\(c\.oid, true\)/);
  assert.match(sql, /PERFORM set_config\('lock_timeout', '5s', true\)/);
  assert.match(sql, /PERFORM pg_advisory_xact_lock/);
  assert.match(sql, /LOCK TABLE public\.tenants IN SHARE ROW EXCLUSIVE MODE/);
  assert.doesNotMatch(sql, /^SELECT pg_advisory_xact_lock/m);
  const verifier = fs.readFileSync('scripts/test/verify-business-type-schema.mjs', 'utf8');
  assert.match(verifier, /'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t'/);
  assert.match(verifier, /'table_security'/);
  assert.match(verifier, /'policies'/);
  assert.match(verifier, /'rows'/);
});
