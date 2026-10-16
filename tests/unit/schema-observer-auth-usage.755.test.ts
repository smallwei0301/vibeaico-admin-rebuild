import { describe, expect, it } from 'vitest';
import { RELEASE_CATALOG_SQL, RELEASE_SNAPSHOT_SQL } from '../../scripts/agents/schema-drift-watch.mjs';
import { PRODUCTION_DB_CATALOG_FINGERPRINT_SQL } from '../../scripts/db/production-db-catalog-fingerprint.mjs';

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

  // collect 38839149283：schema_observer 亦無 extensions schema USAGE，extensions.digest 同樣 42501。
  // observer 讀取的 fingerprint 副本只能用 pg_catalog 內建 sha256（與 digest(...,'sha256') 位元組相同）。
  it('catalog fingerprint does not call functions in the extensions schema', () => {
    for (const sql of [RELEASE_CATALOG_SQL, RELEASE_SNAPSHOT_SQL]) {
      expect(sql).not.toMatch(/extensions\./i);
      expect(sql).toMatch(/pg_catalog\.sha256\(convert_to\(/);
    }
    // writer 端 SQL 不變；observer 副本只換雜湊函式，其餘逐字相同。
    const observerPart = PRODUCTION_DB_CATALOG_FINGERPRINT_SQL.replace(
      /extensions\.digest\(\s*(convert_to\([\s\S]*?'UTF8'\)),\s*'sha256'\s*\)/, 'pg_catalog.sha256($1)');
    expect(RELEASE_CATALOG_SQL).toContain(observerPart.trim().replace(/;\s*$/, ''));
  });
});
