#!/usr/bin/env node
// #396: real PostgreSQL counterexamples for tour_orders lineage keys, disposable runner only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MIGRATION = 'supabase/migrations/0104_tour_order_lineage_keys.sql';
const A = 'a3960000-0000-4000-8000-000000000001';
const B = 'b3960000-0000-4000-8000-000000000002';
const TRIP_A = 'd3960000-0000-4000-8000-000000000001';
const TRIP_B = 'd3960000-0000-4000-8000-000000000002';
const PLAN_A = 'e3960000-0000-4000-8000-000000000001';
const PLAN_B = 'e3960000-0000-4000-8000-000000000002';
const DEP_A = 'f3960000-0000-4000-8000-000000000001';
const DEP_B = 'f3960000-0000-4000-8000-000000000002';
const CUST_A = 'c3960000-0000-4000-8000-000000000001';
const CUST_B = 'c3960000-0000-4000-8000-000000000002';
const ORDER_A = '13960000-0000-4000-8000-000000000001';

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

// 實查兩座 Supabase（2026-09-13，見 0104 開頭的現況記錄）：正式庫的
// trips/trip_plans/trip_departures 三支 (tenant_id, id 系) 父鍵，早在 0067
// 就已經建立，而且 trip_plans_tenant_trip_id_id_key 被 0067 的
// trip_departures_tenant_trip_plan_fkey 依賴、trips_tenant_id_id_key 被
// trip_plans/trip_addons/trip_departures 的 tenant_trip_fkey 依賴——這三支鍵
// 在任何有 0067 之後 migration 的資料庫上都無法被 DROP（其他物件依賴它），
// 正式庫也確實一直帶著它們。正式庫真正缺的只有 customers_tenant_id_id_key
// （只有 0104 本身會建立它）。tour_orders 這邊則一直是帳本（0087）留下的
// 四條單欄 FK，直到 0104 才升級成複合鏈。這裡把已升級的 canonical TEST 拆回
// 「正式庫真正的形狀」（父鍵維持複合、tour_orders 四鍵降回單欄、customers
// 父鍵不存在），才能重演「升級」這件事本身，而不是重演一個沒有任何環境
// 有過的假形狀。
const weakKeys = `
ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_trip_fkey;
ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_trip_plan_fkey;
ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_trip_plan_departure_fkey;
ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_customer_fkey;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_tenant_id_id_key;
ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_trip_id_fkey
  FOREIGN KEY (trip_id) REFERENCES public.trips (id) ON DELETE RESTRICT;
ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES public.trip_plans (id) ON DELETE RESTRICT;
ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_departure_id_fkey
  FOREIGN KEY (departure_id) REFERENCES public.trip_departures (id) ON DELETE RESTRICT;
ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers (id) ON DELETE SET NULL;
`;
const fixtures = `
INSERT INTO public.tenants (id, shop_code, name) VALUES
  ('${A}', 'i396-proof-a', 'I396 proof A'), ('${B}', 'i396-proof-b', 'I396 proof B')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.customers (id, tenant_id, name) VALUES
  ('${CUST_A}', '${A}', 'I396 customer A'), ('${CUST_B}', '${B}', 'I396 customer B')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.trips (id, tenant_id, slug, title) VALUES
  ('${TRIP_A}', '${A}', 'i396-proof-trip-a', 'I396 proof trip A'),
  ('${TRIP_B}', '${B}', 'i396-proof-trip-b', 'I396 proof trip B')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.trip_plans (id, tenant_id, trip_id, slug, name, base_price, price_per_person) VALUES
  ('${PLAN_A}', '${A}', '${TRIP_A}', 'i396-proof-plan-a', 'I396 proof plan A', 0, 0),
  ('${PLAN_B}', '${B}', '${TRIP_B}', 'i396-proof-plan-b', 'I396 proof plan B', 0, 0)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.trip_departures (id, tenant_id, trip_id, plan_id, departs_on, capacity) VALUES
  ('${DEP_A}', '${A}', '${TRIP_A}', '${PLAN_A}', '2026-11-01', 10),
  ('${DEP_B}', '${B}', '${TRIP_B}', '${PLAN_B}', '2026-11-02', 10)
  ON CONFLICT (id) DO NOTHING;
`;
const goodOrder = `
INSERT INTO public.tour_orders
  (id, tenant_id, order_no, trip_id, plan_id, departure_id, customer_id, party_size, unit_price, total_amount, source)
VALUES
  ('${ORDER_A}', '${A}', 'I396-OK', '${TRIP_A}', '${PLAN_A}', '${DEP_A}', '${CUST_A}', 1, 0, 0, 'MANUAL');
`;
const badOrderTripCrossTenant = `
INSERT INTO public.tour_orders
  (tenant_id, order_no, trip_id, plan_id, departure_id, customer_id, party_size, unit_price, total_amount, source)
VALUES
  ('${A}', 'I396-BAD-TRIP', '${TRIP_B}', '${PLAN_B}', '${DEP_B}', NULL, 1, 0, 0, 'MANUAL');
`;
const assertStrong = `
DO $proof$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM pg_constraint c
   WHERE c.conrelid = 'public.tour_orders'::regclass AND c.contype = 'f'
     AND c.confrelid IN ('public.trips'::regclass, 'public.trip_plans'::regclass,
       'public.trip_departures'::regclass, 'public.customers'::regclass)
     AND cardinality(c.conkey) > 1 AND c.convalidated AND NOT c.condeferrable;
  IF n <> 4 THEN RAISE EXCEPTION 'PROOF_MISSING_COMPOSITE_KEYS: found %', n; END IF;
  IF (SELECT count(*) FROM pg_constraint c
      WHERE c.conrelid = 'public.tour_orders'::regclass AND c.contype = 'f') <> 5 THEN
    RAISE EXCEPTION 'PROOF_UNEXPECTED_FK_COUNT';
  END IF;
END $proof$;`;
const dmlProof = `
${fixtures}
${goodOrder}
DO $proof$ DECLARE rejected boolean; BEGIN
  rejected := false;
  BEGIN
    INSERT INTO public.tour_orders
      (tenant_id, order_no, trip_id, plan_id, departure_id, customer_id, party_size, unit_price, total_amount, source)
    VALUES ('${A}', 'I396-BAD-TRIP', '${TRIP_B}', '${PLAN_B}', '${DEP_B}', NULL, 1, 0, 0, 'MANUAL');
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'PROOF_CROSS_TENANT_TRIP_ACCEPTED'; END IF;

  rejected := false;
  BEGIN
    UPDATE public.tour_orders SET customer_id = '${CUST_B}' WHERE id = '${ORDER_A}';
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'PROOF_CROSS_TENANT_CUSTOMER_ACCEPTED'; END IF;

  -- 顧客被刪：只清 customer_id，tenant_id 不能被牽連清成 NULL。
  DELETE FROM public.customers WHERE id = '${CUST_A}';
  IF NOT EXISTS (SELECT 1 FROM public.tour_orders
      WHERE id = '${ORDER_A}' AND customer_id IS NULL AND tenant_id = '${A}') THEN
    RAISE EXCEPTION 'PROOF_CUSTOMER_SET_NULL_WRONG_SHAPE';
  END IF;

  rejected := false;
  BEGIN DELETE FROM public.trips WHERE id = '${TRIP_A}';
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'PROOF_TRIP_DELETE_NOT_RESTRICTED'; END IF;
END $proof$;
`;

