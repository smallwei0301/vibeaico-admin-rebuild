/**
 * Tenant/parent FK integration tests — issue #8 migration 0029.
 *
 * This is intentionally a service-role test: RLS is covered elsewhere; this
 * file observes PostgreSQL's constraint boundary directly.  Its rows have a
 * per-run `ITC29-` prefix, cleanup asserts every delete error, and the final
 * count assertions make a failed cleanup visible rather than contaminating a
 * later run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';

const prefix = `ITC29-${Date.now()}`;
const futureDate = '2031-08-29';
const DB_TIMEOUT_MS = 20_000;

let admin: SupabaseClient;
let tripA1 = '';
let tripA2 = '';
let tripB = '';
let planA1 = '';
let planA2 = '';
let planB = '';
let departureA1 = '';
let departureA2 = '';
let departureB = '';
let customerA = '';

/**
 * A hanging PostgREST call previously consumed the entire hook timeout and
 * obscured which setup/cleanup step was blocked.  Keep each real DB operation
 * independently bounded, then include the semantic step in the thrown error.
 */
async function dbQuery<T>(
  label: string,
  query: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  try {
    return await query(AbortSignal.timeout(DB_TIMEOUT_MS));
  } catch (cause) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    throw new Error(`[ITC29] DB operation '${label}' timed out or failed: ${detail}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}

function order(no: string, overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: SHOP_A.id,
    order_no: `${prefix}-${no}`,
    trip_id: tripA1,
    plan_id: planA1,
    departure_id: departureA1,
    customer_id: customerA || null,
    customer_name: '0029 integrity test',
    customer_phone: '0900000029',
    party_size: 1,
    source: 'MANUAL',
    ...overrides,
  };
}

async function insertId(table: string, label: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await dbQuery(label, (signal) => (
    admin.from(table).insert(row).abortSignal(signal).select('id').single()
  ));
  expect(error, `${table}: ${JSON.stringify(error)}`).toBeNull();
  return (data as { id: string }).id;
}

async function expectForeignKey(table: string, label: string, row: Record<string, unknown>) {
  const { error } = await dbQuery(label, (signal) => admin.from(table).insert(row).abortSignal(signal));
  expect(error, `${table} should reject an invalid parent reference`).not.toBeNull();
  expect(error!.code).toBe('23503');
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Run each FK-safe dependency layer together: PostgREST can be slow, but
  // none of the rows within a layer depends on another row in that layer.
  [tripA1, tripA2, tripB] = await Promise.all([
    insertId('trips', 'setup tripA1', {
      tenant_id: SHOP_A.id, slug: `${prefix}-a-1`, title: `${prefix} A trip 1`,
    }),
    insertId('trips', 'setup tripA2', {
      tenant_id: SHOP_A.id, slug: `${prefix}-a-2`, title: `${prefix} A trip 2`,
    }),
    insertId('trips', 'setup tripB', {
      tenant_id: SHOP_B.id, slug: `${prefix}-b-1`, title: `${prefix} B trip`,
    }),
  ]);

  [planA1, planA2, planB] = await Promise.all([
    insertId('trip_plans', 'setup planA1', {
      tenant_id: SHOP_A.id, trip_id: tripA1, name: `${prefix} A plan 1`,
    }),
    insertId('trip_plans', 'setup planA2', {
      tenant_id: SHOP_A.id, trip_id: tripA2, name: `${prefix} A plan 2`,
    }),
    insertId('trip_plans', 'setup planB', {
      tenant_id: SHOP_B.id, trip_id: tripB, name: `${prefix} B plan`,
    }),
  ]);

  [departureA1, departureA2, departureB, customerA] = await Promise.all([
    insertId('trip_departures', 'setup departureA1', {
      tenant_id: SHOP_A.id, trip_id: tripA1, plan_id: planA1,
      departs_on: futureDate, capacity: 10, note: `${prefix} A departure 1`,
    }),
    insertId('trip_departures', 'setup departureA2', {
      tenant_id: SHOP_A.id, trip_id: tripA2, plan_id: planA2,
      departs_on: futureDate, capacity: 10, note: `${prefix} A departure 2`,
    }),
    insertId('trip_departures', 'setup departureB', {
      tenant_id: SHOP_B.id, trip_id: tripB, plan_id: planB,
      departs_on: futureDate, capacity: 10, note: `${prefix} B departure`,
    }),
    insertId('customers', 'setup customerA', {
      tenant_id: SHOP_A.id, name: `${prefix} customer`, phone: '0900000029',
    }),
  ]);
});

afterAll(async () => {
  const cleanup = async (label: string, operation: (signal: AbortSignal) => PromiseLike<{ error: unknown }>) => {
    const { error } = await dbQuery(label, operation);
    expect(error, `cleanup ${label}: ${JSON.stringify(error)}`).toBeNull();
  };
  const count = async (label: string, operation: (signal: AbortSignal) => PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: residual, error } = await dbQuery(label, operation);
    expect(error, `residual query ${label}: ${JSON.stringify(error)}`).toBeNull();
    expect(residual, `residual ${label}`).toBe(0);
  };

  // Order → departure → plan → trip is the FK direction.  The explicit order
  // delete also lets this teardown prove RESTRICT did not leave an unremovable row.
  await Promise.all([
    cleanup('cleanup tour_orders', (signal) => admin.from('tour_orders').delete().abortSignal(signal).like('order_no', `${prefix}%`)),
    cleanup('cleanup trip_addons', (signal) => admin.from('trip_addons').delete().abortSignal(signal).like('name', `${prefix}%`)),
  ]);
  await cleanup('cleanup trip_departures', (signal) => admin.from('trip_departures').delete().abortSignal(signal).like('note', `${prefix}%`));
  await cleanup('cleanup trip_plans', (signal) => admin.from('trip_plans').delete().abortSignal(signal).like('name', `${prefix}%`));
  await Promise.all([
    cleanup('cleanup trips', (signal) => admin.from('trips').delete().abortSignal(signal).like('slug', `${prefix}%`)),
    customerA
      ? cleanup('cleanup customerA', (signal) => admin.from('customers').delete().abortSignal(signal).eq('id', customerA))
      : Promise.resolve(),
  ]);

  await Promise.all([
    count('residual query tour_orders', (signal) => admin.from('tour_orders').select('*', { count: 'exact', head: true }).abortSignal(signal).like('order_no', `${prefix}%`)),
    count('residual query trip_addons', (signal) => admin.from('trip_addons').select('*', { count: 'exact', head: true }).abortSignal(signal).like('name', `${prefix}%`)),
    count('residual query trip_departures', (signal) => admin.from('trip_departures').select('*', { count: 'exact', head: true }).abortSignal(signal).like('note', `${prefix}%`)),
    count('residual query trip_plans', (signal) => admin.from('trip_plans').select('*', { count: 'exact', head: true }).abortSignal(signal).like('name', `${prefix}%`)),
    count('residual query trips', (signal) => admin.from('trips').select('*', { count: 'exact', head: true }).abortSignal(signal).like('slug', `${prefix}%`)),
    count('residual query customerA', (signal) => admin.from('customers').select('*', { count: 'exact', head: true }).abortSignal(signal).eq('id', customerA)),
  ]);
});

describe('0029 tenant/parent constraints', () => {
  it('rejects a parent belonging to another tenant on plans, addons, departures, orders, and customers', async () => {
    await Promise.all([
      expectForeignKey('trip_plans', 'cross-tenant trip_plans parent', {
        tenant_id: SHOP_A.id, trip_id: tripB, name: `${prefix} invalid cross tenant plan`,
      }),
      expectForeignKey('trip_addons', 'cross-tenant trip_addons parent', {
        tenant_id: SHOP_A.id, trip_id: tripB, name: `${prefix} invalid cross tenant addon`,
      }),
      expectForeignKey('trip_departures', 'cross-tenant trip_departures plan', {
        tenant_id: SHOP_A.id, trip_id: tripA1, plan_id: planB,
        departs_on: '2031-08-30', capacity: 10, note: `${prefix} invalid cross tenant departure`,
      }),
      expectForeignKey('tour_orders', 'cross-tenant tour_orders departure', order('cross-departure', { departure_id: departureB })),
      expectForeignKey('tour_orders', 'cross-tenant tour_orders customer', order('cross-customer', { customer_id: SHOP_B.customerB1 })),
    ]);
  });

  it('rejects a same-tenant plan or departure that belongs to a different trip', async () => {
    await Promise.all([
      expectForeignKey('trip_departures', 'same-tenant cross-trip departure plan', {
        tenant_id: SHOP_A.id, trip_id: tripA1, plan_id: planA2,
        departs_on: '2031-08-31', capacity: 10, note: `${prefix} invalid cross trip departure`,
      }),
      expectForeignKey('tour_orders', 'same-tenant cross-trip order plan', order('cross-plan', { plan_id: planA2, departure_id: departureA2 })),
      expectForeignKey('tour_orders', 'same-tenant cross-trip order departure', order('cross-departure-topology', { departure_id: departureA2 })),
    ]);
  });

  it('keeps the valid order, clears only customer_id on customer deletion, and RESTRICTs every ordered parent', async () => {
    const orderId = await insertId('tour_orders', 'setup valid order for RESTRICT and customer deletion', order('valid-customer-delete'));

    const expectRestrict = async (table: 'trips' | 'trip_plans' | 'trip_departures', id: string) => {
      const { error } = await dbQuery(`RESTRICT ${table} ${id}`, (signal) => admin.from(table).delete().abortSignal(signal).eq('id', id));
      expect(error, `${table} must RESTRICT deletion while order ${orderId} exists`).not.toBeNull();
      expect(error!.code).toBe('23503');
    };
    await Promise.all([
      expectRestrict('trips', tripA1),
      expectRestrict('trip_plans', planA1),
      expectRestrict('trip_departures', departureA1),
    ]);

    const deleted = await dbQuery('delete customerA and SET NULL order customer_id', (signal) => admin.from('customers').delete().abortSignal(signal).eq('id', customerA));
    expect(deleted.error).toBeNull();
    const { data, error } = await dbQuery('query order after customer SET NULL', (signal) => (
      admin.from('tour_orders').select('tenant_id, customer_id').abortSignal(signal).eq('id', orderId).single()
    ));
    expect(error).toBeNull();
    expect(data).toEqual({ tenant_id: SHOP_A.id, customer_id: null });
  }, 45_000);
});
