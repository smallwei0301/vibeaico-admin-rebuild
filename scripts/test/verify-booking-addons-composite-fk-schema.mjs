#!/usr/bin/env node
// #680: disposable PostgreSQL proof for the booking_addons performance staff FK expansion.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MIGRATION = 'supabase/migrations/0133_issue_680_booking_addons_composite_fk_expand.sql';

export function assertDisposableTarget(env, evidence, sql) {
  if (env.TEST_PROFILE !== 'LOCAL_ISOLATED'
      || !/^schema-proof-[a-z0-9-]{1,50}$/.test(env.LOCAL_PROJECT_ID ?? '')
      || !/^[0-9a-f]{40}$/.test(env.EXPECTED_HEAD ?? '')) {
    throw new Error('UNSAFE_BOOKING_ADDONS_FK_PROOF_IDENTITY');
  }
  const url = new URL(env.TEST_SUPABASE_URL ?? '');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('UNSAFE_BOOKING_ADDONS_FK_PROOF_URL');
  }
  const input = evidence?.files?.find((entry) => entry.sourcePath === MIGRATION);
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  if (evidence?.observedHead !== env.EXPECTED_HEAD || evidence?.remoteDatabaseUsed !== false
      || evidence?.candidateOverlayIncluded !== false || evidence?.canonicalApproved !== false
      || !input || input.sha256 !== digest) {
    throw new Error('UNVERIFIED_BOOKING_ADDONS_FK_PROOF_SOURCE');
  }
}

const A_STAFF = '68000000-0000-4000-8000-000000000011';
const B_STAFF = '68000000-0000-4000-8000-000000000012';

