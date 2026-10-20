import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ISSUE_18_0124_0116_0119_0127, SCOPED_RELEASE_CAPTURE_SCOPES, buildProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { normalizeProductionDbImpactManifest } from '../../scripts/agents/production-db-impact-manifest.mjs';
import {
  checkCatalogClosure, checkReleaseImpacts, derivePlannedTransitions, sourceCatalog,
} from '../../scripts/agents/production-db-consistency-evidence.mjs';

// #755 G2：計畫內 policy／ACL 轉換允許（僅 pre_apply Production、僅 manifest 點名且 SQL 佐證的 key／role）。
// 資料來源：collect run 39361601135 的 G2 catalogs，裁成 booking_addons／owner_notify_recipients 兩表。
const FIXTURE = JSON.parse(readFileSync('tests/fixtures/g2-planned-transition.755.collect-39361601135.json', 'utf8'));
const ALIAS = JSON.parse(readFileSync('tests/fixtures/ledger-alias-map.pre-755-s0124-0116-0119-0127.json', 'utf8'));
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const SHA = 'a'.repeat(40);
const T1 = 'public.booking_addons';
const T2 = 'public.owner_notify_recipients';
const M0116 = '0116_issue_18_owner_notify';
const M0127 = '0127_issue_589_authz_constraint_reconciliation';
const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));

const planFor = () => buildProductionDbReleasePlan({
  releaseId: 'issue755-g2-transition-test-20261020', mainSha: SHA, plannedAt: '2026-10-20T00:00:00Z',
  aliasMap: ALIAS, migrationScope: ISSUE_18_0124_0116_0119_0127, readCanonicalSql,
});
const plan: any = planFor();
const source: any = sourceCatalog({ plan, repoRoot: process.cwd(), readCanonicalSql,
  appliedSourceFiles: (SCOPED_RELEASE_CAPTURE_SCOPES as any)[ISSUE_18_0124_0116_0119_0127].appliedSourceFiles });
// fixture 只含兩表：impact 只取這兩表（0127 的 impact 全數在內；0116 其餘表不在 fixture）。
const onFixtureTables = (i: any) => new RegExp(`(^|:)(${T1}|${T2})(\\.|$)`).test(i.objectKey);
const impactsFor = (p: any, m: any = manifest) => normalizeProductionDbImpactManifest(m).entries
  .filter((entry: any) => p.migrations.some((item: any) => item.repoFile === entry.repoFile))
  .map((entry: any) => ({ ...entry, impacts: entry.impacts.filter(onFixtureTables) }));

const clone = (value: any) => JSON.parse(JSON.stringify(value));
function captureOf(environment: string, mutate: (c: any) => void = () => {}) {
  const f = clone(FIXTURE[environment]);
  const capture: any = {
    environment,
    snapshot: { surfaces: {}, acl: { items: f.acl.map((t: any) => ({ key: `table:public.${t.name}`, fingerprint: JSON.stringify(t.privileges) })) } },
    raw: { metadata: { items: f.items }, acl: { tables: f.acl } },
    catalog: { foreignKeys: [], enums: [], roles: f.roles, memberships: f.memberships, tableOwners: f.tableOwners, defaults: f.defaults },
  };
  mutate(capture);
  for (const surface of ['columns', 'constraints', 'indexes', 'triggers', 'policies']) {
    capture.snapshot.surfaces[surface] = { items: capture.raw.metadata.items.filter((i: any) => i.surface === surface).map((i: any) => ({ key: i.key, fingerprint: i.value })) };
  }
  return capture;
}
const world = (mutateProduction: (c: any) => void = () => {}, mutateTest: (c: any) => void = () => {}) => ({
  LOCAL_EXPECTED: captureOf('LOCAL_EXPECTED'), TEST: captureOf('TEST', mutateTest), PRODUCTION: captureOf('PRODUCTION', mutateProduction),
});
const closureOf = (...tables: string[]) => ({ tables: new Set(tables), routines: new Set(), code: '', operations: new Map() });
const allowedOf = (impacts: any[]) => new Map(impacts.flatMap((entry: any) => entry.impacts.map((i: any) => [`${i.surface}:${i.objectKey}`, entry.repoFile])));
const policyItem = (key: string, value: string) => ({ surface: 'policies', key, value });
const run = (captures: any, { phase = 'pre_apply', tables = [T1, T2], p = plan, m = manifest, src = source }: any = {}) => {
  const impacts = impactsFor(p, m);
  const transitions = checkReleaseImpacts({ impacts, captures, plan: p, source: src, phase });
  const closure = closureOf(...tables);
  for (const env of ['TEST', 'PRODUCTION'] as const) {
    checkCatalogClosure(captures[env], captures.LOCAL_EXPECTED, closure, allowedOf(impacts), src, transitions);
  }
  return transitions;
};

