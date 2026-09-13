import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0088_issue_8b_tour_order_rpc_acl.sql'),
  'utf8',
).toLowerCase();

const functions = [
  'reserve_seats(uuid, integer)',
  'release_seats(uuid, integer)',
  'cancel_tour_order(uuid, uuid, text)',
] as const;

describe('#8-B tour-order SECURITY DEFINER RPC ACL', () => {
  it.each(functions)('%s 撤掉 PUBLIC/瀏覽器角色，只授權 service_role', (signature) => {
    expect(migration).toContain(`revoke all on function public.${signature} from public;`);
    expect(migration).toContain(
      `revoke all on function public.${signature} from anon, authenticated;`,
    );
    expect(migration).toContain(`grant execute on function public.${signature} to service_role;`);
  });

  it('create_tour_order 同樣撤掉 PUBLIC/瀏覽器角色，只授權 service_role', () => {
    const compact = migration.replace(/\s+/g, ' ');
    const signature =
      'public.create_tour_order( uuid, text, uuid, integer, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz )';

    expect(compact).toContain(`revoke all on function ${signature} from public;`);
    expect(compact).toContain(`revoke all on function ${signature} from anon, authenticated;`);
    expect(compact).toContain(`grant execute on function ${signature} to service_role;`);
  });
});
