#!/usr/bin/env node
// #298: disposable PostgreSQL proof for canonical tenants.business_type only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MIGRATION = 'supabase/migrations/0103_tenants_business_type_contract.sql';
const VALUES = "ARRAY['LOCAL_SHOP'::text, 'GUIDE'::text, 'CLINIC'::text]";

export function assertDisposableTarget(env, evidence, sql) {
  if (env.TEST_PROFILE !== 'LOCAL_ISOLATED'
      || !/^schema-proof-[a-z0-9-]{1,50}$/.test(env.LOCAL_PROJECT_ID ?? '')
      || !/^[0-9a-f]{40}$/.test(env.EXPECTED_HEAD ?? '')) {
    throw new Error('UNSAFE_BUSINESS_TYPE_PROOF_IDENTITY');
  }
  const url = new URL(env.TEST_SUPABASE_URL ?? '');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('UNSAFE_BUSINESS_TYPE_PROOF_URL');
  }
  const input = evidence?.files?.find((entry) => entry.sourcePath === MIGRATION);
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  if (evidence?.observedHead !== env.EXPECTED_HEAD || evidence?.remoteDatabaseUsed !== false
      || evidence?.candidateOverlayIncluded !== false || evidence?.canonicalApproved !== false
      || !input || input.sha256 !== digest) {
    throw new Error('UNVERIFIED_BUSINESS_TYPE_PROOF_SOURCE');
  }
}

const fixture = `
INSERT INTO public.tenants (shop_code, name) VALUES
  ('i103-proof-a', 'I103 proof A'),
  ('i103-proof-b', 'I103 proof B'),
  ('i103-proof-c', 'I103 proof C');
`;
const reset = `ALTER TABLE public.tenants DROP COLUMN IF EXISTS business_type CASCADE;\n${fixture}`;
const exactColumn = "ALTER TABLE public.tenants ADD COLUMN business_type text NOT NULL DEFAULT 'LOCAL_SHOP'::text;";
const exactCheck = `CHECK (business_type = ANY (${VALUES}))`;
const contractProof = `
DO $proof$
DECLARE rejected boolean := false; n integer; v_type text; v_not_null boolean; v_default text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_not_null, v_default
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.tenants'::regclass
     AND a.attname = 'business_type'
     AND NOT a.attisdropped;
  IF NOT FOUND OR v_type <> 'text' OR NOT v_not_null
     OR v_default IS DISTINCT FROM '''LOCAL_SHOP''::text' THEN
    RAISE EXCEPTION 'PROOF_BUSINESS_TYPE_COLUMN_CONTRACT: type=% not_null=% default=%',
      coalesce(v_type, '<missing>'), coalesce(v_not_null::text, '<missing>'),
      coalesce(v_default, '<missing>');
  END IF;
  SELECT count(*) INTO n FROM pg_constraint c
   WHERE c.conrelid = 'public.tenants'::regclass AND c.contype = 'c' AND c.convalidated
     AND regexp_replace(pg_get_constraintdef(c.oid, false), '\\s+', '', 'g') =
       'CHECK((business_type=ANY(ARRAY[''LOCAL_SHOP''::text,''GUIDE''::text,''CLINIC''::text])))';
  IF n <> 1 THEN RAISE EXCEPTION 'PROOF_EXPECTED_ONE_VALIDATED_BUSINESS_TYPE_CHECK'; END IF;
  UPDATE public.tenants SET business_type = 'LOCAL_SHOP' WHERE shop_code = 'i103-proof-a';
  UPDATE public.tenants SET business_type = 'GUIDE' WHERE shop_code = 'i103-proof-b';
  UPDATE public.tenants SET business_type = 'CLINIC' WHERE shop_code = 'i103-proof-c';
  BEGIN
    UPDATE public.tenants SET business_type = 'NOT_A_TYPE' WHERE shop_code = 'i103-proof-c';
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'PROOF_INVALID_BUSINESS_TYPE_ACCEPTED'; END IF;
END
$proof$;`;

