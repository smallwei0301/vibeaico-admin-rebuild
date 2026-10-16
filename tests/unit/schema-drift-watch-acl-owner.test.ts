import { describe, expect, it } from 'vitest';
import { ACL_FINGERPRINT_VERSION, OWNER_EQUIVALENT_ACL_ROLES, buildObserverSnapshotFromRaw } from '../../scripts/agents/schema-drift-watch.mjs';

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
const REFS: Record<string, string> = { PRODUCTION: 'egehnijjpgijmccagxac', TEST: 'nmwhwngojosmagjuvxol', LOCAL_EXPECTED: 'local-fresh' };
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
      [grant('production_migration_owner', 'SELECT'), grant('postgres', 'DELETE')],
      [grant('postgres', 'EXECUTE'), grant('production_migration_owner', 'EXECUTE')]);
    expect(aclOf(production, 'PRODUCTION')).toEqual(aclOf(testLike(), 'TEST'));
  });
  it('is environment-aware: owner drift stays visible', () => {
    const prodOwner = () => aclRaw('production_migration_owner', [grant('postgres', 'SELECT')], [grant('postgres', 'EXECUTE')]);
    expect(aclOf(aclRaw('production_migration_owner', [grant('production_migration_owner', 'SELECT')], [grant('production_migration_owner', 'EXECUTE')]), 'PRODUCTION').items).toEqual(aclOf(testLike(), 'TEST').items);
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

// Real current ACL shapes (aclexplode privilege_type names for the compact letters).
const FULL = ['INSERT', 'SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const RO = ['SELECT', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const grants = (grantee: string, privileges: string[]) => privileges.map((privilege) => grant(grantee, privilege));
const table = (name: string, privileges: any[]) => ({ schema: 'public', name, rowSecurity: true, forceRowSecurity: false, policyCount: 0, privileges });
const fn = (name: string, owner: string, grantees: string[]) => ({ schema: 'public', name, identityArguments: 'p uuid', owner, securityDefiner: true,
  privileges: grantees.map((g) => grant(g, 'EXECUTE')) });
const real = (tables: any[], functions: any[]) => ({ metadata: aclRaw('postgres').metadata, acl: { tables, functions }, ledger: aclRaw('postgres').ledger });
const client = (privs: string[]) => [...grants('anon', privs), ...grants('authenticated', privs), ...grants('service_role', FULL)];

describe('directional owner/grantee normalization on real ACL shapes', () => {
  const testSide = () => real(
    [table('external_calendars', [...grants('postgres', FULL), ...client(FULL)]), table('tour_orders', [...grants('postgres', FULL), ...grants('anon', RO), ...grants('authenticated', RO), ...grants('service_role', FULL)])],
    [fn('accept_tour_request', 'postgres', ['postgres', 'service_role']), fn('cancel_tour_order', 'postgres', ['postgres', 'service_role'])]);
  const prodSide = () => real(
    [table('external_calendars', [...grants('postgres', FULL), ...client(FULL), ...grants('production_migration_owner', FULL)]),
      table('tour_orders', [...grants('production_migration_owner', FULL), ...grants('anon', RO), ...grants('authenticated', RO), ...grants('service_role', FULL)])],
    [fn('accept_tour_request', 'production_migration_owner', ['postgres', 'service_role', 'production_migration_owner']),
      fn('cancel_tour_order', 'production_migration_owner', ['production_migration_owner', 'service_role'])]);
  it('keeps the real PROD and TEST shapes equal', () => {
    expect(aclOf(prodSide(), 'PRODUCTION').items).toEqual(aclOf(testSide(), 'TEST').items);
    expect(aclOf(prodSide(), 'PRODUCTION').digest).toEqual(aclOf(testSide(), 'TEST').digest);
  });
  it('differs when a Production table owner drifted to postgres', () => {
    const drifted: any = prodSide();
    drifted.acl.tables[1] = table('tour_orders', [...grants('postgres', FULL), ...grants('anon', RO), ...grants('authenticated', RO), ...grants('service_role', FULL)]);
    expect(aclOf(drifted, 'PRODUCTION').items).not.toEqual(aclOf(testSide(), 'TEST').items);
  });
  it('differs when a Production function owner is postgres', () => {
    const drifted: any = prodSide();
    drifted.acl.functions[1] = fn('cancel_tour_order', 'postgres', ['production_migration_owner', 'service_role']);
    expect(aclOf(drifted, 'PRODUCTION').items).not.toEqual(aclOf(testSide(), 'TEST').items);
  });
  it('is ACL fingerprint version 4', () => { expect(ACL_FINGERPRINT_VERSION).toBe(4); });
  it('supabase_admin-owned function with a real postgres grant is equal across PRODUCTION and LOCAL_EXPECTED', () => {
    const ext = () => aclRaw('supabase_admin', [], [grant('postgres', 'EXECUTE')]);
    expect(aclOf(ext(), 'PRODUCTION').items).toEqual(aclOf(ext(), 'LOCAL_EXPECTED').items);
    // and a dropped postgres grant on such an object is still a visible difference
    expect(aclOf(aclRaw('supabase_admin'), 'PRODUCTION').items).not.toEqual(aclOf(ext(), 'PRODUCTION').items);
  });
  it('tables without an owner field keep the directional normalization', () => {
    const prod = aclRaw('production_migration_owner', [grant('production_migration_owner', 'SELECT'), grant('postgres', 'DELETE')]);
    const local = aclRaw('postgres', [grant('postgres', 'SELECT')]);
    const tableOf = (value: any, environment: string) => aclOf(value, environment).items.find((item: any) => item.key.startsWith('table:'));
    expect(tableOf(prod, 'PRODUCTION')).toEqual(tableOf(local, 'LOCAL_EXPECTED'));
  });
});
