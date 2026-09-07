import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0085_catalog_position_invariants.sql', import.meta.url)),
  'utf8',
);

function count(pattern: RegExp): number {
  return migration.match(pattern)?.length ?? 0;
}

type Row = { id: string; sort: number; line: number };

/** Mirrors the four ranking phases in 0085, so the direction assertions below have a behavior oracle. */
function apply0085Ranking(input: Row[]): Row[] {
  const byTenant = input.map((row) => ({ ...row }));

  const publicStage = [...byTenant].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  publicStage.forEach((row, index) => { row.sort = -1_000_000_000 - (index + 1); });

  const lineStage = [...byTenant].sort(
    (a, b) => a.line - b.line || b.sort - a.sort || a.id.localeCompare(b.id),
  );
  lineStage.forEach((row, index) => { row.line = -1_000_000_000 - (index + 1); });

  const publicRestore = [...byTenant].sort((a, b) => b.sort - a.sort || a.id.localeCompare(b.id));
  publicRestore.forEach((row, index) => { row.sort = index; });

  const lineRestore = [...byTenant].sort(
    (a, b) => b.line - a.line || a.sort - b.sort || a.id.localeCompare(b.id),
  );
  lineRestore.forEach((row, index) => { row.line = index; });

  return byTenant;
}

describe('#238 0085 migration preserves catalog order through negative staging', () => {
  it('wraps the postdeploy rewrite and index creation in one explicit transaction with a write-blocking table lock', () => {
    const beginIndex = migration.indexOf('begin;');
    const lockIndex = migration.indexOf(
      'lock table public.services, public.products, public.portfolios\n  in share row exclusive mode;',
    );
    const firstRewriteIndex = migration.indexOf('with ranked as (');
    const finalCommitIndex = migration.lastIndexOf('commit;');
    const finalIndexIndex = migration.lastIndexOf(
      'create unique index if not exists portfolios_tenant_line_sort_order_uq',
    );

    expect(beginIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(beginIndex);
    expect(firstRewriteIndex).toBeGreaterThan(lockIndex);
    expect(finalCommitIndex).toBeGreaterThan(finalIndexIndex);
    expect(migration.trim().endsWith('commit;')).toBe(true);
  });

  it('all three public staging passes rank the original order ASC before moving it negative', () => {
    expect(count(/-1000000000 - row_number\(\) over \(partition by tenant_id order by sort_order, id\)/g)).toBe(3);
  });

  it('all three tables restore public staging with DESC, not the reversing ASC form', () => {
    expect(count(/row_number\(\) over \(partition by tenant_id order by sort_order desc, id\) - 1/g)).toBe(3);
    expect(migration).not.toMatch(
      /row_number\(\) over \(partition by tenant_id order by sort_order, id\) - 1/,
    );
  });

  it('all three LINE staging passes use the already-negative public sort in DESC order as tie-break', () => {
    expect(count(/row_number\(\) over \(partition by tenant_id order by line_sort_order, sort_order desc, id\)/g)).toBe(3);
    expect(migration).not.toMatch(
      /row_number\(\) over \(partition by tenant_id order by line_sort_order, sort_order, id\)/,
    );
  });

  it('all three tables restore LINE staging with DESC', () => {
    expect(count(/row_number\(\) over \(partition by tenant_id order by line_sort_order desc, sort_order, id\) - 1/g)).toBe(3);
  });

  it('the four-phase ranking preserves both lanes and a second run is idempotent', () => {
    const original: Row[] = [
      { id: 'a', sort: 0, line: 0 },
      { id: 'b', sort: 1, line: 0 },
      { id: 'c', sort: 2, line: 2 },
      { id: 'd', sort: 3, line: 1 },
    ];

    const once = apply0085Ranking(original);
    expect([...once].sort((a, b) => a.sort - b.sort).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect([...once].sort((a, b) => a.line - b.line).map((row) => row.id)).toEqual(['a', 'b', 'd', 'c']);

    const twice = apply0085Ranking(once);
    expect([...twice].sort((a, b) => a.sort - b.sort).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect([...twice].sort((a, b) => a.line - b.line).map((row) => row.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(twice.map(({ id, sort, line }) => ({ id, sort, line }))).toEqual(
      once.map(({ id, sort, line }) => ({ id, sort, line })),
    );
  });

  it('still creates the six tenant ordering unique indexes', () => {
    for (const name of [
      'services_tenant_sort_order_uq',
      'services_tenant_line_sort_order_uq',
      'products_tenant_sort_order_uq',
      'products_tenant_line_sort_order_uq',
      'portfolios_tenant_sort_order_uq',
      'portfolios_tenant_line_sort_order_uq',
    ]) {
      expect(migration).toContain(`create unique index if not exists ${name}`);
    }
  });
});
