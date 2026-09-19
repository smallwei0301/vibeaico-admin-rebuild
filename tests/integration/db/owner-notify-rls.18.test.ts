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
const createdTenantIds = new Set<string>();

function testClient(key: string) {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function createEphemeralTenant(label: string): Promise<string> {
  const id = randomUUID();
  const suffix = id.replaceAll('-', '').slice(0, 20);
  const { error } = await admin.from('tenants').insert({
    id,
    shop_code: `${label}-${suffix}`,
    name: `G3 ${label} ${suffix}`,
  });
  expect(error).toBeNull();
  createdTenantIds.add(id);
  return id;
}

async function insertLineUsers(tenantId: string, lineUserIds: string[]): Promise<void> {
  const { error } = await admin.from('line_users').insert(lineUserIds.map((lineUserId) => ({
    tenant_id: tenantId,
    line_user_id: lineUserId,
    display_name: 'G3 owner-notify atomic fixture',
    followed: true,
  })));
  expect(error).toBeNull();
}

async function confirmOwnerNotifyBind(
  client: SupabaseClient,
  tenantId: string,
  bindRequestId: string,
  lineUserId: string,
) {
  return client.rpc('confirm_owner_notify_bind', {
    p_tenant_id: tenantId,
    p_request_id: bindRequestId,
    p_line_user_id: lineUserId,
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
  if (admin && createdTenantIds.size) {
    const { error } = await admin.from('tenants').delete().in('id', [...createdTenantIds]);
    expect(error).toBeNull();
    createdTenantIds.clear();
  }
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

  it('0119 owner-notify confirm RPC 僅在請求所屬租戶內確認，不可跨租戶消費 bind request', async () => {
    const tenantA = await createEphemeralTenant('g3-owner-notify-boundary-a');
    const tenantB = await createEphemeralTenant('g3-owner-notify-boundary-b');
    const lineUserId = `g3-owner-notify-boundary-${randomUUID()}`;
    await insertLineUsers(tenantA, [lineUserId]);

    const { data: request, error: requestError } = await admin
      .from('owner_notify_bind_requests')
      .insert({ tenant_id: tenantA, line_user_id: lineUserId })
      .select('id')
      .single();
    expect(requestError).toBeNull();

    const wrongTenant = await confirmOwnerNotifyBind(admin, tenantB, request!.id, lineUserId);
    expect(wrongTenant.error).toBeNull();
    expect(wrongTenant.data?.[0]).toMatchObject({
      ok: false,
      reason: 'INVALID_OR_USED',
    });

    const correctTenant = await confirmOwnerNotifyBind(admin, tenantA, request!.id, lineUserId);
    expect(correctTenant.error).toBeNull();
    expect(correctTenant.data?.[0]).toMatchObject({ ok: true, is_primary: true });

    const { data: tenantARecipients, error: tenantAReadError } = await admin
      .from('owner_notify_recipients')
      .select('line_user_id')
      .eq('tenant_id', tenantA);
    expect(tenantAReadError).toBeNull();
    expect(tenantARecipients).toEqual([{ line_user_id: lineUserId }]);

    const { data: tenantBRecipients, error: tenantBReadError } = await admin
      .from('owner_notify_recipients')
      .select('line_user_id')
      .eq('tenant_id', tenantB);
    expect(tenantBReadError).toBeNull();
    expect(tenantBRecipients).toEqual([]);
  });

  it('0119 同租戶併發確認仍維持 owner-notify 三位上限，只有一個請求成功', async () => {
    const tenantId = await createEphemeralTenant('g3-owner-notify-atomic');
    const lineUserIds = Array.from({ length: 4 }, () => `g3-owner-notify-atomic-${randomUUID()}`);
    await insertLineUsers(tenantId, lineUserIds);

    const { error: recipientError } = await admin.from('owner_notify_recipients').insert(
      lineUserIds.slice(0, 2).map((lineUserId, index) => ({
        tenant_id: tenantId,
        line_user_id: lineUserId,
        is_primary: index === 0,
      })),
    );
    expect(recipientError).toBeNull();

    const { data: requests, error: requestError } = await admin
      .from('owner_notify_bind_requests')
      .insert(lineUserIds.slice(2).map((lineUserId) => ({
        tenant_id: tenantId,
        line_user_id: lineUserId,
      })))
      .select('id, line_user_id');
    expect(requestError).toBeNull();

    const outcomes = await Promise.all((requests ?? []).map((request) =>
      confirmOwnerNotifyBind(admin, tenantId, request.id, request.line_user_id),
    ));
    outcomes.forEach((outcome) => expect(outcome.error).toBeNull());
    const resultRows = outcomes.flatMap((outcome) => outcome.data ?? []);
    expect(resultRows.filter((row) => row.ok)).toHaveLength(1);
    expect(resultRows.filter((row) => row.reason === 'LIMIT_REACHED')).toHaveLength(1);

    const { data: recipients, error: recipientReadError } = await admin
      .from('owner_notify_recipients')
      .select('line_user_id')
      .eq('tenant_id', tenantId);
    expect(recipientReadError).toBeNull();
    expect(recipients).toHaveLength(3);

    const { data: requestRows, error: requestReadError } = await admin
      .from('owner_notify_bind_requests')
      .select('status')
      .eq('tenant_id', tenantId);
    expect(requestReadError).toBeNull();
    expect(requestRows?.map((row) => row.status).sort()).toEqual(['CANCELLED', 'CONFIRMED']);
  });

  it('0119 未登入與已登入角色都不得直接呼叫 confirm_owner_notify_bind RPC', async () => {
    const args = {
      p_tenant_id: SHOP_A.id,
      p_request_id: randomUUID(),
      p_line_user_id: `g3-owner-notify-unauthorized-${randomUUID()}`,
    };

    const anonymous = testClient(process.env.TEST_SUPABASE_ANON_KEY!);
    const anonymousResult = await anonymous.rpc('confirm_owner_notify_bind', args);
    expect(anonymousResult.error).not.toBeNull();
    expect(anonymousResult.error?.code).toBe('42501');

    const authenticatedResult = await ownerA.rpc('confirm_owner_notify_bind', args);
    expect(authenticatedResult.error).not.toBeNull();
    expect(authenticatedResult.error?.code).toBe('42501');
  });
});
