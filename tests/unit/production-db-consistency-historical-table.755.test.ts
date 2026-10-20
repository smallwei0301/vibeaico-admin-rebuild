import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveClosure, historicalBaselineTables, sourceRoutines } from '../../scripts/agents/production-db-consistency-evidence.mjs';

// #755 G2：historical baseline 表（booking_addons）只由 LOCAL_ONLY_TRANSITIONAL overlay 建立，
// canonical migrations 沒有 create table。只有三份 capture 的 catalog.tableOwners 全都證明該表存在，才可視為既有表。
const MIGRATION = { path: 'supabase/migrations/9000_fixture.sql', repoFile: '9000_fixture' };
const routineSql = (table: string) => `
create or replace function public.fixture_add(p_id uuid) returns void language plpgsql as $fn$
begin
  insert into ${table} (id) values (p_id);
  update ${table} set id = p_id where id = p_id;
end;
$fn$;`;
const afterMap = (sql: string) => new Map(sourceRoutines(sql, MIGRATION.path).map((routine: any) => [`${routine.name}(${routine.args})`, routine]));

function build(table = 'public.booking_addons') {
  const sql = routineSql(table);
  return {
    source: {
      sources: new Map([['supabase/migrations/0001_canon.sql', 'create table public.canon_table (id uuid primary key);']]),
      before: new Map(), after: afterMap(sql), read: () => sql,
      historicalTables: new Set(['public.booking_addons']),
    },
    plan: { migrations: [MIGRATION] },
    impactManifest: { schemaVersion: 1, entries: [] },
  };
}
const capture = (tables: string[]) => ({
  raw: { metadata: { items: [] } },
  catalog: { foreignKeys: [], tableOwners: tables.map((table) => ({ table, owner: 'postgres' })) },
});
const ALL = ['LOCAL_EXPECTED', 'TEST', 'PRODUCTION'];
const captures = (present: Record<string, string[]>) => Object.fromEntries(ALL.map((name) => [name, capture(present[name] ?? [])]));
const everywhere = (table: string) => Object.fromEntries(ALL.map((name) => [name, [table]]));
const run = (caps: Record<string, any>, table?: string) => deriveClosure({ ...build(table), captures: caps, createTourOrderFamily: false });

describe('#755 G2 historical baseline table source', () => {
  it('三份 capture 都有表時不丟錯，並把表放進 roots', () => {
    const closure = run(captures(everywhere('public.booking_addons')));
    expect(closure.tables.has('public.booking_addons')).toBe(true);
  });

  it.each(ALL)('%s 缺表時仍丟 RELEASE_UNSOURCED_DEPENDENCY', (missing) => {
    const present = Object.fromEntries(ALL.map((name) => [name, name === missing ? [] : ['public.booking_addons']]));
    expect(() => run(captures(present))).toThrow(/RELEASE_UNSOURCED_DEPENDENCY: public\.booking_addons has no canonical table source/);
  });

  it('capture 只命名其他表時仍 fail closed', () => {
    expect(() => run(captures(everywhere('public.other_table')))).toThrow(/RELEASE_UNSOURCED_DEPENDENCY/);
  });

  it('非 public schema 行為不變：不因 tableOwners 存在而進入 roots', () => {
    const closure = run(captures(everywhere('private.hidden_table')), 'private.hidden_table');
    expect(closure.tables.has('private.hidden_table')).toBe(false);
    expect(closure.tables.has('public.hidden_table')).toBe(false);
  });

  it('canonical 已有 create table 的表維持原行為', () => {
    const closure = run(captures({}), 'public.canon_table');
    expect(closure.tables.has('public.canon_table')).toBe(true);
  });

  it('from public.fn(...) 且 fn 為 canonical routine 時視為函式呼叫而非表', () => {
    const sql = `create or replace function public.fixture_ref(p jsonb) returns setof text language sql as $a$ select 'x' $a$;
create or replace function public.fixture_use(p jsonb) returns void language plpgsql as $b$
begin perform 1 from public.fixture_ref(p) as c; end; $b$;`;
    const closure = deriveClosure({
      source: { sources: new Map(), before: new Map(), after: afterMap(sql), read: () => sql },
      plan: { migrations: [MIGRATION] }, impactManifest: { schemaVersion: 1, entries: [] },
      captures: captures({}), createTourOrderFamily: false,
    });
    expect(closure.tables.has('public.fixture_ref')).toBe(false);
  });
});

