import { describe, expect, it } from 'vitest';
import { RELEASE_CATALOG_SQL, RELEASE_SNAPSHOT_SQL } from '../../scripts/agents/schema-drift-watch.mjs';

// #755 collect 38783115757：schema_observer 沒有 auth schema USAGE，'auth.users'::regclass 的名稱解析
// 需要該 schema USAGE → TEST capture 回 42501（G2 EVIDENCE_UNAVAILABLE）。release catalog 只能經
// pg_catalog（pg_class／pg_namespace）以名稱取 oid，不得以 regclass/regtype 等 cast 解析 auth 物件。
describe('#755 schema observer release catalog without auth schema USAGE', () => {
  it('does not resolve auth objects through reg* casts', () => {
    for (const sql of [RELEASE_CATALOG_SQL, RELEASE_SNAPSHOT_SQL]) {
      expect(sql).not.toMatch(/'auth\.[a-z_]+'::reg[a-z]+/i);
    }
  });

  it('still targets auth.users id via pg_catalog lookup', () => {
    expect(RELEASE_CATALOG_SQL).toMatch(/n\.nspname='auth' and c\.relname='users'/);
    expect(RELEASE_CATALOG_SQL).toMatch(/'authTarget'/);
  });
});