describe('#755 G2 manifest findings for 0127', () => {
  it('manifest already names all nine 0127 policies plus both ACLs; every dropped policy has a SQL drop (no manifest edit needed)', () => {
    const entry = impactsFor(plan).find((item: any) => item.repoFile === M0127);
    const keys = entry.impacts.filter((i: any) => i.surface === 'policies').map((i: any) => i.objectKey).sort();
    expect(keys).toHaveLength(9);
    expect(entry.impacts.filter((i: any) => i.surface === 'acl').map((i: any) => i.objectKey).sort()).toEqual([`table:${T1}`, `table:${T2}`]);
    const t = derivePlannedTransitions({ impacts: impactsFor(plan), plan, source, expectedSnapshot: captureOf('LOCAL_EXPECTED').snapshot });
    expect([...t.droppedPolicies].sort()).toEqual([
      `${T1}.p_booking_addons_d`, `${T1}.p_booking_addons_i`, `${T1}.p_booking_addons_u`,
      `${T2}.p_owner_notify_recipients_d`, `${T2}.p_owner_notify_recipients_i`, `${T2}.p_owner_notify_recipients_s`, `${T2}.p_owner_notify_recipients_u`,
    ].sort());
    expect([...t.aclRolesByTable.get(T1)].sort()).toEqual(['anon', 'authenticated', 'service_role']); // revoke all ... from public 依規則展開為全部 app role
  });
});

describe('#755 G2 planned policy/ACL transition: positive (collect 39361601135 catalogs)', () => {
  it('pre_apply: Production legacy policies/ACL vs LOCAL_EXPECTED passes impacts and closure for both tables', () => {
    const captures: any = world();
    // 前提：這組真實 catalog 在舊規則下確實會失敗（重現原問題）。
    expect(captures.PRODUCTION.raw.metadata.items.filter((i: any) => i.surface === 'policies' && i.key.startsWith(T2))).toHaveLength(4);
    expect(() => checkCatalogClosure(captures.PRODUCTION, captures.LOCAL_EXPECTED, closureOf(T2), allowedOf(impactsFor(plan)), source)).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH/);
    const transitions = run(captures);
    expect(transitions.droppedPolicies.size).toBe(7);
  });

  it('post_apply: a Production that already equals expected passes with no allowance', () => {
    const exp = captureOf('LOCAL_EXPECTED');
    const post = (c: any) => {
      c.raw.metadata.items = c.raw.metadata.items.filter((i: any) => i.surface !== 'policies').concat(exp.raw.metadata.items.filter((i: any) => i.surface === 'policies'));
      c.raw.acl.tables = clone(exp.raw.acl.tables);
    };
    const captures: any = world(post);
    expect(() => run(captures, { phase: 'post_apply' })).not.toThrow();
  });
});

