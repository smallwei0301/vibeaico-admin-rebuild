#!/usr/bin/env node
// #298: real PostgreSQL counterexamples on the disposable clean-schema runner only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MIGRATION = 'supabase/migrations/0102_assignment_tenant_parent_keys.sql';
const A = 'a1000000-0000-4000-8000-000000000001';
const B = 'b2000000-0000-4000-8000-000000000001';
const DEP = '7a000000-0000-4000-8000-000000000021';
const SA = 'f2980000-0000-4000-8000-000000000001';
const SB = 'f2980000-0000-4000-8000-000000000002';
const ROW = 'f2980000-0000-4000-8000-000000000003';

export function assertDisposableTarget(env, evidence, sql) {
  if (env.TEST_PROFILE !== 'LOCAL_ISOLATED' || env.TEST_TOUR_SEED_PROFILE !== 'CANONICAL_CORE'
      || !/^schema-proof-[a-z0-9-]{1,50}$/.test(env.LOCAL_PROJECT_ID ?? '')
      || !/^[0-9a-f]{40}$/.test(env.EXPECTED_HEAD ?? '')) throw new Error('UNSAFE_SCHEMA_PROOF_IDENTITY');
  const url = new URL(env.TEST_SUPABASE_URL ?? '');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('UNSAFE_SCHEMA_PROOF_URL');
  }
  const input = evidence?.files?.find((entry) => entry.sourcePath === MIGRATION);
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  if (evidence?.observedHead !== env.EXPECTED_HEAD || evidence?.remoteDatabaseUsed !== false
      || evidence?.candidateOverlayIncluded !== false || evidence?.canonicalApproved !== false
      || !input || input.sha256 !== digest) throw new Error('UNVERIFIED_SCHEMA_PROOF_SOURCE');
}

const fixtures = `
INSERT INTO public.staff(id,tenant_id,name) VALUES
('${SA}','${A}','I298 isolated guide A'), ('${SB}','${B}','I298 isolated guide B');
`;
const weakKeys = `
ALTER TABLE public.trip_departure_staff DROP CONSTRAINT trip_departure_staff_tenant_id_staff_id_fkey;
ALTER TABLE public.trip_departure_staff DROP CONSTRAINT trip_departure_staff_tenant_id_departure_id_fkey;
ALTER TABLE public.staff DROP CONSTRAINT staff_tenant_id_id_key;
ALTER TABLE public.trip_departure_staff ADD CONSTRAINT trip_departure_staff_staff_id_fkey
 FOREIGN KEY(staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT;
ALTER TABLE public.trip_departure_staff ADD CONSTRAINT trip_departure_staff_departure_id_fkey
 FOREIGN KEY(departure_id) REFERENCES public.trip_departures(id) ON DELETE CASCADE;
`;
const badAssignment = `INSERT INTO public.trip_departure_staff(id,tenant_id,departure_id,staff_id,role)
 VALUES('${ROW}','${A}','${DEP}','${SB}','ASSISTANT');`;
