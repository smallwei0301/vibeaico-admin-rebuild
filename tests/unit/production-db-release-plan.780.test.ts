import { describe, expect, it } from 'vitest';

import { inferMigrationRiskTier, stripSqlComments } from '../../scripts/agents/production-db-release-plan.mjs';
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
    it(`${name} (${Math.round(sql.length / 1000)}KB) 在 5 秒內完成`, () => {
      const started = Date.now();
      try { scanCreateTourOrderDdl(sql); } catch { /* lexer 畸形輸入可丟錯；只量時間 */ }
      expect(Date.now() - started).toBeLessThan(5000);
    });
  }
});
