import { describe, expect, it } from 'vitest';

import { buildProductionDbReleasePlan, inferMigrationRiskTier, releasePlanDigestOf, sha256, stripSqlComments } from '../../scripts/agents/production-db-release-plan.mjs';
import { buildAtomicProductionApplySql } from '../../scripts/db/controlled-production-db-release.mjs';
import { scanCreateTourOrderDdl } from '../../scripts/agents/production-db-g3-authz-contracts.mjs';

describe('SQL lexer 對齊 PostgreSQL 識別字／dollar tag 規則（#780）', () => {
  it('非 ASCII dollar tag 本體內的 -- 不是註解，後續真實語句保留', () => {
    const out = stripSqlComments('select $€$ -- $€$; drop table x;');
    expect(out).toContain('drop table x');
    expect(() => inferMigrationRiskTier('select $€$ -- $€$; drop table x;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });

  it('識別字尾端 € 後的 $$ 不是 dollar quote 起點', () => {
    const sql = 'select 1 as €$$, $$ -- $$; drop table x;';
    expect(stripSqlComments(sql)).toContain('drop table x');
    expect(() => inferMigrationRiskTier(sql)).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });

  it('巢狀非 ASCII dollar tag：本體內容原樣保留', () => {
    const sql = 'do $€$ begin perform $₤$ -- $₤$; drop table x; end $€$;';
    const out = stripSqlComments(sql);
    expect(out).toBe(sql);
  });

  it('ASCII tag 行為不變', () => {
    expect(stripSqlComments('select $a$ -- x $a$; -- tail\nselect 1;')).toBe('select $a$ -- x $a$;        \nselect 1;');
    expect(stripSqlComments('select $$ -- x $$; /* c */ select 1;')).toBe('select $$ -- x $$;         select 1;');
  });

  it('E 字串前綴：前一字元為非 ASCII 時是識別字的一部分，不啟用反斜線跳脫', () => {
    // é'..' 是識別字 é 接一般字串；\' 不是跳脫，字串在第一個 ' 結束，其後 -- 是註解
    expect(stripSqlComments("select é'a\\' -- c\n")).toBe("select é'a\\'     \n");
    // 單獨的 E'..\'..' 仍啟用跳脫
    expect(stripSqlComments("select E'a\\' -- c' -- d\n")).toBe("select E'a\\' -- c'     \n");
  });
});

describe('G3 原始文字掃描容忍關鍵字間註解（#777 B3）', () => {
  const cases: Array<[string, string, 'writer' | 'drop']> = [
    ['alter/**/function', 'select $€$ -- $€$; alter/**/function public.create_tour_order(int) security definer;', 'writer'],
    ['qualifier dot comment', 'select $€$ -- $€$; alter function public./**/create_tour_order(int) security invoker;', 'writer'],
    ['grant on/**/function', 'select $€$ -- $€$; grant all on/**/function public.create_tour_order(int) to public;', 'writer'],
    ['drop/**/function', 'select $€$ -- $€$; drop/**/function public.create_tour_order(int);', 'drop'],
    ['create/**/or replace', 'create/**/or replace function public.create_tour_order(int) returns int as $$ select 1 $$ language sql;', 'writer'],
    ['€$$ lexer evasion', 'select 1 as €$$, $$ -- $$; alter function/**/public.create_tour_order(int) security invoker;', 'writer'],
    ['line comment between keywords', 'alter--x\nfunction public.create_tour_order(int) security invoker;', 'writer'],
    ['rename to with comment', 'alter function public.foo(int) /* c */ rename/**/to/**/create_tour_order;', 'writer'],
  ];
  for (const [name, sql, flag] of cases) {
    it(name, () => {
      expect(scanCreateTourOrderDdl(sql)[flag]).toBe(true);
    });
  }

  it('無關語句不誤報', () => {
    const r = scanCreateTourOrderDdl('alter function public.other(int) security invoker; -- create_tour_order\nselect 1;');
    expect(r.writer).toBe(false);
    expect(r.drop).toBe(false);
  });
});

describe('G3 掃描效能（#777 N1）', () => {
  const inputs: Array<[string, string]> = [
    ['execute x50000 + on', 'execute '.repeat(50000) + 'on'],
    ['grant x50000', 'grant '.repeat(50000)],
    ['grant on function x', 'grant on function '.repeat(22000)],
    ['alter function x', 'alter function '.repeat(26000)],
    ['unterminated block comments', 'alter /*'.repeat(50000)],
    ['drop gap', 'drop /**/ '.repeat(40000)],
  ];
  for (const [name, sql] of inputs) {
    it(`${name} (${Math.round(sql.length / 1000)}KB) 在 10 秒內完成`, () => {
      const started = Date.now();
      try { scanCreateTourOrderDdl(sql); } catch { /* lexer 畸形輸入可丟錯；只量時間 */ }
      expect(Date.now() - started).toBeLessThan(10000);
    });
  }
});

describe('E 字串續段與 G3 分句／識別字（Opus review B1-B3）', () => {
  const longGap = 'x'.repeat(2100);
  it('B1：E 字串續段內的反斜線跳脫仍有效，後面的 drop 不得被剝除', () => {
    const sql = "create table x(a int);\nselect E'a'\n'\\' -- '; drop table x;";
    expect(stripSqlComments(sql)).toContain('drop table x');
    expect(() => inferMigrationRiskTier(sql)).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });
  it('B1：續段後隱藏 commit 仍可見', () => {
    const sql = "select E'a'\n'\\' -- '; commit;";
    expect(stripSqlComments(sql)).toContain('commit;');
  });
  it('B1：續段可含 -- 註解與空白行；非續段（同行或無換行）不合併', () => {
    expect(stripSqlComments("select 'a' -- c\n\n  -- d\n'b'; -- t\nselect 1;")).toBe("select 'a' -- c\n\n  -- d\n'b';     \nselect 1;");
    expect(stripSqlComments("select 'a' 'b' -- t\n")).toBe("select 'a' 'b'     \n");
  });
  it('B1：G3 repro writer=true', () => {
    const sql = `select E'a'\n'\\' -- '; create /* ${longGap} */ function public.create_tour_order() returns int language sql as 'select 1';`;
    expect(scanCreateTourOrderDdl(sql).writer).toBe(true);
  });
  it('B2：引號識別字含 ; 不得讓有序比對少報', () => {
    expect(scanCreateTourOrderDdl('grant execute on function "x;"(), public.create_tour_order() to anon;').writer).toBe(true);
    expect(scanCreateTourOrderDdl('alter function public."y;"(int) rename to create_tour_order;').writer).toBe(true);
    expect(scanCreateTourOrderDdl('alter default privileges in schema public, "x;" grant execute on functions to anon;').schemaWideAcl).toBe(true);
  });
  it('B3：非 ASCII schema 限定詞', () => {
    expect(scanCreateTourOrderDdl('create function €s.create_tour_order() returns int language sql as $$select 1$$;').writer).toBe(true);
    expect(scanCreateTourOrderDdl('alter function €s.create_tour_order() set schema public;').writer).toBe(true);
    expect(scanCreateTourOrderDdl('alter function public.create_tour_order€(int) set schema public;').writer).toBe(false);
  });
});

describe('E 字串續段的水平空白對齊 PG17（含 \\v，B4）', () => {
  const aliasMap = {
    schemaVersion: 1,
    entries: [
      { repoFile: '0001_base', ledgerNames: ['0001_base'], classification: 'EXACT', evidence: 'x' },
      { repoFile: '0083_source', ledgerNames: ['0082_source'], classification: 'ALIAS', evidence: 'x' },
      { repoFile: '0109_assertions', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
    ],
  };
  const baseSql = 'create table if not exists public.guard_447(id uuid primary key);';
  const rows = [{ version: '1', name: '0001_base' }, { version: '2', name: '0082_source' }];
  // 與 controlled-production-db-release.447 相同的 stale-plan 手法：計畫以安全 SQL 建立，再換成候選 SQL 的 sha，
  // 使 buildAtomicProductionApplySql 內部的 assertAtomicCompatibleSql 針對候選 SQL 執行。
  function applyWith(candidate: string) {
    const plan: any = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: 'a'.repeat(40), plannedAt: '2026-09-14T12:30:00Z',
      aliasMap, readCanonicalSql: () => baseSql,
    });
    plan.migrations[0].sha256 = sha256(Buffer.from(candidate));
    plan.planDigest = releasePlanDigestOf(plan);
    return buildAtomicProductionApplySql({ plan, aliasMap, liveLedgerRows: rows, readCanonicalSql: () => candidate } as any);
  }
  const cont = "select E'a'\v\n'\\' -- ';";

  it('\\v 在續段換行前：drop 不得被剝除，風險分級拒絕', () => {
    const sql = `${cont} drop table x;`;
    expect(stripSqlComments(sql)).toContain('drop table x');
    expect(() => inferMigrationRiskTier(sql)).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });
  it('隱藏的 commit; 被真實 atomic 路徑（buildAtomicProductionApplySql）拒絕', () => {
    expect(() => applyWith(`${cont} commit;`)).toThrow(/TRANSACTION_CONTROL_NOT_ADMITTED/);
  });
  it('隱藏的 set role postgres; 被真實 atomic 路徑拒絕', () => {
    expect(() => applyWith(`${cont} set role postgres;`)).toThrow(/WRITER_CONFIGURATION_NOT_ADMITTED|MIGRATION_RISK_MISMATCH|UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED/);
  });
  it('G3：超長區塊註解 + 續段 \\v，writer=true 且風險分級為 AUTHZ 或被拒絕', () => {
    const sql = `${cont} alter /* ${'x'.repeat(1500)} */ function public.create_tour_order(int) security invoker;`;
    expect(scanCreateTourOrderDdl(sql).writer).toBe(true);
    let tier = '';
    try { tier = inferMigrationRiskTier(sql); } catch { tier = 'REJECTED'; }
    expect(['AUTHZ', 'REJECTED']).toContain(tier);
  });
});
