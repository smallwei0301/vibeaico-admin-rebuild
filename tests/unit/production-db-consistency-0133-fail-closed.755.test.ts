import { describe, expect, it } from 'vitest';
import { checkCatalogClosure, checkReleaseImpacts } from '../../scripts/agents/production-db-consistency-evidence.mjs';

// #755 G2：gate 不保留 TEST 專屬容忍。TEST 的 0133 複合 FK 若是歷史 SET NULL 變體，必須 fail closed（TEST 需先清理回 canonical）。
const KEY = 'public.booking_addons.booking_addons_tenant_id_performance_staff_id_fkey';
const FK_NAME = 'booking_addons_tenant_id_performance_staff_id_fkey';
const NO_ACTION = 'f|FOREIGN KEY (tenant_id, performance_staff_id) REFERENCES staff(tenant_id, id)';
const SET_NULL = `${NO_ACTION} ON DELETE SET NULL (performance_staff_id)`;
const M0133 = '0133_issue_680_booking_addons_composite_fk_expand';
const plan = (files = [M0133]) => ({ migrations: files.map((repoFile) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })) });
const impacts = [{ repoFile: M0133, impacts: [{ surface: 'constraints', objectKey: KEY }] }];

const cols = [
  ['public.booking_addons.tenant_id', 'uuid|true|'], ['public.booking_addons.performance_staff_id', 'uuid|false|'],
  ['public.staff.tenant_id', 'uuid|true|'], ['public.staff.id', 'uuid|true|'],
].map(([key, value]) => ({ surface: 'columns', key, value }));
function capture(environment: string, fkValue: string | null, key = KEY) {
  const items: any[] = [...cols];
  if (fkValue !== null) items.push({ surface: 'constraints', key, value: fkValue });
  const definition = fkValue?.slice(2) ?? '';
  return {
    environment,
    snapshot: { surfaces: { constraints: { items: items.filter((i) => i.surface === 'constraints').map((i) => ({ key: i.key, fingerprint: i.value })) } }, acl: { items: [] } },
    raw: { metadata: { items }, acl: { tables: [{ name: 'booking_addons', rowSecurity: true, forceRowSecurity: false, policyCount: 0, privileges: [] }] } },
    catalog: {
      foreignKeys: fkValue === null ? [] : [{ table: 'public.booking_addons', target: 'public.staff', name: key.split('.')[2], definition,
        columns: ['tenant_id', 'performance_staff_id'], targetColumns: ['tenant_id', 'id'], validated: true, deferrable: false }],
      enums: [], roles: ['anon', 'authenticated', 'service_role'].map((name) => ({ name, inherit: true })), memberships: [], tableOwners: [{ table: 'public.booking_addons', owner: 'postgres' }], defaults: [], authTarget: null,
    },
  };
}
const world = (test: string | null, production: string | null = null, local: string = NO_ACTION, key = KEY) => ({
  LOCAL_EXPECTED: capture('LOCAL_EXPECTED', local, key), TEST: capture('TEST', test, key), PRODUCTION: capture('PRODUCTION', production, key),
});
const source: any = { read: () => '', before: new Map(), after: new Map(), enums: new Set() };
const closure: any = { tables: new Set(['public.booking_addons']), routines: new Set(), code: '', operations: new Map() };
const allowed = (key = KEY) => new Map([[`constraints:${key}`, M0133]]);
const impactsFor = (key = KEY) => [{ repoFile: M0133, impacts: [{ surface: 'constraints', objectKey: key }] }];
const impactCheck = (captures: any, p: any = plan(), key = KEY, phase = 'pre_apply') => checkReleaseImpacts({ impacts: impactsFor(key), captures, plan: p, source, phase });
const closureCheck = (captures: any, env: 'TEST' | 'PRODUCTION', p: any = plan(), key = KEY) => checkCatalogClosure(captures[env], captures.LOCAL_EXPECTED, closure, allowed(key), source);

describe('#755 G2 TEST 0133 FK 偏離 canonical 一律 fail closed', () => {
  it('TEST 為 SET NULL 變體（plan 含 0133）→ impact 與 closure 皆 fail', () => {
    const w = world(SET_NULL);
    expect(() => impactCheck(w)).toThrow(/RELEASE_TEST_IMPACT_MISMATCH/);
    expect(() => closureCheck(w, 'TEST')).toThrow(/RELEASE_FK_SOURCE_MISMATCH|RELEASE_EXPECTED_CONTRACT_MISSING/);
  });

  it('TEST 與 canonical 相同（NO ACTION）通過（回歸）', () => {
    const w = world(NO_ACTION);
    expect(() => impactCheck(w)).not.toThrow();
    expect(() => closureCheck(w, 'TEST')).not.toThrow();
  });
});
