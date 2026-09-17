/** Direct canonical-TEST RLS proof for Issue #18 owner notification tables. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SHOP_A, SHOP_B } from '../../fixtures';

const LINE_USER_ID = `g3-447-owner-notify-${randomUUID()}`;
let requestId: string;
let admin: SupabaseClient;
let ownerA: SupabaseClient;
let ownerB: SupabaseClient;

function testClient(key: string) {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  admin = testClient(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
  const { error: lineUserError } = await admin.from('line_users').insert({
    tenant_id: SHOP_A.id,
    line_user_id: LINE_USER_ID,
    display_name: 'G3 owner-notify RLS fixture',
    followed: true,
  });
  expect(lineUserError, 'owner-notify fixture needs a valid tenant-scoped LINE user').toBeNull();

  const { data, error: requestError } = await admin.from('owner_notify_bind_requests').insert({
    tenant_id: SHOP_A.id,
    line_user_id: LINE_USER_ID,
  }).select('id').single();
  expect(requestError, 'owner-notify bind request fixture must be created by TEST service role').toBeNull();
  requestId = data!.id;

  ownerA = testClient(process.env.TEST_SUPABASE_ANON_KEY!);
  ownerB = testClient(process.env.TEST_SUPABASE_ANON_KEY!);
  expect((await ownerA.auth.signInWithPassword(SHOP_A.owner)).error).toBeNull();
  expect((await ownerB.auth.signInWithPassword(SHOP_B.owner)).error).toBeNull();
});

afterAll(async () => {
  if (admin) await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', LINE_USER_ID);
});

describe('0116 owner notification RLS', () => {
  it('B 店登入使用者讀不到 A 店的 owner-notify bind request（tenant 隔離）', async () => {
    const { data, error } = await ownerB.from('owner_notify_bind_requests').select('id').eq('id', requestId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('A 店登入使用者讀得到自己的 owner-notify bind request（避免全表被拒的假陰性）', async () => {
    const { data, error } = await ownerA.from('owner_notify_bind_requests').select('id, tenant_id').eq('id', requestId);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: requestId, tenant_id: SHOP_A.id }]);
  });

  it('B 店登入使用者不能直接在 A 店建立 owner-notify bind request', async () => {
    const { error } = await ownerB.from('owner_notify_bind_requests').insert({
      tenant_id: SHOP_A.id,
      line_user_id: LINE_USER_ID,
    });
    expect(error, 'cross-tenant insert must be rejected by the RLS with-check').not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});
