import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';

function client(key: string): SupabaseClient {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function expectPermissionDenied(error: PostgrestError | null): void {
  expect(error, 'browser-held token must not execute the departure-staff writer RPC').not.toBeNull();
  expect(
    error?.code === '42501' || /permission denied/i.test(error?.message ?? ''),
    `expected PostgreSQL permission denial, got ${error?.code ?? 'no-code'}: ${error?.message ?? 'no-message'}`,
  ).toBe(true);
}

let admin: SupabaseClient;
let authenticated: SupabaseClient;

beforeAll(async () => {
  admin = client(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
  authenticated = client(process.env.TEST_SUPABASE_ANON_KEY!);
  const { error } = await authenticated.auth.signInWithPassword(SHOP_A.owner);
  expect(error).toBeNull();
});

describe('0131 replace_trip_departure_staff AUTHZ boundary', () => {
  it('service_role RPC rejects another tenant id for an existing departure without mutation', async () => {
    const readAssignments = async () => {
      const { data, error } = await admin.from('trip_departure_staff')
        .select('tenant_id,departure_id,staff_id,role')
        .eq('departure_id', TRIP_A.departure1)
        .order('staff_id');
      expect(error).toBeNull();
      return data;
    };

    const before = await readAssignments();
    const { data, error } = await admin.rpc('replace_trip_departure_staff', {
      p_tenant: SHOP_B.id,
      p_departure: TRIP_A.departure1,
      p_primary: null,
      p_assistants: [],
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error?.code).toBe('P0002');
    expect(error?.message).toContain('DEPARTURE_NOT_FOUND');
    expect(await readAssignments()).toEqual(before);
  });

  it('anon and authenticated roles cannot execute replace_trip_departure_staff directly', async () => {
    for (const browserClient of [client(process.env.TEST_SUPABASE_ANON_KEY!), authenticated]) {
      // A random departure keeps this probe non-mutating even if the ACL ever
      // regresses; correct behavior must still fail earlier with permission denied.
      const { error } = await browserClient.rpc('replace_trip_departure_staff', {
        p_tenant: SHOP_A.id,
        p_departure: randomUUID(),
        p_primary: null,
        p_assistants: [],
      });
      expectPermissionDenied(error);
    }
  });
});
