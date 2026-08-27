import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  fileURLToPath(new URL('../../src/app/api/trips/[id]/duplicate/route.ts', import.meta.url)),
  'utf8',
);

describe('trip duplicate remote round-trip contract', () => {
  it('uses one tenant-scoped atomic RPC and retains 404/409 HTTP mapping', () => {
    expect(route).toMatch(/t\.supabase\.rpc\(\s*'duplicate_trip_atomic',\s*\{\s*p_tenant_id:\s*t\.tenantId,\s*p_source_trip_id:\s*id,\s*\}\s*\)/s);
    expect(route).not.toMatch(/\.from\('(?:trips|trip_plans|trip_addons)'\)/);
    expect(route).toMatch(/if \(!copy\) return fail\(404,/);
    expect(route).toMatch(/error\?\.code === '23505'\) return fail\(409,/);
    expect(route).toMatch(/error\?\.code === '42501'\) return fail\(403,/);
  });

  it('ships a SECURITY INVOKER function that authorizes, serializes, and copies only trip/plans/addons', () => {
    const path = fileURLToPath(new URL('../../supabase/migrations/0033_trip_duplicate_atomic.sql', import.meta.url));
    expect(existsSync(path)).toBe(true);
    const migration = readFileSync(path, 'utf8');
    expect(migration).toMatch(/create\s+or\s+replace\s+function\s+public\.duplicate_trip_atomic\s*\(\s*p_tenant_id\s+uuid,\s*p_source_trip_id\s+uuid/s);
    expect(migration).toMatch(/security\s+invoker/i);
    expect(migration).toMatch(/auth\.uid\(\)/i);
    expect(migration).toMatch(/role\s+in\s*\('OWNER',\s*'MANAGER'\)/i);
    expect(migration).toMatch(/from\s+public\.trips[\s\S]*?for\s+update/i);
    expect(migration).toMatch(/insert\s+into\s+public\.trips/i);
    expect(migration).toMatch(/insert\s+into\s+public\.trip_plans/i);
    expect(migration).toMatch(/insert\s+into\s+public\.trip_addons/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.trip_departures/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.tour_orders/i);
    expect(migration).toMatch(/revoke\s+all\s+on\s+function[\s\S]*?from\s+public/i);
    expect(migration).toMatch(/grant\s+execute\s+on\s+function[\s\S]*?to\s+authenticated/i);
  });
});
