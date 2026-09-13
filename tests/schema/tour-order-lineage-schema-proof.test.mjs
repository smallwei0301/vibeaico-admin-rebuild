import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { assertDisposableTarget, buildCases, MIGRATION } from '../../scripts/test/verify-tour-order-lineage-schema.mjs';

const sql = '-- exact local fixture';
const env = {
  TEST_PROFILE: 'LOCAL_ISOLATED', TEST_TOUR_SEED_PROFILE: 'CANONICAL_CORE',
  LOCAL_PROJECT_ID: 'schema-proof-396-1', EXPECTED_HEAD: 'a'.repeat(40),
  TEST_SUPABASE_URL: 'http://127.0.0.1:54321',
};
const evidence = () => ({ observedHead: env.EXPECTED_HEAD, remoteDatabaseUsed: false,
  candidateOverlayIncluded: false, canonicalApproved: false,
  files: [{ sourcePath: MIGRATION, sha256: crypto.createHash('sha256').update(sql).digest('hex') }],
});

test('allows only a pinned, verified disposable source', () => {
  assert.doesNotThrow(() => assertDisposableTarget(env, evidence(), sql));
});
for (const [key, value] of [
  ['TEST_PROFILE', 'SHARED_CANONICAL'], ['TEST_TOUR_SEED_PROFILE', 'OBSERVE'],
  ['LOCAL_PROJECT_ID', 'nmwhwngojosmagjuvxol'], ['LOCAL_PROJECT_ID', 'schema-proof-../../prod'],
  ['EXPECTED_HEAD', 'main'], ['TEST_SUPABASE_URL', 'https://egehnijjpgijmccagxac.supabase.co'],
  ['TEST_SUPABASE_URL', 'http://localhost.evil.example:54321'],
  ['TEST_SUPABASE_URL', 'http://user:password@localhost:54321'],
  ['TEST_SUPABASE_URL', 'http://localhost:54321/proxy'],
  ['TEST_SUPABASE_URL', 'http://localhost:54321/?remote=1'],
]) test(`refuses unsafe ${key}=${value}`, () => {
  assert.throws(() => assertDisposableTarget({ ...env, [key]: value }, evidence(), sql));
});
for (const [key, value] of [
  ['remoteDatabaseUsed', true], ['candidateOverlayIncluded', true],
  ['canonicalApproved', true], ['observedHead', 'b'.repeat(40)], ['files', []],
]) test(`refuses unverified evidence: ${key}`, () => {
  assert.throws(() => assertDisposableTarget(env, { ...evidence(), [key]: value }, sql), /UNVERIFIED/);
});
test('refuses modified migration bytes even when the SHA label matches', () => {
  assert.throws(() => assertDisposableTarget(env, evidence(), sql + '\n'), /UNVERIFIED/);
});

test('has both success and exact-error cases, including a weak-key positive control', () => {
  const cases = buildCases('DO $x$ BEGIN NULL; END $x$;');
  assert.equal(cases.length, 10);
  assert.equal(new Set(cases.map((item) => item.name)).size, cases.length);
  assert.equal(cases.filter((item) => item.error).length, 5);
  assert.equal(cases.filter((item) => !item.error).length, 5);
  for (const item of cases.filter((item) => item.error)) {
    assert.match(item.error, /^TOUR_ORDER_LINEAGE_/);
  }
  assert.deepEqual(
    cases.filter((item) => item.error).map((item) => item.error).sort(),
    [
      'TOUR_ORDER_LINEAGE_AMBIGUOUS_FK',
      'TOUR_ORDER_LINEAGE_COLUMN_SHAPE',
      'TOUR_ORDER_LINEAGE_CUSTOMER_SET_NULL_COLUMNS',
      'TOUR_ORDER_LINEAGE_DATA_MISMATCH',
      'TOUR_ORDER_LINEAGE_UNEXPECTED_FK',
    ].sort(),
  );
  assert.match(
    cases.find((item) => item.name.startsWith('weak-keys-accept')).sql,
    /INSERT INTO public\.tour_orders/,
  );
  assert.ok(cases.some((item) => item.name === 'nullable-trip-id-column-shape-must-stop'));
  assert.ok(cases.some((item) => item.name === 'customer-set-null-not-column-specific-must-stop'));
});

test('pins the migration path and the composite-key column shapes the proof relies on', () => {
  assert.equal(MIGRATION, 'supabase/migrations/0104_tour_order_lineage_keys.sql');
  const migrationSql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(migrationSql, /DO \$lineage\$/);
  // 父表先鎖、子表最後——與 create_tour_order 的寫入順序一致，不得回退成子先父後。
  assert.match(
    migrationSql,
    /LOCK TABLE public\.trips, public\.trip_plans, public\.trip_departures,\s*\n\s*public\.customers, public\.tour_orders\s*\n\s*IN SHARE ROW EXCLUSIVE MODE/,
  );
  assert.match(migrationSql, /TOUR_ORDER_LINEAGE_COLUMN_SHAPE/);
  assert.match(migrationSql, /TOUR_ORDER_LINEAGE_CUSTOMER_SET_NULL_COLUMNS/);
  assert.match(migrationSql, /confdelsetcols/);
});
