import { describe, expect, it } from 'vitest';
import { checkCatalogClosure, checkReleaseImpacts, deriveClosure, sourceRoutines } from '../../scripts/agents/production-db-consistency-evidence.mjs';

// #755 G2：TEST 歷史殘留 `ON DELETE SET NULL (performance_staff_id)` 複合 FK 為 0133 明確接受的分支（Production 套用後為 NO ACTION）。
// 凍結常數容忍：僅 TEST、僅此 key、僅 plan 含 0133、兩側值逐字相等；其餘一律照原規則 fail。
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
const closureCheck = (captures: any, env: 'TEST' | 'PRODUCTION', p: any = plan(), key = KEY) => checkCatalogClosure(captures[env], captures.LOCAL_EXPECTED, closure, allowed(key), source, null, p);

describe('#755 G2 TEST 0133 SET NULL 複合 FK 變體容忍', () => {
  it('正向：TEST 為 SET NULL 精確字串且 plan 含 0133 → impact 與 closure 皆通過', () => {
    const w = world(SET_NULL);
    expect(() => impactCheck(w)).not.toThrow();
    expect(() => closureCheck(w, 'TEST')).not.toThrow();
  });

  it('TEST 與 canonical 相同（NO ACTION）本來就通過（回歸）', () => {
    const w = world(NO_ACTION);
    expect(() => impactCheck(w)).not.toThrow();
    expect(() => closureCheck(w, 'TEST')).not.toThrow();
  });

  it.each([
    ['CASCADE', `${NO_ACTION} ON DELETE CASCADE`],
    ['SET DEFAULT', `${NO_ACTION} ON DELETE SET DEFAULT (performance_staff_id)`],
    ['整列 SET NULL（無欄位清單）', `${NO_ACTION} ON DELETE SET NULL`],
    ['尾端多餘字元', `${SET_NULL} `],
  ])('負向：TEST 其他 delete action（%s）仍 fail', (_name, value) => {
    const w = world(value);
    expect(() => impactCheck(w)).toThrow(/RELEASE_TEST_IMPACT_MISMATCH/);
    expect(() => closureCheck(w, 'TEST')).toThrow(/RELEASE_FK_SOURCE_MISMATCH|RELEASE_EXPECTED_CONTRACT_MISSING/);
  });

  it('負向：其他 key 即使值相同仍 fail', () => {
    const other = 'public.booking_addons.booking_addons_other_fkey';
    const w = world(SET_NULL, null, NO_ACTION, other);
    expect(() => impactCheck(w, plan(), other)).toThrow(/RELEASE_TEST_IMPACT_MISMATCH/);
    expect(() => closureCheck(w, 'TEST', plan(), other)).toThrow(/RELEASE_FK_SOURCE_MISMATCH|RELEASE_EXPECTED_CONTRACT_MISSING/);
  });

  it('負向：plan 不含 0133 時不容忍', () => {
    const w = world(SET_NULL);
    const p = plan(['0121_issue_17_booking_addons_hardening']);
    expect(() => checkReleaseImpacts({ impacts: [{ repoFile: '0121_issue_17_booking_addons_hardening', impacts: [{ surface: 'constraints', objectKey: KEY }] }], captures: w, plan: p, source, phase: 'pre_apply' })).toThrow(/RELEASE_TEST_IMPACT_MISMATCH/);
    expect(() => closureCheck(w, 'TEST', p)).toThrow(/RELEASE_FK_SOURCE_MISMATCH|RELEASE_EXPECTED_CONTRACT_MISSING/);
    expect(() => closureCheck(w, 'TEST', null)).toThrow(/RELEASE_FK_SOURCE_MISMATCH|RELEASE_EXPECTED_CONTRACT_MISSING/);
  });

  it('負向：LOCAL_EXPECTED 不是精確 NO ACTION 時不容忍', () => {
    const w = world(SET_NULL, null, `${NO_ACTION} ON DELETE CASCADE`);
    expect(() => impactCheck(w)).toThrow(/RELEASE_TEST_IMPACT_MISMATCH/);
    expect(() => closureCheck(w, 'TEST')).toThrow(/RELEASE_FK_SOURCE_MISMATCH|RELEASE_EXPECTED_CONTRACT_MISSING/);
  });

  it('負向：PRODUCTION 出現 SET NULL 不放寬（closure 與 post_apply impact）', () => {
    const w = world(SET_NULL, SET_NULL);
    expect(() => closureCheck(w, 'PRODUCTION')).toThrow(/RELEASE_FK_SOURCE_MISMATCH|RELEASE_EXPECTED_CONTRACT_MISSING/);
    expect(() => impactCheck(w, plan(), KEY, 'post_apply')).toThrow(/RELEASE_BEFORE_IMPACT_UNEXPLAINED/);
  });

  it('負向：post_apply 的 TEST 以外環境差異不被放行（PRODUCTION NO ACTION 以外的值）', () => {
    const w = world(SET_NULL, `${NO_ACTION} ON DELETE CASCADE`);
    expect(() => impactCheck(w)).toThrow(/RELEASE_BEFORE_IMPACT_UNEXPLAINED/);
  });
});

describe('#755 G2 SRF 豁免只限 from/join 後的函式呼叫', () => {
  const MIGRATION = { path: 'supabase/migrations/9000_fixture.sql', repoFile: '9000_fixture' };
  const sql = `create or replace function public.fixture_t(p jsonb) returns setof text language sql as $a$ select 'x' $a$;
create or replace function public.fixture_use(p_id uuid) returns void language plpgsql as $b$
begin insert into public.fixture_t (id) values (p_id); end; $b$;`;
  it('routine 與表同名時，insert into public.t (cols) 不得被當成 SRF 跳過', () => {
    const after = new Map(sourceRoutines(sql, MIGRATION.path).map((routine: any) => [`${routine.name}(${routine.args})`, routine]));
    const mk = (tables: string[]) => ({ raw: { metadata: { items: [] } }, catalog: { foreignKeys: [], tableOwners: tables.map((table) => ({ table, owner: 'postgres' })) } });
    const none = { LOCAL_EXPECTED: mk([]), TEST: mk([]), PRODUCTION: mk([]) };
    expect(() => deriveClosure({ source: { sources: new Map(), before: new Map(), after, read: () => sql } as any, plan: { migrations: [MIGRATION] },
      impactManifest: { schemaVersion: 1, entries: [] }, captures: none as any, createTourOrderFamily: false })).toThrow(/RELEASE_UNSOURCED_DEPENDENCY: public\.fixture_t/);
  });
});