export function buildCases(migration) {
  return [
    { name: 'missing-column-creates-exact-contract', sql: migration + contractProof },
    { name: 'exact-contract-is-idempotent', sql: `${exactColumn}\nALTER TABLE public.tenants ADD CONSTRAINT tenants_business_type_check ${exactCheck};\n${migration}\n${contractProof}` },
    { name: 'differently-named-validated-check-is-preserved', sql: `${exactColumn}\nALTER TABLE public.tenants ADD CONSTRAINT i103_legacy_mode_check ${exactCheck};\n${migration}\n${contractProof}\nDO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='i103_legacy_mode_check') THEN RAISE EXCEPTION 'PROOF_RENAMED_CHECK_NOT_PRESERVED'; END IF; END $$;` },
    { name: 'no-check-adds-and-validates-canonical-check', sql: `${exactColumn}\n${migration}\n${contractProof}` },
    { name: 'invalid-row-fails-and-rolls-back', sql: `${exactColumn}\nUPDATE public.tenants SET business_type='NOT_A_TYPE' WHERE shop_code='i103-proof-a';\n${migration}`, error: 'BUSINESS_TYPE_INVALID_DATA' },
    { name: 'wrong-column-shape-fails', sql: "ALTER TABLE public.tenants ADD COLUMN business_type varchar(20) NOT NULL DEFAULT 'LOCAL_SHOP';\n" + migration, error: 'BUSINESS_TYPE_COLUMN_SHAPE' },
    { name: 'nullable-compatible-check-fails', sql: `${exactColumn.replace(' NOT NULL', '')}\nALTER TABLE public.tenants ADD CONSTRAINT i103_nullable_mode_check ${exactCheck};\n${migration}`, error: 'BUSINESS_TYPE_COLUMN_SHAPE' },
    { name: 'wrong-default-compatible-check-fails', sql: `${exactColumn.replace("'LOCAL_SHOP'", "'GUIDE'")}\nALTER TABLE public.tenants ADD CONSTRAINT i103_guide_default_check ${exactCheck};\n${migration}`, error: 'BUSINESS_TYPE_COLUMN_SHAPE' },
    { name: 'same-name-wrong-check-fails', sql: `${exactColumn}\nALTER TABLE public.tenants ADD CONSTRAINT tenants_business_type_check CHECK (business_type <> 'CLINIC');\n${migration}`, error: 'BUSINESS_TYPE_CHECK_NAME_COLLISION' },
    { name: 'unknown-business-type-check-shape-fails', sql: `${exactColumn}\nALTER TABLE public.tenants ADD CONSTRAINT i103_unknown_mode_check CHECK (business_type <> 'CLINIC');\n${migration}`, error: 'BUSINESS_TYPE_UNKNOWN_CHECK_SHAPE' },
    { name: 'all-three-valid-values-and-one-invalid-value', sql: migration + contractProof },
  ];
}

function main() {
  const env = process.env;
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const evidence = JSON.parse(fs.readFileSync(path.join(env.RUNNER_TEMP ?? '', 'schema-proof/candidate.json'), 'utf8'));
  assertDisposableTarget(env, evidence, sql);
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== env.EXPECTED_HEAD) {
    throw new Error('STALE_BUSINESS_TYPE_PROOF_CHECKOUT');
  }
  const docker = ['exec', '-i', `supabase_db_${env.LOCAL_PROJECT_ID}`,
    'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
  const execute = (input) => spawnSync('docker', docker, { input, encoding: 'utf8', timeout: 60_000 });
  const fingerprintSql = `SELECT md5(jsonb_build_object(
    'columns', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a
      WHERE a.attrelid='public.tenants'::regclass AND NOT a.attisdropped),
    'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c
      WHERE c.conrelid='public.tenants'::regclass),
    'table_security', (SELECT jsonb_build_object(
      'acl', r.relacl, 'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity)
      FROM pg_class r WHERE r.oid='public.tenants'::regclass),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p
      WHERE p.polrelid='public.tenants'::regclass),
    'rows', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.tenants t)
  )::text);`;
  const fingerprint = () => {
    const result = execute(fingerprintSql);
    if (result.status !== 0 || !/^[0-9a-f]{32}$/.test(result.stdout.trim())) throw new Error('BUSINESS_TYPE_PROOF_FINGERPRINT_FAILED');
    return result.stdout.trim();
  };
  const baseline = fingerprint();

  for (const item of buildCases(sql)) {
    const result = execute(`BEGIN; SET LOCAL lock_timeout='5s';\n${reset}\n${item.sql}\nROLLBACK;\n`);
    const passed = item.error
      ? result.status !== 0 && result.stderr.includes(item.error)
      : result.status === 0;
    if (!passed) throw new Error(`BUSINESS_TYPE_PROOF_FAILED ${item.name}: ${result.stderr}`);
    // Expected errors terminate their transaction with ON_ERROR_STOP; the psql process
    // closes it, and this separate read proves no schema or policy residue survived.
    if (fingerprint() !== baseline) throw new Error(`BUSINESS_TYPE_PROOF_ROLLBACK_RESIDUE ${item.name}`);
    console.log(`BUSINESS_TYPE_SCHEMA_PASS: ${item.name}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