export function buildCases(migration) {
  return [
    { name: 'fresh-schema-and-real-tenant-boundaries', sql: assertStrong + dmlProof },
    { name: 'existing-test-shape-idempotence', sql: migration + migration + assertStrong + dmlProof },
    { name: 'production-shaped-simple-keys-upgrade', sql: weakKeys + migration + assertStrong + dmlProof },
    { name: 'mixed-shape-upgrade-trips-already-strong', sql: `
      -- trips 這條保持複合（tenant_trip_fkey 不動），只把 plan/departure/customer
      -- 降回單欄——trip_plans_tenant_trip_id_id_key、
      -- trip_departures_tenant_trip_plan_id_id_key 兩支父鍵不能動：前者被 0067 的
      -- trip_departures_tenant_trip_plan_fkey 依賴，DROP 會炸 dependency error，
      -- 且兩支鍵在正式庫上本來就存在，不該被拆掉才能算「trips 已經是強形狀」。
      ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_trip_plan_fkey;
      ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_trip_plan_departure_fkey;
      ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_customer_fkey;
      ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_tenant_id_id_key;
      ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_plan_id_fkey
        FOREIGN KEY (plan_id) REFERENCES public.trip_plans (id) ON DELETE RESTRICT;
      ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_departure_id_fkey
        FOREIGN KEY (departure_id) REFERENCES public.trip_departures (id) ON DELETE RESTRICT;
      ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES public.customers (id) ON DELETE SET NULL;
      ` + migration + assertStrong + dmlProof },
    { name: 'dirty-data-must-not-be-repaired', sql: weakKeys + fixtures + badOrderTripCrossTenant + migration,
      error: 'TOUR_ORDER_LINEAGE_DATA_MISMATCH' },
    { name: 'unknown-delete-semantics-must-stop', sql: weakKeys + `
      ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_trip_id_fkey;
      ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_trip_id_fkey
        FOREIGN KEY (trip_id) REFERENCES public.trips (id) ON DELETE CASCADE;
      ` + migration, error: 'TOUR_ORDER_LINEAGE_UNEXPECTED_FK' },
    { name: 'duplicate-relationship-must-stop', sql: `
      ALTER TABLE public.tour_orders ADD CONSTRAINT i396_duplicate_trip_fk
        FOREIGN KEY (trip_id) REFERENCES public.trips (id) ON DELETE RESTRICT;
      ` + migration, error: 'TOUR_ORDER_LINEAGE_AMBIGUOUS_FK' },
    { name: 'nullable-trip-id-column-shape-must-stop', sql: weakKeys + `
      ALTER TABLE public.tour_orders ALTER COLUMN trip_id DROP NOT NULL;
      ` + migration, error: 'TOUR_ORDER_LINEAGE_COLUMN_SHAPE' },
    { name: 'customer-set-null-not-column-specific-must-stop', sql: `
      ALTER TABLE public.tour_orders DROP CONSTRAINT tour_orders_tenant_customer_fkey;
      ALTER TABLE public.tour_orders ADD CONSTRAINT tour_orders_tenant_customer_fkey
        FOREIGN KEY (tenant_id, customer_id) REFERENCES public.customers (tenant_id, id) ON DELETE SET NULL;
      ` + migration, error: 'TOUR_ORDER_LINEAGE_CUSTOMER_SET_NULL_COLUMNS' },
    { name: 'weak-keys-accept-cross-tenant-positive-control', sql: weakKeys + fixtures + badOrderTripCrossTenant },
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
  const fingerprint = `SELECT md5(jsonb_build_object(
    'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c
      WHERE c.conrelid IN ('public.tenants'::regclass, 'public.customers'::regclass,
        'public.trips'::regclass, 'public.trip_plans'::regclass, 'public.trip_departures'::regclass,
        'public.tour_orders'::regclass)),
    'tables', (SELECT jsonb_agg(jsonb_build_array(c.oid, c.relacl, c.relrowsecurity, c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_class c WHERE c.oid IN ('public.tour_orders'::regclass)),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid = 'public.tour_orders'::regclass),
    'tenants', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t WHERE t.shop_code LIKE 'i396-proof-%'),
    'customers', (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.customers c WHERE c.tenant_id IN ('${A}','${B}')),
    'trips', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.trips t WHERE t.tenant_id IN ('${A}','${B}')),
    'plans', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.trip_plans p WHERE p.tenant_id IN ('${A}','${B}')),
    'departures', (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.trip_departures d WHERE d.tenant_id IN ('${A}','${B}')),
    'orders', (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tour_orders o WHERE o.tenant_id IN ('${A}','${B}'))
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
    console.log(`TOUR_ORDER_LINEAGE_SCHEMA_PASS: ${item.name}`);
  }
  // Zero-row read still forces PostgREST to resolve all four relationship paths.
  const url = `${env.TEST_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/tour_orders?select=trips(id),trip_plans(id),trip_departures(id),customers(name)&limit=0`;
  const key = env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('MISSING_DISPOSABLE_TEST_KEY');
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (response.status !== 200) throw new Error(`POSTGREST_RELATIONSHIP_PROOF_FAILED: HTTP ${response.status}`);
  const report = { version: 1, sourceHead: env.EXPECTED_HEAD, sourceManifestSha256: evidence.sourceManifestSha256,
    migration: MIGRATION, migrationSha256: crypto.createHash('sha256').update(sql).digest('hex'),
    remoteDatabaseUsed: false, cases: results, postgrestRelationshipResolution: 'PASS', cleanup: 'ROLLBACK_VERIFIED' };
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'schema-proof/tour-order-lineage-keys.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`TOUR_ORDER_LINEAGE_SCHEMA_PROOF_PASS: ${results.length} cases; PostgREST PASS; rollback verified.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
