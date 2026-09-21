import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildProductionDbReleasePlan,
  inferMigrationRiskTier,
  orderPendingProductionMigrations,
  pendingProductionMigrations,
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