describe('#755 G2 SRF 豁免只限 from/join 後的函式呼叫', () => {
  const sql = `create or replace function public.fixture_t(p jsonb) returns setof text language sql as $a$ select 'x' $a$;
create or replace function public.fixture_use(p_id uuid) returns void language plpgsql as $b$
begin insert into public.fixture_t (id) values (p_id); end; $b$;`;
  it('routine 與表同名時，insert into public.t (cols) 不得被當成 SRF 跳過', () => {
    expect(() => deriveClosure({
      source: { sources: new Map(), before: new Map(), after: afterMap(sql), read: () => sql } as any,
      plan: { migrations: [MIGRATION] }, impactManifest: { schemaVersion: 1, entries: [] },
      captures: captures({}) as any, createTourOrderFamily: false,
    })).toThrow(/RELEASE_UNSOURCED_DEPENDENCY: public\.fixture_t/);
  });
});

describe('#755 G2 historical 表來源須為 hash 驗證的 baseline 建表（Codex P1）', () => {
  const blob = (text: string) => { const b = Buffer.from(text); return createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex'); };
  function fixtureRoot(files: { name: string; sql: string; blobSql?: string; retiredBy?: string }[]) {
    const root = mkdtempSync(join(tmpdir(), 'hist-baseline-'));
    const dir = join(root, 'supabase/local-migrations/historical-integration-baseline');
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f.name), f.sql);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, files: files.map((f) => ({ name: f.name, blobSha: blob(f.blobSql ?? f.sql), ...(f.retiredBy ? { retiredBy: f.retiredBy } : {}) })) }));
    return root;
  }
  const withTables = (tables: Set<string>, present: string) => {
    const b = build(present);
    return deriveClosure({ ...b, source: { ...b.source, historicalTables: tables }, captures: captures(everywhere(present)) as any, createTourOrderFamily: false });
  };

  it('(i) hash 驗證通過的 baseline 建表 + 三方存在 -> 通過', () => {
    const root = fixtureRoot([{ name: '0020_booking_addons.sql', sql: 'create table booking_addons (id uuid);' }]);
    const tables = historicalBaselineTables(root);
    expect(tables.has('public.booking_addons')).toBe(true);
    expect(withTables(tables, 'public.booking_addons').tables.has('public.booking_addons')).toBe(true);
  });

  it('(ii) 三方都有但不在 baseline 的表 -> RELEASE_UNSOURCED_DEPENDENCY', () => {
    const root = fixtureRoot([{ name: '0020_booking_addons.sql', sql: 'create table booking_addons (id uuid);' }]);
    expect(() => withTables(historicalBaselineTables(root), 'public.rogue_table')).toThrow(/RELEASE_UNSOURCED_DEPENDENCY: public\.rogue_table/);
  });

  it('(iii) baseline 檔案內容被竄改（blob 不符）-> 不承認', () => {
    const root = fixtureRoot([{ name: '0020_booking_addons.sql', sql: 'create table booking_addons (id uuid);\ncreate table rogue_table (id uuid);', blobSql: 'create table booking_addons (id uuid);' }]);
    const tables = historicalBaselineTables(root);
    expect(tables.size).toBe(0);
    expect(() => withTables(tables, 'public.booking_addons')).toThrow(/RELEASE_UNSOURCED_DEPENDENCY/);
  });

  it('(iv) retiredBy 檔案中的表 -> 不承認', () => {
    const root = fixtureRoot([{ name: '0018_x.sql', sql: 'create table old_t (id uuid);', retiredBy: '0079_x.sql' }]);
    const tables = historicalBaselineTables(root);
    expect(tables.has('public.old_t')).toBe(false);
    expect(() => withTables(tables, 'public.old_t')).toThrow(/RELEASE_UNSOURCED_DEPENDENCY/);
  });

  it('manifest 不存在 -> fail closed（空集合）', () => {
    expect(historicalBaselineTables(mkdtempSync(join(tmpdir(), 'hist-none-'))).size).toBe(0);
  });

  it('source 沒提供 historicalTables -> fail closed', () => {
    const b = build();
    expect(() => deriveClosure({ ...b, source: { ...b.source, historicalTables: undefined } as any, captures: captures(everywhere('public.booking_addons')) as any, createTourOrderFamily: false })).toThrow(/RELEASE_UNSOURCED_DEPENDENCY/);
  });

  it('真實 repo manifest：booking_addons 被承認', () => {
    expect(historicalBaselineTables(process.cwd()).has('public.booking_addons')).toBe(true);
  });
});