describe('#755 G2 planned transition: counterexamples fail closed', () => {
  it('an unplanned extra policy on the same table still fails', () => {
    const captures: any = world((c) => c.raw.metadata.items.push(policyItem(`${T2}.p_owner_notify_recipients_rogue`, 'true|*|anon|true|true')));
    expect(() => run(captures)).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH/);
  });

  it('an unplanned extra policy cannot hide behind a planned (named) key whose predicate differs', () => {
    const captures: any = world((c) => c.raw.metadata.items.push(policyItem(`${T1}.p_booking_addons_extra`, 'true|r|public|true|')));
    expect(() => run(captures)).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH/);
  });

  it('documented: a named (planned-drop) policy may have any predicate in the pre-state, because the migration drops it', () => {
    const captures: any = world((c) => {
      const i = c.raw.metadata.items.find((x: any) => x.key === `${T1}.p_booking_addons_i`);
      i.value = 'true|a|anon||true';
    });
    expect(() => run(captures)).not.toThrow();
  });

  it('a policy change on a table not in the plan is not allowed', () => {
    const other = (c: any) => {
      c.raw.metadata.items.push({ surface: 'columns', key: 'public.other_tbl.id', value: 'uuid|true|' });
      c.raw.acl.tables.push({ name: 'other_tbl', rowSecurity: true, forceRowSecurity: false, policyCount: 1, privileges: [] });
      c.catalog.tableOwners.push({ table: 'public.other_tbl', owner: 'postgres' });
    };
    const captures: any = world((c) => { other(c); c.raw.metadata.items.push(policyItem('public.other_tbl.p_other', 'true|*|anon|true|true')); });
    captures.LOCAL_EXPECTED = captureOf('LOCAL_EXPECTED', (c) => { other(c); c.raw.metadata.items.push(policyItem('public.other_tbl.p_other', 'true|r|authenticated|is_tenant_member(tenant_id)|')); });
    captures.TEST = captureOf('TEST', (c) => { other(c); c.raw.metadata.items.push(policyItem('public.other_tbl.p_other', 'true|r|authenticated|is_tenant_member(tenant_id)|')); });
    expect(() => run(captures, { tables: [T1, T2, 'public.other_tbl'] })).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH.*other_tbl/);
  });

  it('a named policy key on another table is not honoured for this table (allowance is per table)', () => {
    const captures: any = world((c) => c.raw.metadata.items.push(policyItem(`${T1}.p_owner_notify_recipients_s`, 'true|r|public|true|')));
    expect(() => run(captures)).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH/);
  });

  it('RLS enabled/force flags are never relaxed', () => {
    const captures: any = world((c) => { c.raw.acl.tables.find((t: any) => t.name === 'owner_notify_recipients').rowSecurity = false; });
    expect(() => run(captures)).toThrow(/RELEASE_TABLE_RLS_MISMATCH/);
    const force: any = world((c) => { c.raw.acl.tables.find((t: any) => t.name === 'booking_addons').forceRowSecurity = true; });
    expect(() => run(force)).toThrow(/RELEASE_TABLE_RLS_MISMATCH/);
  });

  it('owner checks and TEST comparisons are never relaxed', () => {
    expect(() => run(world((c) => { c.catalog.tableOwners.find((o: any) => o.table === T1).owner = 'attacker'; }))).toThrow(/RELEASE_TABLE_OWNER_INVALID/);
    // TEST 仍持有計畫要 drop 的舊 policy → after 狀態不一致。
    expect(() => run(world(() => {}, (c) => c.raw.metadata.items.push(policyItem(`${T2}.p_owner_notify_recipients_s`, 'true|r|public|is_tenant_member(tenant_id)|'))))).toThrow(/RELEASE_TEST_IMPACT_MISMATCH/);
  });

  it('post_apply with a leftover legacy policy fails (impact check and closure)', () => {
    const exp = captureOf('LOCAL_EXPECTED');
    const post = (c: any) => {
      c.raw.metadata.items = c.raw.metadata.items.filter((i: any) => i.surface !== 'policies').concat(exp.raw.metadata.items.filter((i: any) => i.surface === 'policies'));
      c.raw.acl.tables = clone(exp.raw.acl.tables);
    };
    const leftover: any = world((c) => { post(c); c.raw.metadata.items.push(policyItem(`${T2}.p_owner_notify_recipients_s`, 'true|r|public|is_tenant_member(tenant_id)|')); });
    expect(() => run(leftover, { phase: 'post_apply' })).toThrow(/RELEASE_POST_APPLY_LEGACY_POLICY/);
    // 純 pre-state Production 在 post_apply 不得過關。
    expect(() => run(world(), { phase: 'post_apply' })).toThrow(/RELEASE_(BEFORE_IMPACT_UNEXPLAINED|POST_APPLY_LEGACY_POLICY)/);
    // 即使 impact 檢查被繞過，closure 在 post_apply 也不放行（transitions 為空）。
    const empty = derivePlannedTransitions({ impacts: impactsFor(plan), plan, source, expectedSnapshot: captureOf('LOCAL_EXPECTED').snapshot, phase: 'post_apply' });
    expect(empty.namedPolicies.size + empty.policyKeysByTable.size + empty.aclRolesByTable.size).toBe(0);
    expect(() => checkCatalogClosure(leftover.PRODUCTION, leftover.LOCAL_EXPECTED, closureOf(T2), allowedOf(impactsFor(plan)), source, empty)).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH/);
    expect(() => derivePlannedTransitions({ impacts: [], plan, source, expectedSnapshot: null, phase: 'bogus' })).toThrow(/INVALID_RELEASE_PHASE/);
  });

  it('TEST/LOCAL comparisons never receive the allowance', () => {
    const impacts = impactsFor(plan);
    const captures: any = world();
    const transitions = checkReleaseImpacts({ impacts, captures, plan, source });
    captures.TEST.raw.metadata.items.push(policyItem(`${T2}.p_owner_notify_recipients_rogue`, 'true|*|anon|true|true'));
    expect(() => checkCatalogClosure(captures.TEST, captures.LOCAL_EXPECTED, closureOf(T2), allowedOf(impacts), source, transitions)).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH/);
    captures.TEST = captureOf('TEST');
    captures.TEST.raw.acl.tables.find((t: any) => t.name === 'owner_notify_recipients').privileges.push({ grantee: 'anon', privilege: 'SELECT', grantable: false });
    expect(() => checkCatalogClosure(captures.TEST, captures.LOCAL_EXPECTED, closureOf(T2), allowedOf(impacts), source, transitions)).toThrow(/RELEASE_APP_GRANT_MISMATCH/);
  });

  it('a dropped-looking impact without SQL proof stays RELEASE_EXPECTED_IMPACT_MISSING', () => {
    const noDropSource = { ...source, read: (path: string) => String(source.read(path)).replace(/drop policy if exists p_owner_notify_recipients_s on public\.owner_notify_recipients;/i, '') };
    expect(() => run(world(), { src: noDropSource })).toThrow(/RELEASE_EXPECTED_IMPACT_MISSING.*p_owner_notify_recipients_s/);
  });

  it('without 0127 in the plan the old strict behaviour applies (legacy policies are not tolerated)', () => {
    const p0116: any = { ...plan, migrations: plan.migrations.filter((item: any) => item.repoFile === M0116) };
    const captures: any = world();
    // 不含 0127：不存在 drop 轉換，Production 的舊 policy 與 owner_notify_recipients 的新 ACL 必須與 expected 完全相同。
    const impacts = impactsFor(p0116);
    expect(impacts.map((e: any) => e.repoFile)).toEqual([M0116]);
    const transitions = derivePlannedTransitions({ impacts, plan: p0116, source, expectedSnapshot: captures.LOCAL_EXPECTED.snapshot });
    expect(transitions.droppedPolicies.size).toBe(0);
    expect(() => checkCatalogClosure(captures.PRODUCTION, captures.LOCAL_EXPECTED, closureOf(T2), allowedOf(impacts), source, transitions)).toThrow(/RELEASE_RLS_PREDICATE_MISMATCH/);
  });
});

