/** Canonical Supabase-client proof for the #589 retirement ACL boundary. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SHOP_A } from '../../fixtures';

let admin: SupabaseClient;
let anonymous: SupabaseClient;
let authenticated: SupabaseClient;
const createdTenantIds = new Set<string>();

function testClient(key: string): SupabaseClient {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function createEphemeralTenant(label: string): Promise<string> {
  const id = randomUUID();
  const suffix = id.replaceAll('-', '').slice(0, 20);
  const { error: tenantError } = await admin.from('tenants').insert({
    id,
    shop_code: `${label}-${suffix}`,
    name: `G3 ${label} ${suffix}`,
  });
  expect(tenantError).toBeNull();
  createdTenantIds.add(id);

  const { error: settingsError } = await admin.from('tenant_settings').insert({
    tenant_id: id,
    line: {},
  });
  expect(settingsError).toBeNull();
  return id;
}

async function retire(tenantId: string, imageUrl: string): Promise<boolean> {
  const { data, error } = await admin.rpc('retire_richmenu_asset', {
    p_tenant_id: tenantId,
    p_image_url: imageUrl,
  });
  expect(error).toBeNull();
  const value: any = Array.isArray(data) ? data[0] : data;
  return value === true || value?.retired === true;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  admin = testClient(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
  anonymous = testClient(process.env.TEST_SUPABASE_ANON_KEY!);
  authenticated = testClient(process.env.TEST_SUPABASE_ANON_KEY!);
  const { error: loginError } = await authenticated.auth.signInWithPassword({
    email: SHOP_A.owner.email,
    password: SHOP_A.owner.password,
  });
  expect(loginError).toBeNull();
});

afterAll(async () => {
  if (!admin || !createdTenantIds.size) return;
  const { error } = await admin.from('tenants').delete().in('id', [...createdTenantIds]);
  expect(error).toBeNull();
  createdTenantIds.clear();
});

describe('0123 richmenu asset retirement authorization', () => {
  it('retirement RPC is tenant-scoped: another tenant can retire the same URL independently', async () => {
    const tenantA = await createEphemeralTenant('g3-589-retirement-a');
    const tenantB = await createEphemeralTenant('g3-589-retirement-b');
    const sharedUrl = `https://storage.example/richmenu-assets/shared-${randomUUID()}.png`;

    expect(await retire(tenantA, sharedUrl)).toBe(true);
    expect(await retire(tenantA, sharedUrl)).toBe(false);
    expect(await retire(tenantB, sharedUrl)).toBe(true);
  });

  it('browser roles cannot execute or write richmenu retirement bookkeeping directly', async () => {
    const args = {
      p_tenant_id: SHOP_A.id,
      p_image_url: `https://storage.example/richmenu-assets/unauthorized-${randomUUID()}.png`,
    };

    for (const client of [anonymous, authenticated]) {
      const { error } = await client.rpc('retire_richmenu_asset', args);
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    }

    const { error: directWriteError } = await authenticated
      .from('richmenu_asset_retirements')
      .insert({ tenant_id: SHOP_A.id, image_url: args.p_image_url });
    expect(directWriteError).not.toBeNull();
    expect(directWriteError?.code).toBe('42501');
  });
});
