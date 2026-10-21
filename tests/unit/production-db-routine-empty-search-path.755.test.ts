import { describe, expect, it } from 'vitest';
import { sourceRoutines } from '../../scripts/agents/production-db-consistency-evidence.mjs';

// pg_proc.proconfig 對 `SET search_path TO ''` 記為 search_path=""；來源解析必須一致。
const fn = (setClause: string) => `create or replace function public.fixture_sp(p int) returns integer language plpgsql ${setClause} as $f$ begin return 1; end; $f$;`;
const configOf = (clause: string) => sourceRoutines(fn(clause), 'x.sql')[0].config;

describe('#755 routine 來源解析 search_path', () => {
  it.each(["set search_path to ''", "set search_path = ''", 'set search_path = ""', "SET search_path TO ''"])('空字串 %s → search_path=""', (clause) => {
    expect(configOf(clause)).toEqual(['search_path=""']);
  });
  it('pg_get_functiondef 輸出的 SET search_path TO \'\' 與 catalog proconfig 一致', () => {
    const def = "CREATE OR REPLACE FUNCTION public.fixture_sp(p integer)\n RETURNS integer\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$ begin return 1; end; $function$\n";
    expect(sourceRoutines(def, 'observed-catalog')[0].config).toEqual(['search_path=""']);
  });
  it.each([
    ['set search_path = public', ['search_path=public']],
    ['set search_path = public, pg_temp', ['search_path=public, pg_temp']],
    ["set search_path to 'public', 'pg_temp'", ['search_path=public, pg_temp']],
    ['set search_path = "$user", public', ['search_path=$user, public']],
  ])('非空值行為不變 %s', (clause, expected) => {
    expect(configOf(clause)).toEqual(expected);
  });
  it('未設定 search_path 時 config 為 null', () => {
    expect(configOf('')).toBeNull();
  });
});
