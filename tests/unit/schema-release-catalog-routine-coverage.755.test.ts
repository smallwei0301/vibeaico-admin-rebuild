import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SCOPED_RELEASE_CAPTURE_SCOPES, selectedProductionMigrations } from '../../scripts/agents/production-db-release-plan.mjs';
import { sourceCatalog } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { RELEASE_CATALOG_SQL } from '../../scripts/agents/schema-drift-watch.mjs';

// 回歸：release catalog 只抓 allowlist 內的 public routine。若 scope closure 內有 routine 不在 allowlist
// （例如 0137 的 create_tour_order_quoted），三環境都抓不到，G2 會以
// RELEASE_ROUTINE_CAPTURE_REQUIRED 卡死。此測試對每個 scope 的 closure 逐一斷言。
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const ALIAS_MAPS = ['supabase/ledger-alias-map.json', 'tests/fixtures/ledger-alias-map.pre-755-s0131-0134.json', 'tests/fixtures/ledger-alias-map.pre-755-s0137.json', 'tests/fixtures/ledger-alias-map.pre-755-s0113.json',
  'tests/fixtures/ledger-alias-map.pre-755-original8.json'];
const FAMILY = ['public.create_tour_order', 'public.cancel_tour_order', 'public.expire_tour_order'];

function scopeMigrations(scope: string): string[] {
  for (const file of ALIAS_MAPS) {
    try { return selectedProductionMigrations(JSON.parse(readFileSync(file, 'utf8')), scope).migrations; } catch { /* 該 alias map 已不含此 scope 的 pending 狀態 */ }
  }
  throw new Error(`no alias map resolves scope ${scope}`);
}

function closureRoutineNames(scope: string): string[] {
  const spec = (SCOPED_RELEASE_CAPTURE_SCOPES as any)[scope];
  const migrations = scopeMigrations(scope).map((repoFile) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` }));
  const source = sourceCatalog({ plan: { migrations }, repoRoot: process.cwd(), readCanonicalSql, appliedSourceFiles: spec.appliedSourceFiles });
  const paths = new Set(migrations.map((item) => item.path));
  const routines = new Map<string, any>();
  for (const [key, routine] of source.after as Map<string, any>) if (paths.has(routine.source.path)) routines.set(key, routine);
  if (spec.createTourOrderFamily) for (const map of [source.before, source.after] as Map<string, any>[]) for (const [key, routine] of map) if (FAMILY.includes(routine.name)) routines.set(key, routine);
  // 依 body 內的呼叫名稱做傳遞閉包（與 deriveClosure 相同的偵測方式）。
  for (let changed = true; changed;) {
    changed = false;
    const code = [...routines.values()].map((routine) => routine.body).join('\n');
    for (const [key, routine] of source.after as Map<string, any>) {
      const name = routine.name.split('.')[1];
      if (!routines.has(key) && new RegExp(`(?:\\bpublic\\.|\\b)${name}\\s*\\(`, 'i').test(code)) { routines.set(key, routine); changed = true; }
    }
  }
  return [...new Set([...routines.values()].map((routine) => routine.name as string))].filter((name) => name.startsWith('public.')).sort();
}

function catalogAllowlist(): Set<string> {
  const match = /n\.nspname='public' and p\.proname in \(([^)]*)\)/.exec(RELEASE_CATALOG_SQL);
  if (!match) throw new Error('RELEASE_CATALOG_SQL proname allowlist not found');
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
}

describe('#755 release catalog routine coverage', () => {
  const allowlist = catalogAllowlist();
  it.each(Object.keys(SCOPED_RELEASE_CAPTURE_SCOPES))('%s closure routines are all captured by RELEASE_CATALOG_SQL', (scope) => {
    const names = closureRoutineNames(scope);
    const missing = names.filter((name) => !allowlist.has(name.slice('public.'.length)));
    expect(missing).toEqual([]);
  });

  it('ISSUE_749_0137 closure includes create_tour_order_quoted', () => {
    expect(closureRoutineNames('ISSUE_749_0137')).toContain('public.create_tour_order_quoted');
  });
});
