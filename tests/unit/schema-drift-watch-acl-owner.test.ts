import { describe, expect, it } from 'vitest';
import { OWNER_EQUIVALENT_ACL_ROLES, buildObserverSnapshotFromRaw } from '../../scripts/agents/schema-drift-watch.mjs';

const MAIN = 'a'.repeat(40);
const grant = (grantee: string, privilege: string) => ({ grantee, privilege, grantable: false });
const aclRaw = (owner: string, extra: any[] = [], fnPrivs: any[] = [], securityDefiner = false) => ({
  metadata: { counts: { columns: 1, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [{ surface: 'columns', key: 'public.tours.id', value: 'uuid|false|' }] },
  acl: {
    tables: [{ schema: 'public', name: 'tours', rowSecurity: true, forceRowSecurity: false, policyCount: 0,
      privileges: [grant('authenticated', 'SELECT'), grant('service_role', 'UPDATE'), ...extra] }],
    functions: [{ schema: 'public', name: 'fn_x', identityArguments: 'p uuid', owner, securityDefiner,
      privileges: [grant('authenticated', 'EXECUTE'), grant('service_role', 'EXECUTE'), ...fnPrivs] }],
  },
  ledger: [{ version: '0105', name: '0105_previous_migration' }],
});
const REFS: Record<string, string> = { PRODUCTION: 'egehnijjpgijmccagxac', TEST: 'nmwhwngojosmagjuvxol' };
const aclOf = (value: any, environment = 'TEST') => buildObserverSnapshotFromRaw({
  environment, projectRef: REFS[environment], observedAt: '2026-09-14T01:18:00Z',
  observedMainSha: MAIN, evidenceRef: `supabase:${environment.toLowerCase()}/schema-observer`, raw: value,
}).acl;
const testLike = () => aclRaw('postgres', [grant('postgres', 'SELECT')], [grant('postgres', 'EXECUTE')]);

describe('ACL fingerprint ignores owner-equivalent roles only', () => {
  it('freezes the owner-equivalent role set', () => {
    expect([...OWNER_EQUIVALENT_ACL_ROLES]).toEqual(['postgres', 'production_migration_owner']);
    expect([...OWNER_EQUIVALENT_ACL_ROLES]).not.toContain('supabase_admin');
    expect(Object.isFrozen(OWNER_EQUIVALENT_ACL_ROLES)).toBe(true);
  });
  it('Production-like and TEST-like owner roles produce identical ACL fingerprints', () => {
    const production = aclRaw('production_migration_owner',
      [grant('production_migration_owner', 'DELETE'), grant('postgres', 'SELECT')],
      [grant('postgres', 'EXECUTE'), grant('production_migration_owner', 'EXECUTE')]);
    expect(aclOf(production, 'PRODUCTION')).toEqual(aclOf(testLike(), 'TEST'));
  });
  it('is environment-aware: owner drift stays visible', () => {
    const prodOwner = () => aclRaw('production_migration_owner', [grant('postgres', 'SELECT')], [grant('postgres', 'EXECUTE')]);
    expect(aclOf(prodOwner(), 'PRODUCTION').items).toEqual(aclOf(testLike(), 'TEST').items);
    expect(aclOf(testLike(), 'PRODUCTION').items).not.toEqual(aclOf(testLike(), 'TEST').items); // PROD owner postgres
    expect(aclOf(prodOwner(), 'TEST').items).not.toEqual(aclOf(prodOwner(), 'PRODUCTION').items); // TEST owner production_migration_owner
    expect(aclOf(prodOwner(), 'TEST').items).not.toEqual(aclOf(testLike(), 'TEST').items);
  });
  it.each([
    ['anon EXECUTE added', aclRaw('postgres', [], [grant('anon', 'EXECUTE')])],
    ['authenticated INSERT added', aclRaw('postgres', [grant('authenticated', 'INSERT')])],
    ['public EXECUTE added', aclRaw('postgres', [], [grant('public', 'EXECUTE')])],
    ['securityDefiner changed', aclRaw('postgres', [], [], true)],
    ['unexpected owner', aclRaw('evil_role')],
    ['owner supabase_admin vs postgres', aclRaw('supabase_admin', [grant('postgres', 'SELECT')], [grant('postgres', 'EXECUTE')])],
    ['supabase_admin grant added', aclRaw('postgres', [grant('supabase_admin', 'SELECT')])],
  ])('still differs when %s', (_label, changed) => {
    expect(aclOf(changed).items).not.toEqual(aclOf(testLike()).items);
    expect(aclOf(changed).digest).not.toEqual(aclOf(testLike()).digest);
  });
  it('keeps rowSecurity and policyCount compared', () => {
    const rls: any = testLike(); rls.acl.tables[0].rowSecurity = false;
    const policies: any = testLike(); policies.acl.tables[0].policyCount = 2;
    expect(aclOf(rls).items).not.toEqual(aclOf(testLike()).items);
    expect(aclOf(policies).items).not.toEqual(aclOf(testLike()).items);
  });
});
