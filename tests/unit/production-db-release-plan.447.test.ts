import { readFileSync } from 'node:fs';
import { ISSUE_46_CLOSURE_COVERAGE } from '../../scripts/agents/production-db-g3-authz-contracts.mjs';

import { describe, expect, it } from 'vitest';

import {
  buildProductionDbReleasePlan,
  inferMigrationRiskTier,
  orderPendingProductionMigrations,
  pendingProductionMigrations,
  selectedProductionMigrations,
  releasePlanDigestOf,
  verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';

const MAIN = 'a'.repeat(40);
const PLANNED_AT = '2026-09-14T12:30:00Z';

function aliasMap() {
  return {
    schemaVersion: 1,
    entries: [
      { repoFile: '0001_base', ledgerNames: ['0001_base'], classification: 'EXACT', evidence: 'x' },
      { repoFile: '0105_authz', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
      { repoFile: '0109_assertions', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
      { repoFile: '0099_never_apply', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'VERIFIED_NOT_APPLIED', evidence: 'x' },
    ],
  };
}

const sqlByPath: Record<string, string> = {
  'supabase/migrations/0105_authz.sql': 'alter table public.x enable row level security; grant select on public.x to authenticated;',
  'supabase/migrations/0109_assertions.sql': 'grant select on public.y to authenticated;',
};
const readCanonicalSql = (path: string) => sqlByPath[path];

describe('Production DB release plan #447', () => {
  it('admits only the fixed #589 ACL catalog readers in an immediate reconciliation block', () => {
    const sql = readFileSync('supabase/migrations/0127_issue_589_authz_constraint_reconciliation.sql', 'utf8');
    expect(inferMigrationRiskTier(sql, '0127_issue_589_authz_constraint_reconciliation')).toBe('AUTHZ');
    expect(() => inferMigrationRiskTier("do $$ begin perform untrusted_acl_helper(); end $$;", 'evil_acl')).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier("do $$ begin perform aclexplode(null); end $$;", 'unqualified_acl')).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier("do $$ begin perform public.acldefault('r', 1); end $$;", 'user_acl')).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(sql.replace('drop constraint if exists booking_addons_notified_check', 'drop column notified'), '0127_issue_589_authz_constraint_reconciliation')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(sql.replace('end\n$reconcile$;', 'truncate table public.booking_addons;\nend\n$reconcile$;'), '0127_issue_589_authz_constraint_reconciliation')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(sql.replace('end\n$reconcile$;', 'drop table public.unrelated;\nend\n$reconcile$;'), '0127_issue_589_authz_constraint_reconciliation')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(sql.replace('drop policy if exists p_booking_addons_i', 'drop policy if exists p_booking_addons_s'), '0127_issue_589_authz_constraint_reconciliation')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(sql.replace('end\n$reconcile$;', 'commit;\nend\n$reconcile$;'), '0127_issue_589_authz_constraint_reconciliation')).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM|UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(sql.replace('end\n$reconcile$;', 'update public.booking_addons set name = name;\nend\n$reconcile$;'), '0127_issue_589_authz_constraint_reconciliation')).toThrow(/MIXED_RISK_MIGRATION_NOT_ADMITTED/);
  });

  it.each([
    'do $$ begin update public.orders set state = state; end $$;',
    'do $$ begin if true then update public.orders set state = state; end if; end $$;',
    'do $$ begin for n in 1..1 loop update public.orders set state = state; end loop; end $$;',
  ])('keeps procedural DML classified as BACKFILL despite privilege-keyword filtering: %s', (sql) => {
    expect(inferMigrationRiskTier(sql, 'ordinary_do_backfill')).toBe('BACKFILL');
  });

  it.each(['btree', 'hash'])('preserves %s index syntax without trusting routine calls', (method) => {
    for (const sql of [
      `create index orders_id_idx on public.orders using ${method} (id);`,
      `CREATE INDEX IF NOT EXISTS "orders_idx" ON "public"."orders" USING ${method.toUpperCase()} /* method */ (id) WHERE (id > 0);`,
    ]) expect(inferMigrationRiskTier(sql), sql).toBe('ADDITIVE');
    for (const sql of [
      `create index orders_id_idx on public.orders using ${method} ((custom_routine(id)));`,
      `create index orders_id_idx on public.orders using ${method} (id) where custom_routine(id);`,
      `select ${method}(id) from public.orders;`,
    ]) expect(() => inferMigrationRiskTier(sql), sql)
      .toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
  });

  it('classifies partial-index ON CONFLICT predicates while checking their nested calls', () => {
    for (const predicate of ['id > 0', '(id > 0) and (id < 10)', 'exists (select 1)', '"do" > 0']) {
      for (const action of ['do nothing', 'do update set id = excluded.id']) {
        const sql = `insert into public.orders(id) values (1) on conflict (id) where ${predicate} ${action};`;
        expect(inferMigrationRiskTier(sql), sql).toBe('BACKFILL');
      }
    }
    for (const predicate of ['custom_routine(id)', '(hash(id) > 0)', 'exists (select "public".btree())']) {
      const sql = `insert into public.orders(id) values (1) on conflict (id) where ${predicate} do nothing;`;
      expect(() => inferMigrationRiskTier(sql), sql).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    }
    for (const sql of [
      'insert into public.orders(id) values (1) on conflict ((custom_routine(id))) where id > 0 do nothing;',
      'insert into public.orders(id) values (1) on conflict (id) where id > 0 do update set id = custom_routine(id);',
      'select 1 from public.orders join public.other on conflict() where id > 0;',
    ]) expect(() => inferMigrationRiskTier(sql), sql).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
  });

  // IDENT, unreserved_keyword and type_func_name_keyword are all callable
  // in PostgreSQL. Syntax-like spelling alone must never grant admission.
  it.each([
    'begin', 'brin', 'btree', 'conflict', 'declare', 'exception', 'exclude',
    'filter', 'gin', 'gist', 'hash', 'if', 'join', 'loop', 'over', 'partition',
    'raise', 'set', 'while', 'custom_routine',
  ])('rejects callable syntax-like name %s in every immediate query wrapper', (name) => {
    const declaration = `create function public.${name}() returns integer language plpgsql as \u0024\u0024 begin delete from public.orders; return 1; end; \u0024\u0024;`;
    for (const call of [`${name}()`, `${name.toUpperCase()} /* gap */ (1)`, `"${name}"()`, `"public".${name}()`]) {
      for (const query of [`select ${call};`, `(select ${call});`, `copy ((select ${call})) to stdout;`]) {
        expect(() => inferMigrationRiskTier(`${declaration} ${query}`), query)
          .toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
      }
    }
  });

  it.each([
    '(select "public".filter());',
    '( /* outer */ (select "public".filter()) );',
    'copy (select "public".filter()) to stdout;',
    'copy /* query */ ((select "public".filter())) to stdout;',
  ])('rejects routine calls inside query wrappers: %s', (query) => {
    expect(() => inferMigrationRiskTier(query)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
  });

  it.each(['filter()', 'FILTER (1)', 'filter /* comment */ ()'])('rejects unqualified keyword-named routine %s', (call) => {
    const sql = `create function public.filter() returns integer language plpgsql as \u0024\u0024 begin delete from public.orders; return 1; end; \u0024\u0024; select ${call};`;
    expect(() => inferMigrationRiskTier(sql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
  });

  it('preserves safe SQL keyword syntax without widening the routine allowlist', () => {
    for (const query of [
      'select 1 where exists (select 1);',
      '(select 1 where not exists (select 1 where false));',
      'copy (select 1 where exists (select 1)) to stdout;',
      'select 1 where true and (false or true);',
      'select 1 where 1 in (1, 2);',
      'select (1 + 2) where (true);',
      'with probe as (select 1 as id) select (id) from probe;',
      'values (1), (2);',
      'create table public.probe(id int check (id > 0));',
      // Defining this stored routine does not execute its aggregate/FILTER.
      'create function public.filtered_count() returns bigint language sql as \u0024\u0024 select count(*) filter (where true) from public.orders; \u0024\u0024;',
    ]) expect(inferMigrationRiskTier(query)).toBe('ADDITIVE');
    // Aggregate calls were not on the executable-routine allowlist before this
    // patch. FILTER syntax must not make the preceding unknown call trusted.
    expect(() => inferMigrationRiskTier('select count(*) filter (where true) from public.orders;'))
      .toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('select filter() filter (where true);'))
      .toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    // A real ON CONFLICT target is syntax, but JOIN ... ON conflict() executes
    // a boolean routine. Nested calls must not inherit an outer syntax exemption.
    expect(inferMigrationRiskTier('insert into public.t(id) values (1) on conflict (id) do nothing;'))
      .toBe('BACKFILL');
    for (const query of [
      'select 1 from public.t join public.s on conflict();',
      'select 1 where exists (select btree());',
      'select true and (hash() > 0);',
      'with probe as (select gin()) select * from probe;',
      'values (gist());',
    ]) expect(() => inferMigrationRiskTier(query), query)
      .toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
  });

  it('rejects qualified keyword-named routines even when the schema is quoted', () => {
    for (const call of [
      '"public".filter()', '"public" . filter()', '"public"/* schema */.filter()',
      '"public"."filter"()', 'public.filter()', '"租戶".filter()',
      '"pub""lic".filter()', 'U&"publ\\0069c".filter()',
    ]) {
      expect(() => inferMigrationRiskTier(`select ${call};`))
        .toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    }
    const sql = 'create function "public".filter() returns integer language plpgsql as \u0024\u0024 begin delete from public.orders; return 1; end; \u0024\u0024; select "public".filter();';
    expect(() => inferMigrationRiskTier(sql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('select 1 where exists (select 1);')).toBe('ADDITIVE');
    expect(inferMigrationRiskTier('insert into "public".orders(id) values (1);')).toBe('BACKFILL');
  });

  it('classifies data-modifying CTEs inside execution wrappers as BACKFILL', () => {
    for (const prefix of [
      'create table public.archive as ',
      'create global temp table public.archive as ',
      'create materialized view public.archive as ',
      'create view public.archive as ',
      'create or replace view public.archive as ',
      'explain ',
      'copy (',
    ]) {
      for (const dml of [
        'delete from public.orders returning *',
        'update public.orders set amount = 0 returning *',
        'insert into public.orders values (1) returning *',
      ]) {
        const query = `with moved as (${dml}) select * from moved`;
        const suffix = prefix === 'copy (' ? ') to stdout' : '';
        expect(inferMigrationRiskTier(`${prefix}${query}${suffix};`)).toBe('BACKFILL');
      }
    }
    // Quoted/commented SQL and stored routine bodies are not immediate DML.
    expect(inferMigrationRiskTier("create table public.archive as select 'with moved as (delete from public.orders)' as note;"))
      .toBe('ADDITIVE');
    expect(inferMigrationRiskTier('create table public.archive as /* delete from public.orders */ select 1 as id;'))
      .toBe('ADDITIVE');
    expect(inferMigrationRiskTier('create function public.archive_orders() returns void language sql as \u0024\u0024 with moved as (delete from public.orders returning *) select * from moved; \u0024\u0024;'))
      .toBe('ADDITIVE');
  });

  it('rejects prepared execution through immediate wrappers, quoted names and CTAS tails', () => {
    for (const command of ['execute "wipe"', 'execute wipe(1)', 'execute "清除"(1)']) {
      for (const wrapper of ['', 'explain ', 'explain (analyze true, buffers true) ',
        'create table public.probe as ', 'create global temp table public.probe as ',
        'create local temporary table public.probe as ']) {
        const tail = wrapper.startsWith('create') ? ' with no data' : '';
        expect(() => inferMigrationRiskTier(`${wrapper}${command}${tail};`))
          .toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
      }
    }
    expect(() => inferMigrationRiskTier('prepare "wipe" as delete from public.t;'))
      .toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier("do 'begin prepare wipe as delete from public.t; end';"))
      .toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('grant execute on function public.f(integer) to authenticated;')).toBe('AUTHZ');
  });

  it('rejects migration-time DDL expression calls, including quoted and nested routines', () => {
    for (const call of ['public.wipe()', '"public"."wipe"()', 'wipe()', 'public.filter()']) {
      for (const sql of [
        `alter table public.t add constraint ck check (${call} > 0);`,
        `create table public.t(id int check (${call} > 0));`,
        `alter table public.t add column x int default ${call};`,
        `alter table public.t alter column x set default ${call};`,
        `create table public.t(x int default ${call});`,
        `alter table public.t alter column x type int using ${call};`,
        `create index idx on public.t ((${call}));`,
        `create index idx on public.t (id) where ${call} > 0;`,
        `create materialized view public.mv as select ${call};`,
        `create global temp table public.probe as select ${call};`,
        `create domain public.positive as int check (${call} > 0);`,
        `alter table public.t add column x int generated always as (${call}) stored;`,
      ]) {
        expect(() => inferMigrationRiskTier(sql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
      }
    }
    expect(inferMigrationRiskTier('create table public.t(id int default 1 check (id > 0));')).toBe('ADDITIVE');
    expect(inferMigrationRiskTier('create index idx on public.t (id) where id > 0;')).toBe('ADDITIVE');
    expect(inferMigrationRiskTier('alter table public.t alter column x type bigint using x::bigint;')).toBe('SCHEMA_REPAIR');
  });

  it('rejects CASCADE and multi-action dynamic constraint repairs without dependency proof', () => {
    expect(() => inferMigrationRiskTier('alter table public.t drop constraint ck cascade;'))
      .toThrow(/CASCADE_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('do $$ begin alter table public.t drop constraint ck cascade; end $$;'))
      .toThrow(/CASCADE_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier("do 'begin alter table public.t drop constraint ck cascade; end';"))
      .toThrow(/CASCADE_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier("do $$ begin execute 'ALTER TABLE public.t DROP CONSTRAINT ck CASCADE'; end $$;"))
      .toThrow(/CASCADE_NOT_ADMITTED/);
    for (const template of ['ALTER TABLE public.t DROP CONSTRAINT %I CASCADE',
      'ALTER TABLE public.t DROP CONSTRAINT %I, ADD CHECK (public.wipe() > 0)']) {
      expect(() => inferMigrationRiskTier(`do $$ begin execute pg_catalog.format('${template}', old_ck); end $$;`))
        .toThrow(/CASCADE_NOT_ADMITTED|DESTRUCTIVE_SQL_NOT_ADMITTED|UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    }
    expect(inferMigrationRiskTier('alter table public.t drop constraint ck restrict;')).toBe('SCHEMA_REPAIR');
    expect(inferMigrationRiskTier("do $$ begin execute pg_catalog.format('ALTER TABLE public.t DROP CONSTRAINT %I RESTRICT', old_ck); end $$;"))
      .toBe('SCHEMA_REPAIR');
  });

  it('uses only PENDING_APPLY entries and excludes VERIFIED_NOT_APPLIED', () => {
    expect(pendingProductionMigrations(aliasMap())).toEqual(['0105_authz', '0109_assertions']);
  });

  it('admits only the exact #17/#680 dependency closure and binds it into the plan', () => {
    const scoped = {
      schemaVersion: 1,
      entries: [
        { repoFile: '0125_issue_17_booking_addons_legacy_enum', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
        { repoFile: '0121_issue_17_booking_addons_hardening', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
        { repoFile: '0133_issue_680_booking_addons_composite_fk_expand', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
        { repoFile: '0132_unrelated', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
      ],
    };
    expect(selectedProductionMigrations(scoped, 'ISSUES_17_680').migrations).toEqual([
      '0125_issue_17_booking_addons_legacy_enum',
      '0121_issue_17_booking_addons_hardening',
      '0133_issue_680_booking_addons_composite_fk_expand',
    ]);
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260929-17680', mainSha: MAIN, plannedAt: PLANNED_AT,
      migrationScope: 'ISSUES_17_680', aliasMap: scoped, readCanonicalSql: () => sqlByPath['supabase/migrations/0105_authz.sql'],
    });
    expect(plan.migrationScope).toBe('ISSUES_17_680');
    expect(plan.migrations).toHaveLength(3);
    expect(verifyProductionDbReleasePlan({ plan, aliasMap: scoped, readCanonicalSql: () => sqlByPath['supabase/migrations/0105_authz.sql'] })).toMatchObject({ status: 'PLAN_VERIFIED', migrationCount: 3 });
    const reordered = structuredClone(plan);
    reordered.migrations.reverse();
    reordered.planDigest = releasePlanDigestOf(reordered);
    expect(() => verifyProductionDbReleasePlan({ plan: reordered, aliasMap: scoped, readCanonicalSql: () => sqlByPath['supabase/migrations/0105_authz.sql'] })).toThrow(/PENDING_SET_MISMATCH/);
    expect(() => selectedProductionMigrations({ ...scoped, entries: scoped.entries.filter((entry) => entry.repoFile !== '0125_issue_17_booking_addons_legacy_enum') }, 'ISSUES_17_680')).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING/);
    expect(() => selectedProductionMigrations(scoped, 'ARBITRARY_SUBSET')).toThrow(/UNSUPPORTED_MIGRATION_SCOPE/);
  });

  it('runs the newer owner-notify compatibility precondition before immutable 0116', () => {
    expect(orderPendingProductionMigrations([
      '0116_issue_18_owner_notify',
      '0124_issue_18_owner_notify_legacy_shape',
      '0117_issue_25b_support_chat_threads',
    ])).toEqual([
      '0124_issue_18_owner_notify_legacy_shape',
      '0116_issue_18_owner_notify',
      '0117_issue_25b_support_chat_threads',
    ]);
    expect(orderPendingProductionMigrations([
      '0110_issue_42_plan_duration_pricetype_yearround',
      '0116_issue_18_owner_notify',
      '0124_issue_18_owner_notify_legacy_shape',
    ])).toEqual([
      '0110_issue_42_plan_duration_pricetype_yearround',
      '0124_issue_18_owner_notify_legacy_shape',
      '0116_issue_18_owner_notify',
    ]);
    expect(orderPendingProductionMigrations([
      '0121_issue_17_booking_addons_hardening',
      '0123_issue_589_richmenu_asset_retirement',
      '0125_issue_17_booking_addons_legacy_enum',
    ])).toEqual([
      '0125_issue_17_booking_addons_legacy_enum',
      '0121_issue_17_booking_addons_hardening',
      '0123_issue_589_richmenu_asset_retirement',
    ]);
  });

  it('keeps generic mixed-risk rejection while routing the bounded 0125 precondition through AUTHZ', () => {
    const sql = readFileSync('supabase/migrations/0125_issue_17_booking_addons_legacy_enum.sql', 'utf8');
    expect(() => inferMigrationRiskTier(sql)).toThrow(/MIXED_RISK_MIGRATION_NOT_ADMITTED/);
    expect(inferMigrationRiskTier(sql, '0125_issue_17_booking_addons_legacy_enum')).toBe('AUTHZ');
  });

  it('builds one immutable plan from exact main bytes and fixes ledger versions at G0', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql,
    });
    expect(plan.migrations.map((entry: any) => entry.repoFile)).toEqual(['0105_authz', '0109_assertions']);
    expect(plan.migrations.map((entry: any) => entry.ledgerVersion)).toEqual(['20260914123000', '20260914123001']);
    expect(plan.riskTier).toBe('AUTHZ');
    expect(plan.planDigest).toBe(releasePlanDigestOf(plan));
    expect(verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).toMatchObject({
      status: 'PLAN_VERIFIED', riskTier: 'AUTHZ', migrationCount: 2, databaseMutationAuthorized: false,
    });
  });

  it('fails closed if alias-map pending set changes after review', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql,
    });
    const changed = aliasMap();
    changed.entries.push({ repoFile: '0110_new', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'new' });
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: changed, readCanonicalSql })).toThrow(/PENDING_SET_MISMATCH/);
  });

  it('fails closed if reviewed migration bytes or ledger identity are changed', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql,
    });
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql: (path: string) => `${readCanonicalSql(path)}\nselect 1;` })).toThrow(/MIGRATION_BYTES_MISMATCH/);
    const forged = structuredClone(plan);
    forged.migrations[0].ledgerVersion = '20260101000000';
    expect(() => verifyProductionDbReleasePlan({ plan: forged, aliasMap: aliasMap(), readCanonicalSql })).toThrow(/PLAN_DIGEST_MISMATCH/);
  });

  it('distinguishes additive, schema repair, authorization and backfill risk', () => {
    expect(inferMigrationRiskTier('create table public.t(id int);')).toBe('ADDITIVE');
    expect(inferMigrationRiskTier('alter table public.t drop constraint old_ck; alter table public.t alter column x type bigint using x::bigint;')).toBe('SCHEMA_REPAIR');
    expect(inferMigrationRiskTier('create policy p on public.t for select using (true);')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('update public.t set x=1 where id=1;')).toBe('BACKFILL');
  });

  it('does not mistake runtime DML inside a stored RPC for migration-time backfill', () => {
    const rpc = `
      create or replace function public.accept_request(p_id uuid) returns void as $$
      begin
        update public.tour_orders set status = 'CONFIRMED' where id = p_id;
      end;
      $$ language plpgsql security definer set search_path = public;
      revoke execute on function public.accept_request(uuid) from anon, authenticated;
    `;
    expect(inferMigrationRiskTier(rpc)).toBe('AUTHZ');

    const immediateDoBlock = `
      do $$ begin
        update public.tour_orders set status = 'CONFIRMED' where false;
      end $$;
    `;
    expect(inferMigrationRiskTier(immediateDoBlock)).toBe('BACKFILL');
  });

  it('allows bounded built-ins in declarative defaults and catalog checks, but not arbitrary immediate routines', () => {
    const dollarQuote = String.fromCharCode(36, 36);
    expect(inferMigrationRiskTier(
      "create table public.release_probe(id uuid default pg_catalog.gen_random_uuid(), created_at timestamptz default pg_catalog.now());",
    )).toBe('ADDITIVE');
    expect(inferMigrationRiskTier(
      'do ' + dollarQuote + " declare present regclass; begin present := pg_catalog.to_regclass('public.release_probe'); end " + dollarQuote + ';',
    )).toBe('ADDITIVE');
    expect(() => inferMigrationRiskTier(
      "create table public.release_probe(id uuid default public.untrusted_default());",
    )).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(
      'do ' + dollarQuote + " begin perform public.untrusted_helper(); end " + dollarQuote + ';',
    )).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
  });

  it('treats policy predicates as AUTHZ declarations while preserving their G3 contract gate', () => {
    expect(inferMigrationRiskTier(
      "create policy tenant_read on public.release_probe for select using (is_tenant_member(tenant_id));",
    )).toBe('AUTHZ');
  });

  it('rejects unqualified built-in lookalikes, unknown policy helpers and parenthesized dynamic SQL', () => {
    const dollarQuote = String.fromCharCode(36, 36);
    expect(() => inferMigrationRiskTier(
      'do ' + dollarQuote + ' begin perform to_regclass(1); end ' + dollarQuote + ';',
    )).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(
      "create policy unsafe on public.release_probe for select using (public.untrusted_helper(tenant_id));",
    )).toThrow(/UNSUPPORTED_POLICY_ROUTINE_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(
      'do ' + dollarQuote + " begin execute (format('select 1')); end " + dollarQuote + ';',
    )).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
  });

  it('rejects destructive and mixed-specialized-risk v1 SQL instead of silently dropping one evidence class', () => {
    expect(() => inferMigrationRiskTier('drop table public.t;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('truncate public.t;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('alter table public.t drop x;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('alter table public.t disable row level security;')).toBe('AUTHZ');
    expect(() => inferMigrationRiskTier('drop view public.t;')).toThrow(/UNCLASSIFIED_DROP_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('alter table public.t enable row level security; drop policy p on public.t;')).toBe('AUTHZ');
    expect(() => inferMigrationRiskTier("select '--'; drop table public.t;")).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('select 1 /* unterminated')).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
    expect(() => inferMigrationRiskTier("select 'x'; -- hidden\rdrop table public.t;")).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('delete from public.t*;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('delete from public.t*where true;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('update public.t * set x=1;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('update public.t*set x=1;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('alter table public.orders owner to authenticated;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('alter role authenticated bypassrls;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('reassign owned by old_owner to app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('create role newcomer in role privileged_role;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('alter group privileged_role add user app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('alter view public.tenant_records set (security_invoker = false);')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('insert into public.t(id) values (1) on conflict (id) do update set id = excluded.id;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('merge into public.t as target using public.s as source on target.id = source.id when matched then update set x = source.x;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('update public.資料 set x=1;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('create group operators with superuser;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('alter type public.order_status owner to app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('create schema tenant authorization app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('set role app_user;')).toBe('AUTHZ');
    expect(() => inferMigrationRiskTier('drop view "drop default" cascade;')).toThrow(/UNCLASSIFIED_DROP_NOT_ADMITTED/);
    const dollarQuote = String.fromCharCode(36, 36);
    const doDropSql = 'do ' + dollarQuote + ' begin drop view public.t; drop constraint old_ck; end ' + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(doDropSql)).toThrow(/UNCLASSIFIED_DROP_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('select $é$--$é$; commit; drop table public.tenant_data;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    const dynamicDmlSql = 'do ' + dollarQuote + " begin execute 'delete from public.tenant_data'; end " + dollarQuote + ';';
    expect(inferMigrationRiskTier(dynamicDmlSql)).toBe('BACKFILL');
    expect(inferMigrationRiskTier("do 'BEGIN DELETE FROM public.tenant_data; END';")).toBe('BACKFILL');
    expect(inferMigrationRiskTier('explain analyze delete from public.tenant_data;')).toBe('BACKFILL');
    const dynamicDropSql = 'do ' + dollarQuote + " begin execute format('DROP %s %I.%I', 'TABLE', 'public', 'documents'); end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(dynamicDropSql)).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED|UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED|UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const unresolvedDynamicSql = 'do ' + dollarQuote + ' begin execute query_text; end ' + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(unresolvedDynamicSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    expect(inferMigrationRiskTier("do e'BEGIN EXECUTE ''DELETE FROM public.tenant_data''; END;';")).toBe('BACKFILL');
    const concatenatedDynamicSql = 'do ' + dollarQuote + " begin execute 'UPDATE public.tenant_data SET n=1; ' || 'TRUN' || 'CATE public.tenant_data'; end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(concatenatedDynamicSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    const escapedDoDmlSql = "do e'BEGIN EXECUTE ''DELETE FROM public.tenant_data''; END;';";
    expect(inferMigrationRiskTier(escapedDoDmlSql)).toBe('BACKFILL');
    const escapedDestructiveSql = "do e'BEGIN \\x44ROP TABLE public.tenant_data; END';";
    expect(() => inferMigrationRiskTier(escapedDestructiveSql)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
    const unicodeEscapedDoSql = "do U&'BEGIN \\0044ROP \\0054ABLE public.tenant_data; END';";
    expect(() => inferMigrationRiskTier(unicodeEscapedDoSql)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
    const formattedMultiCommandSql = 'do ' + dollarQuote + " begin execute format('UPDATE public.tenant_data SET n=1; %s%s TABLE public.victim', 'DR', 'OP'); end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(formattedMultiCommandSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED|UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const positionalFormatSql = 'do ' + dollarQuote + " begin execute format('ALTER TABLE %I DROP CONSTRAINT %I %3$s', 'public.t', 'old_ck', ''); end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(positionalFormatSql)).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED|UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED|UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const literalRoutineSql = "create function public.wipe() returns void language sql as 'DELETE FROM public.t'; select public.wipe();";
    expect(() => inferMigrationRiskTier(literalRoutineSql)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
    expect(inferMigrationRiskTier('alter routine public.f() owner to other_role;')).toBe('AUTHZ');
    const routineTag = String.fromCharCode(36) + 'routine' + String.fromCharCode(36);
    const storedRoutineInvocationSql = 'create function public.release_wipe() returns void as ' + routineTag + ' begin delete from public.t; end ' + routineTag + ' language plpgsql; select public.release_wipe();';
    expect(() => inferMigrationRiskTier(storedRoutineInvocationSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const quotedRoutineInvocationSql = 'create function public."lower"(integer) returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; select public."lower"(1);';
    expect(() => inferMigrationRiskTier(quotedRoutineInvocationSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const unqualifiedRoutineOverloadSql = 'create function public.lower(integer) returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; select lower(1);';
    expect(() => inferMigrationRiskTier(unqualifiedRoutineOverloadSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const withRoutineInvocationSql = 'create function public.review_wipe() returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; with r as (select public.review_wipe() as n) select n from r;';
    expect(() => inferMigrationRiskTier(withRoutineInvocationSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const ddlRoutineInvocationSql = 'create function public.review_wipe() returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; create table public.release_probe as select public.review_wipe();';
    expect(() => inferMigrationRiskTier(ddlRoutineInvocationSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    for (const tempTablePrefix of ['global temp table', 'local temporary table']) {
      const prefixedDdlRoutineInvocationSql = 'create function public.review_wipe() returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; create ' + tempTablePrefix + ' public.release_probe as select public.review_wipe();';
      expect(() => inferMigrationRiskTier(prefixedDdlRoutineInvocationSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    }
    const preparedDmlSql = 'prepare wipe as delete from public.t; execute wipe;';
    expect(() => inferMigrationRiskTier(preparedDmlSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    const proceduralPreparedDmlSql = 'do ' + dollarQuote + ' begin prepare wipe as delete from public.t; execute wipe; end ' + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(proceduralPreparedDmlSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('explain analyze execute wipe;')).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    for (const tempTablePrefix of ['create global temp table', 'create local temporary table']) {
      expect(() => inferMigrationRiskTier(tempTablePrefix + ' public.release_probe as execute wipe;'))
        .toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    }
    const qualifiedKeywordRoutineSql = 'create function public.filter() returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; do ' + dollarQuote + ' declare n integer := public.filter(); begin null; end ' + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(qualifiedKeywordRoutineSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const unicodeRoutineInvocationSql = 'create function public.清除() returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; select public.清除();';
    expect(() => inferMigrationRiskTier(unicodeRoutineInvocationSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const assignmentRoutineInvocationSql = 'create function public.wipe() returns integer as ' + routineTag + ' begin delete from public.t; return 1; end ' + routineTag + ' language plpgsql; do ' + dollarQuote + ' declare n integer; begin n := public.wipe(); end ' + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(assignmentRoutineInvocationSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const doTag = String.fromCharCode(36) + 'do' + String.fromCharCode(36);
    const deceptiveDoRoutineText = 'do ' + doTag + " begin raise notice 'create function dummy() returns void as $$'; delete from public.t; raise notice '$$'; end " + doTag + ';';
    expect(inferMigrationRiskTier(deceptiveDoRoutineText)).toBe('BACKFILL');
    const adjacentDynamicSql = 'do ' + dollarQuote + " begin execute 'ALTER TABLE public.t DROP CONSTRAINT old_ck'\n             '; DELETE FROM public.t'; end " + dollarQuote + ';';
    const storedProcedureCallSql = 'create procedure public.release_wipe() language plpgsql as ' + routineTag + ' begin delete from public.t; end ' + routineTag + '; do ' + doTag + ' begin call public.release_wipe(); end ' + doTag + ';';
    expect(() => inferMigrationRiskTier(storedProcedureCallSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const adjacentDoBodySql = "do 'BEGIN NULL;'\n             'DELETE FROM public.t; END;';";
    expect(() => inferMigrationRiskTier(adjacentDoBodySql)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
    const adjacentFormatSql = 'do ' + dollarQuote + " begin execute format('ALTER TABLE public.t DROP CONSTRAINT old_ck'\n             '; DELETE FROM public.t'); end " + dollarQuote + ';';
    const boundedFormatRepairSql = 'do ' + dollarQuote + " begin execute pg_catalog.format('ALTER TABLE public.t DROP CONSTRAINT %I', old_ck); end " + dollarQuote + ';';
    expect(inferMigrationRiskTier(boundedFormatRepairSql)).toBe('SCHEMA_REPAIR');
    const unqualifiedFormatRepairSql = 'do ' + dollarQuote + " begin execute format('ALTER TABLE public.t DROP CONSTRAINT %I', old_ck); end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(unqualifiedFormatRepairSql)).toThrow(/UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    const formatArgumentCallSql = 'do ' + dollarQuote + " begin execute format('ALTER TABLE public.t DROP CONSTRAINT %I', public.release_wipe()); end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(formatArgumentCallSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED|UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(adjacentFormatSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED|UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier(adjacentDynamicSql)).toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('set session role app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier("set \"role\" = 'privileged_role';")).toBe('AUTHZ');
    expect(inferMigrationRiskTier('reset role;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('set session authorization app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier("set \"session_authorization\" = 'app_user';")).toBe('AUTHZ');
    expect(inferMigrationRiskTier("set U&\"ro\\006ce\" = 'app_user';")).toBe('AUTHZ');
    const doConfigurationSql = 'do ' + dollarQuote + " begin set U&\"ro\\006ce\" = 'app_user'; end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(doConfigurationSql)).toThrow(/UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED/);
    const labeledDoConfigurationSql = 'do ' + dollarQuote + " <<b>> begin set local U&\"ro\\006ce\" = 'privileged_role'; end " + dollarQuote + ';';
    expect(() => inferMigrationRiskTier(labeledDoConfigurationSql)).toThrow(/UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('alter domain public.order_id owner to app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('alter foreign table public.orders owner to app_user;')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('alter view public.tenant_records reset (security_invoker);')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('update only (public.tenant_records) set tenant_id = \'other\';')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('update public . tenant_records set tenant_id = \'other\';')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('delete from only (public.tenant_records) where true;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('update "public"."t" set x=1 where id=1;')).toBe('BACKFILL');
    expect(() => inferMigrationRiskTier('grant select on public.t to authenticated; update public.t set x=1;'))
      .toThrow(/MIXED_RISK_MIGRATION_NOT_ADMITTED/);
  });

  it('rejects a release plan that mixes risk classes across migrations', () => {
    const mixed = aliasMap();
    mixed.entries.push({ repoFile: '0111_backfill', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' });
    const mixedSql: Record<string, string> = {
      ...sqlByPath,
      'supabase/migrations/0111_backfill.sql': 'update public.t set x=1 where id=1;',
    };
    expect(() => buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: mixed, readCanonicalSql: (path: string) => mixedSql[path],
    })).toThrow(/MIXED_RISK_RELEASE_NOT_ADMITTED/);
  });
});

describe('#46 bounded 0135 selector', () => {
  const prerequisites = ['0003_tenants_and_accounts', '0004_core_business_tables', '0005_line_marketing_other',
    '0066_issue_8_tour_domain_core', '0074_block_times_recurrence_fields', '0092_trip_departure_staff',
    '0110_issue_42_plan_duration_pricetype_yearround', '0115_issue_21_external_calendars'];
  const target = '0135_issue_46_guide_interval_availability';
  function fixture() {
    return { schemaVersion: 1, entries: [...prerequisites.map(repoFile => ({ repoFile, classification: 'EXACT', ledgerNames: [repoFile] })),
      { repoFile: target, classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', ledgerNames: [] },
      { repoFile: '0133_unrelated', classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', ledgerNames: [] }] };
  }
  it('selects only exact 0135 and verifies its current SQL classifier', () => {
    expect(selectedProductionMigrations(fixture(), 'ISSUE_46_0135')).toEqual({migrationScope:'ISSUE_46_0135',migrations:[target]});
    expect(inferMigrationRiskTier(readFileSync(`supabase/migrations/${target}.sql`, 'utf8'), target)).toBe('AUTHZ');
  });
  it('rejects each missing, aliased, duplicated or empty-ledger prerequisite without expanding closure', () => {
    for (const name of prerequisites) {
      for (const variant of ['missing', 'alias', 'duplicate', 'empty', 'wrongIdentity']) {
        const map = fixture(); const row = map.entries.find(entry => entry.repoFile === name)!;
        if (variant === 'missing') map.entries = map.entries.filter(entry => entry !== row);
        if (variant === 'alias') row.classification = 'ALIAS';
        if (variant === 'duplicate') map.entries.push({...row});
        if (variant === 'empty') row.ledgerNames = [];
        if (variant === 'wrongIdentity') row.ledgerNames = ['other'];
        expect(() => selectedProductionMigrations(map, 'ISSUE_46_0135')).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
      }
    }
    const map = fixture(); map.entries = map.entries.filter(entry => entry.repoFile !== target);
    expect(() => selectedProductionMigrations(map, 'ISSUE_46_0135')).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING/);
    expect(() => selectedProductionMigrations(fixture(), 'ISSUE_46_ANY')).toThrow(/UNSUPPORTED_MIGRATION_SCOPE/);
  });
});

describe('#46/#755 reviewed eight-migration closure', () => {
  const scope = 'ISSUE_46_0110_0136_CLOSURE';
  const targets = ['0110_issue_42_plan_duration_pricetype_yearround','0111_issue_46_guide_request_accept','0115_issue_21_external_calendars',
    '0128_issue_42_plan_seasonal_pricing','0130_issue_46_refund_policy_snapshot','0132_issue_42_seasonal_price_resolution','0135_issue_46_guide_interval_availability','0136_issue_755_create_tour_order_invoker'];
  const prerequisites = ['0001_extensions_and_functions','0002_enums','0003_tenants_and_accounts','0004_core_business_tables',
    '0005_line_marketing_other','0066_issue_8_tour_domain_core','0067_issue_8_tour_integrity','0068_issue_8_tour_rest_dml_acl',
    '0074_block_times_recurrence_fields','0087_issue_8b_tour_orders','0088_issue_8b_tour_order_rpc_acl','0089_trip_display_fields',
    '0092_trip_departure_staff','0107_issue_41_formation_state_model'];
  function fixture() {
    return {schemaVersion:1,entries:[...prerequisites.map(repoFile=>({repoFile,classification:'EXACT',ledgerNames:[repoFile]})),
      ...targets.map(repoFile=>({repoFile,classification:'NOT_APPLIED',notAppliedReason:'PENDING_APPLY',ledgerNames:[]})),
      {repoFile:'0099_drop_legacy_create_tour_order_overload',classification:'ALIAS',ledgerNames:['drop_legacy_create_tour_order_overload']},
      {repoFile:'0133_unrelated',classification:'NOT_APPLIED',notAppliedReason:'PENDING_APPLY',ledgerNames:[]}]};
  }
  it('closure coverage scope is bound to the admitted release-plan scope (N1: no silent skip on rename)', () => {
    expect(ISSUE_46_CLOSURE_COVERAGE.scope).toBe(scope);
    expect(selectedProductionMigrations(fixture(), ISSUE_46_CLOSURE_COVERAGE.scope).migrationScope).toBe(ISSUE_46_CLOSURE_COVERAGE.scope);
  });
  it('locks exactly eight ordered AUTHZ migrations: 0132 the last create_tour_order body writer, 0136 the final security invoker setter', () => {
    const map=fixture();expect(selectedProductionMigrations(map,scope)).toEqual({migrationScope:scope,migrations:targets});
    const read=(path:string)=>readFileSync(path,'utf8');
    const built=buildProductionDbReleasePlan({releaseId:'release-46-closure',mainSha:MAIN,plannedAt:PLANNED_AT,migrationScope:scope,aliasMap:map,readCanonicalSql:read});
    expect(built.riskTier).toBe('AUTHZ');expect(built.migrations.map(row=>row.repoFile)).toEqual(targets);
    const writers=built.migrations.filter(row=>/create or replace function public\.create_tour_order\(/i.test(read(row.path)));
    expect(writers.at(-1)!.repoFile).toBe('0132_issue_42_seasonal_price_resolution');
    // 0136 replaces no body: it ALTERs the 0132 signature to SECURITY INVOKER and is the last migration.
    const invoker=read(built.migrations.at(-1)!.path);
    expect(built.migrations.at(-1)!.repoFile).toBe('0136_issue_755_create_tour_order_invoker');
    expect(invoker).not.toMatch(/create or replace function/i);
    expect(invoker).toMatch(/alter function public\.create_tour_order\([\s\S]*\) security invoker;/i);
    expect(invoker).toMatch(/grant select on table public\.trip_plan_seasons to service_role;/i);
    const final=read(writers.at(-1)!.path);
    for(const marker of ['seats_reserved','refund_policy_snapshot','trip_plan_seasons','v_should_reserve','PER_GROUP'])expect(final).toContain(marker);
    expect(verifyProductionDbReleasePlan({plan:built,aliasMap:map,readCanonicalSql:read}).planDigest).toBe(built.planDigest);
    // Existing single-0135 remains strict and cannot silently absorb its pending dependencies.
    expect(()=>selectedProductionMigrations(map,'ISSUE_46_0135')).toThrow(/APPLIED_PREREQUISITE_MISSING/);
    const reversed={...built,migrations:[...built.migrations].reverse()};reversed.planDigest=releasePlanDigestOf(reversed);
    expect(()=>verifyProductionDbReleasePlan({plan:reversed,aliasMap:map,readCanonicalSql:read})).toThrow();
  });
  it('orders 0136 after 0132 and never selects 0136 without 0128/0132; old scope name is unsupported', () => {
    const shuffled=fixture();shuffled.entries.reverse();
    expect(selectedProductionMigrations(shuffled,scope).migrations.slice(-3)).toEqual(['0132_issue_42_seasonal_price_resolution','0135_issue_46_guide_interval_availability','0136_issue_755_create_tour_order_invoker']);
    expect(orderPendingProductionMigrations(['0136_issue_755_create_tour_order_invoker','0132_issue_42_seasonal_price_resolution']))
      .toEqual(['0132_issue_42_seasonal_price_resolution','0136_issue_755_create_tour_order_invoker']);
    for(const dependency of ['0128_issue_42_plan_seasonal_pricing','0132_issue_42_seasonal_price_resolution']){
      const map=fixture();map.entries=map.entries.filter(row=>row.repoFile!==dependency);
      expect(()=>selectedProductionMigrations(map,scope)).toThrow(/DEPENDENCY_NOT_PENDING/);
    }
    expect(()=>selectedProductionMigrations(fixture(),'ISSUE_46_0110_0135_CLOSURE')).toThrow(/UNSUPPORTED_MIGRATION_SCOPE/);
    expect(()=>selectedProductionMigrations(fixture(),'ISSUE_46_0135')).toThrow(/APPLIED_PREREQUISITE_MISSING/);
  });
  it('rejects incomplete targets/preconditions and every unreviewed legacy alias', () => {
    for(const target of targets){
      const map=fixture();map.entries=map.entries.filter(row=>row.repoFile!==target);
      expect(()=>selectedProductionMigrations(map,scope)).toThrow(/DEPENDENCY_NOT_PENDING/);
      const nonpending=fixture();(nonpending.entries.find(row=>row.repoFile===target)! as {notAppliedReason?:string}).notAppliedReason='VERIFIED_NOT_APPLIED';
      expect(()=>selectedProductionMigrations(nonpending,scope)).toThrow(/DEPENDENCY_NOT_PENDING/);
    }
    for(const prerequisite of prerequisites){
      const map=fixture();map.entries=map.entries.filter(row=>row.repoFile!==prerequisite);
      expect(()=>selectedProductionMigrations(map,scope)).toThrow(/APPLIED_PREREQUISITE_MISSING/);
    }
    for(const mutate of ['missing','wrongAlias','wrongClassification','duplicate']){
      const map=fixture();const row=map.entries.find(row=>row.repoFile.startsWith('0099'))!;
      if(mutate==='missing')map.entries=map.entries.filter(entry=>entry!==row);
      if(mutate==='wrongAlias')row.ledgerNames=['other_alias'];
      if(mutate==='wrongClassification')row.classification='EXACT';
      if(mutate==='duplicate')map.entries.push({...row});
      expect(()=>selectedProductionMigrations(map,scope)).toThrow(/APPLIED_PREREQUISITE_MISSING/);
    }
  });

  // #755 的新 finite9 計畫只多 canonical 0137；計畫建構不是 DB 執行授權。
  const quotedScope = 'ISSUE_755_0110_0137_CLOSURE';
  const quoted = '0137_issue_749_create_tour_order_quoted';
  function quotedFixture() {
    const map = fixture();
    return { ...map, entries: [...map.entries,
      { repoFile: quoted, classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', ledgerNames: [] }] };
  }
  const quotedPlan = (map = quotedFixture()) => buildProductionDbReleasePlan({
    releaseId: 'release-755-quoted-closure', mainSha: MAIN, plannedAt: PLANNED_AT,
    migrationScope: quotedScope, aliasMap: map, readCanonicalSql: (path: string) => readFileSync(path, 'utf8'),
  });

  it('adds exactly canonical 0137 after 0132/0136 and preserves the old eight/default selection', () => {
    const map = quotedFixture();
    expect(selectedProductionMigrations(map, quotedScope)).toEqual({ migrationScope: quotedScope, migrations: [...targets, quoted] });
    expect(selectedProductionMigrations(map, scope)).toEqual({ migrationScope: scope, migrations: targets });
    expect(selectedProductionMigrations(map)).toEqual({ migrationScope: 'FULL_PENDING_SET', migrations: [...targets, quoted, '0133_unrelated'].sort() });
    const built = quotedPlan(map);
    expect(built.riskTier).toBe('AUTHZ');
    expect(built.migrations.at(-1)).toMatchObject({ repoFile: quoted, riskTier: 'AUTHZ', sha256: '62b1384e405d6f2657c68534aff406069f33070fbaefc98cf38f8d72a327890a' });
    const old = (aliases: typeof map) => buildProductionDbReleasePlan({
      releaseId: 'release-755-quoted-closure', mainSha: MAIN, plannedAt: PLANNED_AT,
      migrationScope: scope, aliasMap: aliases, readCanonicalSql: (path: string) => readFileSync(path, 'utf8'),
    });
    expect(old(map)).toEqual(old(fixture()));
    expect(built.migrations.slice(0, 8)).toEqual(old(map).migrations);
    expect(verifyProductionDbReleasePlan({ plan: built, aliasMap: map, readCanonicalSql: (path: string) => readFileSync(path, 'utf8') }).planDigest).toBe(built.planDigest);
  });

  it('requires all existing exact prerequisites, the sole reviewed 0099 alias, and 0132/0136/0137 pending', () => {
    for (const name of prerequisites) {
      for (const variant of ['missing', 'alias', 'duplicate', 'wrongLedger']) {
        const map = quotedFixture(); const row = map.entries.find(entry => entry.repoFile === name)!;
        if (variant === 'missing') map.entries = map.entries.filter(entry => entry !== row);
        if (variant === 'alias') row.classification = 'ALIAS';
        if (variant === 'duplicate') map.entries.push({ ...row });
        if (variant === 'wrongLedger') row.ledgerNames = ['other'];
        expect(() => selectedProductionMigrations(map, quotedScope)).toThrow(/APPLIED_PREREQUISITE_MISSING/);
      }
    }
    for (const name of ['0132_issue_42_seasonal_price_resolution', '0136_issue_755_create_tour_order_invoker', quoted]) {
      const map = quotedFixture(); map.entries = map.entries.filter(row => row.repoFile !== name);
      expect(() => selectedProductionMigrations(map, quotedScope)).toThrow(/DEPENDENCY_NOT_PENDING/);
    }
    for (const variant of ['missing', 'wrongAlias', 'wrongClassification', 'duplicate']) {
      const map = quotedFixture(); const row = map.entries.find(entry => entry.repoFile.startsWith('0099'))!;
      if (variant === 'missing') map.entries = map.entries.filter(entry => entry !== row);
      if (variant === 'wrongAlias') row.ledgerNames = ['other_alias'];
      if (variant === 'wrongClassification') row.classification = 'EXACT';
      if (variant === 'duplicate') map.entries.push({ ...row });
      expect(() => selectedProductionMigrations(map, quotedScope)).toThrow(/APPLIED_PREREQUISITE_MISSING/);
    }
  });

  it('rejects missing/extra nine-plan identities, stale 0137 pins, old-eight relabeling and unlisted scopes', () => {
    const map = quotedFixture(); const built = quotedPlan(map);
    const verify = (mutated: typeof built) => {
      mutated.planDigest = releasePlanDigestOf(mutated);
      return verifyProductionDbReleasePlan({ plan: mutated, aliasMap: map, readCanonicalSql: (path: string) => readFileSync(path, 'utf8') });
    };
    expect(() => verify({ ...built, migrations: built.migrations.slice(0, 8) })).toThrow(/PENDING_SET_MISMATCH/);
    expect(() => verify({ ...built, migrations: [...built.migrations, { ...built.migrations.at(-1)!, repoFile: '0133_unrelated', path: 'supabase/migrations/0133_unrelated.sql' }] })).toThrow(/PENDING_SET_MISMATCH/);
    expect(() => verify({ ...built, migrations: built.migrations.map(row => row.repoFile === quoted ? { ...row, sha256: '0'.repeat(64) } : row) })).toThrow(/MIGRATION_BYTES_MISMATCH/);
    expect(() => verify({ ...built, migrationScope: scope })).toThrow(/PENDING_SET_MISMATCH/);
    expect(() => selectedProductionMigrations(map, 'ISSUE_755_0110_0138_CLOSURE')).toThrow(/UNSUPPORTED_MIGRATION_SCOPE/);
  });
});
