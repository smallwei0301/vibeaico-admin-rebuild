import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = '0106_deduplicate_redundant_indexes.sql';
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', FILE), 'utf8');
const executable = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('#413 guarded duplicate-index cleanup', () => {
  it('uses only the four audited name pairs', () => {
    expect(sql).toContain("'trip_addons', 'trip_addons_trip_idx', 'trip_addons_tenant_trip_sort_idx'");
    expect(sql).toContain("'tour_orders', 'tour_orders_tenant_status_idx', 'i_tour_orders'");
    expect(sql).toContain("'tour_orders', 'tour_orders_traveler_idx', 'i_tour_orders_traveler'");
    expect(sql).toContain("'tenant_payment_methods', 'i_tenant_payment_methods_order', 'tenant_payment_methods_tenant_sort'");
    expect(sql.match(/SELECT \* FROM \(VALUES/g)).toHaveLength(1);
  });

  it('preserves a sole index and never creates a replacement', () => {
    expect(sql).toContain('IF old_oid IS NULL OR keep_oid IS NULL THEN');
    expect(executable).not.toMatch(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/im);
    expect(executable).not.toMatch(/^\s*DROP\s+INDEX\s+IF\s+EXISTS\b/im);
  });

  it('fails closed for changed definitions and unsafe index roles', () => {
    expect(sql).toContain('INDEX_DEDUP_NOT_EQUIVALENT_OR_SAFE');
    expect(sql).toContain('INDEX_DEDUP_DEPENDENCY');
    expect(sql).toContain('NOT old_i.indisunique');
    expect(sql).toContain('NOT old_i.indisprimary');
    expect(sql).toContain('NOT old_i.indisexclusion');
    expect(sql).toContain('NOT old_i.indisreplident');
    expect(sql).toContain('pg_constraint');
    expect(sql).toContain('pg_depend');
  });

  it('locks before deleting and verifies the retained index afterward', () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).toContain("LOCK TABLE ONLY public.%I IN ACCESS EXCLUSIVE MODE NOWAIT");
    expect(sql).toContain("DROP INDEX public.%I RESTRICT");
    expect(sql).toContain('INDEX_DEDUP_POSTCONDITION');
    expect(sql).toContain('indisvalid');
    expect(sql).toContain('indisready');
    expect(sql).toContain('indislive');
  });

  it('keeps rollback references out of executable SQL', () => {
    expect(executable).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
    expect(sql).toContain('CREATE INDEX CONCURRENTLY trip_addons_trip_idx');
  });
});