const assertStrong = `
DO $proof$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM pg_constraint c WHERE c.conrelid='public.trip_departure_staff'::regclass
 AND c.contype='f' AND c.confrelid IN ('public.staff'::regclass,'public.trip_departures'::regclass)
 AND cardinality(c.conkey)=2 AND cardinality(c.confkey)=2 AND c.convalidated AND NOT c.condeferrable;
 IF n<>2 THEN RAISE EXCEPTION 'PROOF_MISSING_COMPOSITE_KEYS'; END IF;
 IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid='public.trip_departure_staff'::regclass
 AND c.contype='f' AND c.confrelid IN ('public.staff'::regclass,'public.trip_departures'::regclass))<>2
 THEN RAISE EXCEPTION 'PROOF_AMBIGUOUS_RELATIONSHIPS'; END IF;
END $proof$;`;
const dmlProof = `
${fixtures}
INSERT INTO public.trip_departure_staff(id,tenant_id,departure_id,staff_id,role)
 VALUES('${ROW}','${A}','${DEP}','${SA}','ASSISTANT');
DO $proof$ DECLARE rejected boolean; BEGIN
 rejected:=false;
 BEGIN INSERT INTO public.trip_departure_staff(tenant_id,departure_id,staff_id,role)
 VALUES('${A}','${DEP}','${SB}','ASSISTANT');
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'PROOF_CROSS_TENANT_STAFF_ACCEPTED'; END IF;
 rejected:=false;
 BEGIN INSERT INTO public.trip_departure_staff(tenant_id,departure_id,staff_id,role)
 VALUES('${B}','${DEP}','${SB}','ASSISTANT');
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'PROOF_CROSS_TENANT_DEPARTURE_ACCEPTED'; END IF;
 rejected:=false;
 BEGIN UPDATE public.trip_departure_staff SET tenant_id='${B}' WHERE id='${ROW}';
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'PROOF_REASSIGNMENT_ACCEPTED'; END IF;
 rejected:=false;
 BEGIN UPDATE public.staff SET tenant_id='${B}' WHERE id='${SA}';
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'PROOF_PARENT_REASSIGNMENT_ACCEPTED'; END IF;
 rejected:=false;
 BEGIN DELETE FROM public.staff WHERE id='${SA}';
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'PROOF_STAFF_DELETE_NOT_RESTRICTED'; END IF;
 DELETE FROM public.trip_departures WHERE id='${DEP}';
 IF EXISTS (SELECT 1 FROM public.trip_departure_staff WHERE id='${ROW}')
 THEN RAISE EXCEPTION 'PROOF_DEPARTURE_DELETE_NOT_CASCADED'; END IF;
END $proof$;
`;

export function buildCases(migration) {
  return [
    { name: 'fresh-schema-and-real-tenant-boundaries', sql: assertStrong + dmlProof },
    { name: 'existing-test-shape-idempotence', sql: migration + migration + assertStrong + dmlProof },
    { name: 'production-shaped-simple-keys-upgrade', sql: weakKeys + migration + assertStrong + dmlProof },
    { name: 'mixed-shape-upgrade', sql: `
      ALTER TABLE public.trip_departure_staff DROP CONSTRAINT trip_departure_staff_tenant_id_departure_id_fkey;
      ALTER TABLE public.trip_departure_staff ADD CONSTRAINT trip_departure_staff_departure_id_fkey
      FOREIGN KEY(departure_id) REFERENCES public.trip_departures(id) ON DELETE CASCADE;
      ` + migration + assertStrong + dmlProof },
    { name: 'dirty-data-must-not-be-repaired', sql: weakKeys + fixtures + badAssignment + migration,
      error: 'ASSIGNMENT_PARENT_KEYS_DATA_MISMATCH' },
    { name: 'unknown-delete-semantics-must-stop', sql: weakKeys + `
      ALTER TABLE public.trip_departure_staff DROP CONSTRAINT trip_departure_staff_staff_id_fkey;
      ALTER TABLE public.trip_departure_staff ADD CONSTRAINT trip_departure_staff_staff_id_fkey
      FOREIGN KEY(staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
      ` + migration, error: 'ASSIGNMENT_PARENT_KEYS_UNEXPECTED_FK' },
    { name: 'duplicate-relationship-must-stop', sql: `
      ALTER TABLE public.trip_departure_staff ADD CONSTRAINT i298_duplicate_staff_fk
      FOREIGN KEY(staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT;
      ` + migration, error: 'ASSIGNMENT_PARENT_KEYS_AMBIGUOUS' },
    { name: 'same-name-wrong-parent-key-must-stop', sql: weakKeys + `
      ALTER TABLE public.staff ADD CONSTRAINT staff_tenant_id_id_key UNIQUE(id);
      ` + migration, error: 'ASSIGNMENT_PARENT_KEYS_PARENT_KEY_COLLISION' },
    { name: 'weak-keys-accept-cross-tenant-positive-control', sql: weakKeys + fixtures + badAssignment },
  ];
}

