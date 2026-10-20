import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceRoutines } from '../../scripts/agents/production-db-consistency-evidence.mjs';

const MIGRATION = 'supabase/migrations/0119_issue_18_owner_notify_confirm_atomic.sql';
const find = (list: any[], name: string) => list.find((r) => r.name === `public.${name}`);

describe('release routine 回傳型別正規化 (#755 G2 RELEASE_ROUTINE_SOURCE_MISMATCH)', () => {
  const source = sourceRoutines(readFileSync(MIGRATION, 'utf8'), MIGRATION);

  it('0119 owner_notify_max_recipients: returns int 與 pg_get_functiondef 的 RETURNS integer 一致', () => {
    const def = `CREATE OR REPLACE FUNCTION public.owner_notify_max_recipients()\n RETURNS integer\n LANGUAGE sql\n IMMUTABLE\nAS $function$ select 3 $function$`;
    const observed = find(sourceRoutines(def, 'observed-catalog'), 'owner_notify_max_recipients');
    const expected = find(source, 'owner_notify_max_recipients');
    expect(observed.returnType).toBe(expected.returnType);
  });

  it('0119 confirm_owner_notify_bind: returns table (...) 與 RETURNS TABLE(ok boolean, ...) 一致', () => {
    const def = `CREATE OR REPLACE FUNCTION public.confirm_owner_notify_bind(p_tenant_id uuid, p_request_id uuid, p_line_user_id text)\n RETURNS TABLE(ok boolean, reason text, is_primary boolean)\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$ begin end $function$`;
    const observed = find(sourceRoutines(def, 'observed-catalog'), 'confirm_owner_notify_bind');
    const expected = find(source, 'confirm_owner_notify_bind');
    expect(observed.returnType).toBe(expected.returnType);
  });

  it('仍區分真正不同的型別', () => {
    const a = sourceRoutines('create function public.f() returns int language sql as $$ select 1 $$;', 'a')[0];
    const b = sourceRoutines('create function public.f() returns bigint language sql as $$ select 1 $$;', 'b')[0];
    expect(a.returnType).not.toBe(b.returnType);
  });
});
