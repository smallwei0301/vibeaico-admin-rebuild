import { randomUUID } from 'node:crypto';
import { createClient, type PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SHOP_A } from '../../fixtures';

function client(key: string) {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function expectPermissionDenied(error: PostgrestError | null) {
  expect(error, 'browser-held token must not execute SECURITY DEFINER seat RPC').not.toBeNull();
  expect(
    error?.code === '42501' || /permission denied/i.test(error?.message ?? ''),
    `expected PostgreSQL permission denial, got ${error?.code ?? 'no-code'}: ${error?.message ?? 'no-message'}`,
  ).toBe(true);
}

describe('#8-B SECURITY DEFINER RPC privilege boundary', () => {
  it('anon token cannot call reserve_seats directly', async () => {
    const anon = client(process.env.TEST_SUPABASE_ANON_KEY!);
    const { error } = await anon.rpc('reserve_seats', {
      p_departure: randomUUID(),
      p_count: 1,
    });
    expectPermissionDenied(error);
  });

  it('authenticated tenant owner still cannot bypass the server route', async () => {
    const authenticated = client(process.env.TEST_SUPABASE_ANON_KEY!);
    const { error: signInError } = await authenticated.auth.signInWithPassword(SHOP_A.owner);
    expect(signInError).toBeNull();

    const { error } = await authenticated.rpc('reserve_seats', {
      p_departure: randomUUID(),
      p_count: 1,
    });
    expectPermissionDenied(error);
  });

  it('service_role may enter the RPC and reaches its business-domain guard', async () => {
    const admin = client(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await admin.rpc('reserve_seats', {
      p_departure: randomUUID(),
      p_count: 1,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('P0001');
    expect(error?.message).toContain('SEATS_UNAVAILABLE');
  });
});