describe('#755 G2 planned ACL transition: counterexamples', () => {
  // 合成 SQL：只 revoke／grant authenticated；manifest 只點名該表的 acl。
  const sql = `drop policy if exists p_x_old on public.x_tbl;
    create policy p_x_new on public.x_tbl for select to authenticated using (true);
    revoke all on table public.x_tbl from authenticated;
    grant select on table public.x_tbl to authenticated;`;
  const syntheticPlan: any = { migrations: [{ repoFile: '9999_x', path: 'p' }] };
  const syntheticSource: any = { read: () => sql };
  const expectedSnapshot = { surfaces: { policies: { items: [{ key: 'public.x_tbl.p_x_new', fingerprint: 'f' }] } } };
  const impacts = (withAcl: boolean) => [{ repoFile: '9999_x', impacts: [
    { surface: 'policies', objectKey: 'public.x_tbl.p_x_old' }, { surface: 'policies', objectKey: 'public.x_tbl.p_x_new' },
    ...(withAcl ? [{ surface: 'acl', objectKey: 'table:public.x_tbl' }] : []),
  ] }];
  const roles = ['anon', 'authenticated', 'service_role'].map((name) => ({ name, inherit: true }));
  const cap = (environment: string, grants: string[], policies: any[]) => ({
    environment,
    raw: { metadata: { items: [{ surface: 'columns', key: 'public.x_tbl.id', value: 'uuid|true|' }, ...policies] },
      acl: { tables: [{ name: 'x_tbl', rowSecurity: true, forceRowSecurity: false, policyCount: 1,
        privileges: grants.map((g) => ({ grantee: g.split(':')[0], privilege: g.split(':')[1], grantable: false })) }] } },
    catalog: { foreignKeys: [], enums: [], roles, memberships: [], tableOwners: [{ table: 'public.x_tbl', owner: 'postgres' }], defaults: [] },
  });
  const newPolicy = policyItem('public.x_tbl.p_x_new', 'true|r|authenticated|true|');
  const oldPolicy = policyItem('public.x_tbl.p_x_old', 'true|*|public|true|true');
  const expected: any = cap('LOCAL_EXPECTED', ['authenticated:SELECT'], [newPolicy]);
  const t = (withAcl: boolean, phase = 'pre_apply') => derivePlannedTransitions({ impacts: impacts(withAcl), plan: syntheticPlan, source: syntheticSource, expectedSnapshot, phase });
  const check = (production: any, transitions: any) => checkCatalogClosure(production, expected, closureOf('public.x_tbl'), new Map(), {}, transitions);

  it('derives roles only from the grant/revoke statements of the plan migration', () => {
    expect([...t(true).aclRolesByTable.get('public.x_tbl')]).toEqual(['authenticated']);
    expect(t(false).aclRolesByTable.size).toBe(0);
  });
  it('a role that only receives grant (no revoke all on that table) is still compared exactly', () => {
    const grantOnly: any = { migrations: [{ repoFile: '9999_x', path: 'p' }] };
    const src: any = { read: () => 'grant select on table public.x_tbl to authenticated; revoke all on table public.x_tbl from anon;' };
    const tr = derivePlannedTransitions({ impacts: impacts(true), plan: grantOnly, source: src, expectedSnapshot, phase: 'pre_apply' });
    expect([...tr.aclRolesByTable.get('public.x_tbl')]).toEqual(['anon']);
    const extra = cap('PRODUCTION', ['authenticated:SELECT', 'authenticated:INSERT'], [newPolicy]);
    expect(() => check(extra, tr)).toThrow(/RELEASE_APP_GRANT_MISMATCH.*authenticated/);
  });
  it('revoke all on table A does not exempt the same role on table B', () => {
    const src: any = { read: () => 'revoke all on table public.y_tbl from authenticated; grant select on table public.x_tbl to authenticated;' };
    const tr = derivePlannedTransitions({ impacts: impacts(true), plan: syntheticPlan, source: src, expectedSnapshot, phase: 'pre_apply' });
    expect(tr.aclRolesByTable.has('public.x_tbl')).toBe(false);
    const extra = cap('PRODUCTION', ['authenticated:SELECT', 'authenticated:INSERT'], [newPolicy]);
    expect(() => check(extra, tr)).toThrow(/RELEASE_APP_GRANT_MISMATCH/);
  });
  it('named role (authenticated) may differ in the pre-state; a role not named (anon) may not', () => {
    const named = cap('PRODUCTION', ['authenticated:SELECT', 'authenticated:INSERT'], [newPolicy, oldPolicy]);
    expect(() => check(named, t(true))).not.toThrow();
    const widened = cap('PRODUCTION', ['authenticated:SELECT', 'anon:SELECT'], [newPolicy, oldPolicy]);
    expect(() => check(widened, t(true))).toThrow(/RELEASE_APP_GRANT_MISMATCH.*anon/);
  });
  it('without an ACL impact in the manifest, the grant comparison is unchanged', () => {
    const named = cap('PRODUCTION', ['authenticated:SELECT', 'authenticated:INSERT'], [newPolicy, oldPolicy]);
    expect(() => check(named, t(false))).toThrow(/RELEASE_APP_GRANT_MISMATCH.*authenticated/);
  });
  it('post_apply gets no ACL allowance', () => {
    const named = cap('PRODUCTION', ['authenticated:SELECT', 'authenticated:INSERT'], [newPolicy]);
    expect(() => check(named, t(true, 'post_apply'))).toThrow(/RELEASE_APP_GRANT_MISMATCH/);
  });
  it('TEST never gets the allowance even with the same transitions', () => {
    const test = cap('TEST', ['authenticated:SELECT', 'authenticated:INSERT'], [newPolicy]);
    expect(() => check(test, t(true))).toThrow(/RELEASE_APP_GRANT_MISMATCH/);
  });
});