const reset = (shape, includeMismatch = false) => `
DO $fixture$
DECLARE
  a_tenant uuid;
  b_tenant uuid;
  fk record;
BEGIN
  -- The canonical seed has no cross-tenant staff guarantee. Insert an exact,
  -- rollback-scoped pair so this proof's positive and negative controls are deterministic.
  SELECT id INTO a_tenant FROM public.tenants ORDER BY id LIMIT 1;
  SELECT id INTO b_tenant FROM public.tenants ORDER BY id OFFSET 1 LIMIT 1;
  IF a_tenant IS NULL OR b_tenant IS NULL THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_FK_PROOF_REQUIRES_TWO_TENANTS';
  END IF;
  INSERT INTO public.staff (id, tenant_id, name) VALUES
    ('${A_STAFF}', a_tenant, 'I680 proof staff A'),
    ('${B_STAFF}', b_tenant, 'I680 proof staff B');

  FOR fk IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.booking_addons'::regclass AND contype='f'
  LOOP
    EXECUTE format('ALTER TABLE public.booking_addons DROP CONSTRAINT %I', fk.conname);
  END LOOP;
  DELETE FROM public.booking_addons;

  ${shape === 'single-only' ? `
  ALTER TABLE public.booking_addons
    ADD CONSTRAINT booking_addons_performance_staff_id_fkey
    FOREIGN KEY (performance_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
  ` : `
  -- This is the known TEST start shape. EXPAND retains it instead of performing a
  -- contract migration; the single FK below is added for runtime compatibility.
  ALTER TABLE public.booking_addons
    ADD CONSTRAINT booking_addons_tenant_id_performance_staff_id_fkey
    FOREIGN KEY (tenant_id, performance_staff_id)
    REFERENCES public.staff(tenant_id, id)
    ON DELETE SET NULL (performance_staff_id);
  `}

  ${includeMismatch ? `
  INSERT INTO public.booking_addons
    (tenant_id, booking_id, name, performance_mode, performance_staff_id)
  VALUES (a_tenant, gen_random_uuid(), 'cross-tenant precondition', 'INHERIT', '${B_STAFF}');
  ` : ''}
END
$fixture$;
`;

const proof = (expectedCompositeDelete) => `
DO $proof$
DECLARE
  a_tenant uuid;
  rejected boolean := false;
  perf_att smallint;
BEGIN
  SELECT tenant_id INTO a_tenant FROM public.staff WHERE id='${A_STAFF}';
  IF a_tenant IS NULL THEN RAISE EXCEPTION 'BOOKING_ADDONS_FK_PROOF_STAFF_FIXTURE_MISSING'; END IF;
  SELECT attnum INTO perf_att FROM pg_attribute
   WHERE attrelid='public.booking_addons'::regclass
     AND attname='performance_staff_id' AND NOT attisdropped;
  INSERT INTO public.booking_addons
    (tenant_id, booking_id, name, performance_mode, performance_staff_id)
  VALUES (a_tenant, gen_random_uuid(), 'same-tenant proof', 'INHERIT', '${A_STAFF}');
  BEGIN
    INSERT INTO public.booking_addons
      (tenant_id, booking_id, name, performance_mode, performance_staff_id)
    VALUES (a_tenant, gen_random_uuid(), 'cross-tenant proof', 'INHERIT', '${B_STAFF}');
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'BOOKING_ADDONS_FK_PROOF_CROSS_TENANT_ACCEPTED'; END IF;

  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid='public.booking_addons'::regclass
         AND c.contype='f' AND perf_att = ANY(c.conkey)) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid='public.booking_addons'::regclass
          AND c.conname='booking_addons_performance_staff_id_fkey'
          AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND c.confdeltype='n' AND c.confdelsetcols IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid='public.booking_addons'::regclass
          AND c.conname='booking_addons_tenant_id_performance_staff_id_fkey'
          AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND (
            (expectedCompositeDelete = 'NO_ACTION' AND c.confdeltype='a' AND c.confdelsetcols IS NULL)
            OR (expectedCompositeDelete = 'LEGACY_PARTIAL_SET_NULL' AND c.confdeltype='n' AND c.confdelsetcols=ARRAY[perf_att]::smallint[])
          )
     ) THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_FK_PROOF_IDENTITY_VALIDATION_OR_DELETE_ACTION';
  END IF;
  DELETE FROM public.staff WHERE id='${A_STAFF}' AND tenant_id=a_tenant;
  IF EXISTS (SELECT 1 FROM public.booking_addons
              WHERE name='same-tenant proof' AND performance_staff_id IS NOT NULL) THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_FK_PROOF_PARENT_DELETE_DID_NOT_CLEAR_STAFF';
  END IF;
END
$proof$;
`;

export function buildCases(migration) {
  return [
    { name: 'single-only-start-expands-to-both', sql: `${reset('single-only')}
${migration}
${proof('NO_ACTION')}` },
    { name: 'composite-only-start-expands-to-both', sql: `${reset('composite-only')}
${migration}
${proof('LEGACY_PARTIAL_SET_NULL')}` },
    {
      name: 'cross-tenant-existing-data-fails-closed',
      sql: `${reset('single-only', true)}
${migration}`,
      error: 'BOOKING_ADDONS_PERFORMANCE_STAFF_TENANT_MISMATCH',
    },
  ];
}

function main() {
  const env = process.env;
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const evidence = JSON.parse(fs.readFileSync(path.join(env.RUNNER_TEMP ?? '', 'schema-proof/candidate.json'), 'utf8'));
  assertDisposableTarget(env, evidence, sql);
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== env.EXPECTED_HEAD) {
    throw new Error('STALE_BOOKING_ADDONS_FK_PROOF_CHECKOUT');
  }
  const docker = ['exec', '-i', `supabase_db_${env.LOCAL_PROJECT_ID}`,
    'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
  const execute = (input) => spawnSync('docker', docker, { input, encoding: 'utf8', timeout: 60_000 });
  const results = [];
  for (const item of buildCases(sql)) {
    const result = execute(`BEGIN; SET LOCAL lock_timeout='5s';
${item.sql}
ROLLBACK;
`);
    const passed = item.error
      ? result.status !== 0 && result.stderr.includes(item.error)
      : result.status === 0;
    if (!passed) throw new Error(`BOOKING_ADDONS_FK_PROOF_FAILED ${item.name}: ${result.stderr}`);
    results.push({ name: item.name, result: 'PASS' });
    console.log(`BOOKING_ADDONS_FK_SCHEMA_PASS: ${item.name}`);
  }
  const report = {
    version: 1, sourceHead: env.EXPECTED_HEAD, migration: MIGRATION,
    migrationSha256: crypto.createHash('sha256').update(sql).digest('hex'),
    remoteDatabaseUsed: false, cases: results, cleanup: 'ROLLBACK_VERIFIED',
  };
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'schema-proof/booking-addons-composite-fk.json'),
    JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