async function main() {
  const env = process.env;
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const evidence = JSON.parse(fs.readFileSync(path.join(env.RUNNER_TEMP ?? '', 'schema-proof/candidate.json'), 'utf8'));
  assertDisposableTarget(env, evidence, sql);
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== env.EXPECTED_HEAD) {
    throw new Error('STALE_SCHEMA_PROOF_CHECKOUT');
  }
  const docker = ['exec', '-i', `supabase_db_${env.LOCAL_PROJECT_ID}`,
    'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'];
  const execute = (input) => spawnSync('docker', docker, { input, encoding: 'utf8', timeout: 60_000 });
  // Guard cleanup and unchanged privileges, policies, indexes, constraints and rows
  // after EVERY case, including expected failures. Only compact hashes leave psql.
  const fingerprint = `SELECT md5(jsonb_build_object(
    'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c
      WHERE c.conrelid IN ('public.staff'::regclass,'public.trip_departures'::regclass,'public.trip_departure_staff'::regclass)),
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_class c WHERE c.oid IN ('public.staff'::regclass,'public.trip_departures'::regclass,'public.trip_departure_staff'::regclass)),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p
      WHERE p.polrelid IN ('public.staff'::regclass,'public.trip_departures'::regclass,'public.trip_departure_staff'::regclass)),
    'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i
      WHERE i.indrelid IN ('public.staff'::regclass,'public.trip_departures'::regclass,'public.trip_departure_staff'::regclass)),
    'staff',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.staff s),
    'departures',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.trip_departures d),
    'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.trip_departure_staff a)
  )::text);`;
  const readFingerprint = () => {
    const result = execute(fingerprint);
    if (result.status !== 0 || !/^[0-9a-f]{32}$/.test(result.stdout.trim())) throw new Error('SCHEMA_PROOF_FINGERPRINT_FAILED');
    return result.stdout.trim();
  };
  const before = readFingerprint();
  const results = [];
  for (const item of buildCases(sql)) {
    const result = execute(`BEGIN; SET LOCAL statement_timeout='30s';\n${item.sql}\nROLLBACK;\n`);
    const ok = item.error ? result.status !== 0 && String(result.stderr ?? '').includes(item.error) : result.status === 0;
    if (!ok) throw new Error(`SCHEMA_PROOF_FAILED ${item.name}: ${result.error?.message ?? result.stderr}`);
    if (readFingerprint() !== before) throw new Error(`SCHEMA_PROOF_RESIDUE ${item.name}`);
    results.push({ name: item.name, result: 'PASS', rollbackVerified: true });
    console.log(`ASSIGNMENT_SCHEMA_PASS: ${item.name}`);
  }
  // Zero-row read still forces PostgREST to resolve both relationship paths.
  const url = `${env.TEST_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/trip_departure_staff?select=staff(name),trip_departures(id)&limit=0`;
  const key = env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('MISSING_DISPOSABLE_TEST_KEY');
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (response.status !== 200) throw new Error(`POSTGREST_RELATIONSHIP_PROOF_FAILED: HTTP ${response.status}`);
  const report = { version: 1, sourceHead: env.EXPECTED_HEAD, sourceManifestSha256: evidence.sourceManifestSha256,
    migration: MIGRATION, migrationSha256: crypto.createHash('sha256').update(sql).digest('hex'),
    remoteDatabaseUsed: false, cases: results, postgrestRelationshipResolution: 'PASS', cleanup: 'ROLLBACK_VERIFIED' };
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'schema-proof/assignment-parent-keys.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`ASSIGNMENT_SCHEMA_PROOF_PASS: ${results.length} cases; PostgREST PASS; rollback verified.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
