import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0084_catalog_position_bridge.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

describe('issue #242 predeploy catalog bridge boundary', () => {
  it('creates the shared counter and both catalog RPCs', () => {
    expect(sql).toMatch(/create table if not exists public\.catalog_position_counters/i);
    expect(sql).toMatch(/create or replace function public\.reserve_catalog_positions\s*\(/i);
    expect(sql).toMatch(/create or replace function public\.reorder_catalog_items\s*\(/i);
  });

  it('supports services, products and portfolios while keeping manager authorization', () => {
    expect(sql).toContain("p_resource not in ('services', 'products', 'portfolios')");
    expect(sql).toContain("resource in ('services', 'products', 'portfolios')");
    expect(sql).toContain("p_lane not in ('public', 'line')");
    expect(sql.match(/tenant_role_at_least\(p_tenant_id, 'MANAGER'\)/g)).toHaveLength(2);
  });

  it('is PREDEPLOY-only: it must not create any ordering unique index', () => {
    expect(sql).not.toMatch(/create\s+unique\s+index/i);
    expect(sql).not.toContain('services_tenant_sort_order_uq');
    expect(sql).not.toContain('services_tenant_line_sort_order_uq');
    expect(sql).not.toContain('products_tenant_sort_order_uq');
    expect(sql).not.toContain('products_tenant_line_sort_order_uq');
    expect(sql).not.toContain('portfolios_tenant_sort_order_uq');
    expect(sql).not.toContain('portfolios_tenant_line_sort_order_uq');
  });

  it('keeps the RPC grants explicit for authenticated and service_role callers', () => {
    expect(sql).toMatch(
      /grant execute on function public\.reserve_catalog_positions\(uuid, text\)\s+to authenticated, service_role;/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.reorder_catalog_items\(uuid, text, text, uuid\[\]\)\s+to authenticated, service_role;/i,
    );
  });
});
