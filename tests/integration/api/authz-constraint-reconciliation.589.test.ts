import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';

const PREFIX = 'g3-589-0127-';
let admin: SupabaseClient;
let ownerA: SupabaseClient;
let ownerB: SupabaseClient;
let anon: SupabaseClient;
let lineUserId: string;
let ownerCrudLineUserId: string;
let addonId: string;

function client(key: string) {
  return createClient(process.env.TEST_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = client(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
  anon = client(process.env.TEST_SUPABASE_ANON_KEY!);
  ownerA = client(process.env.TEST_SUPABASE_ANON_KEY!);
  ownerB = client(process.env.TEST_SUPABASE_ANON_KEY!);
  expect((await ownerA.auth.signInWithPassword(SHOP_A.owner)).error).toBeNull();
  expect((await ownerB.auth.signInWithPassword(SHOP_B.owner)).error).toBeNull();
  lineUserId = `${PREFIX}${randomUUID()}`;
  ownerCrudLineUserId = `${PREFIX}${randomUUID()}`;
  addonId = randomUUID();
  expect((await admin.from('line_users').insert({ tenant_id: SHOP_A.id, line_user_id: lineUserId, display_name: 'G3 0127 fixture', followed: true })).error).toBeNull();
  expect((await admin.from('line_users').insert({ tenant_id: SHOP_A.id, line_user_id: ownerCrudLineUserId, display_name: 'G3 0127 CRUD fixture', followed: true })).error).toBeNull();
  expect((await admin.from('owner_notify_recipients').insert({ tenant_id: SHOP_A.id, line_user_id: lineUserId })).error).toBeNull();
  expect((await admin.from('booking_addons').insert({ id: addonId, tenant_id: SHOP_A.id, booking_id: SHOP_A.bookingPending, name: `${PREFIX}addon` })).error).toBeNull();
});

afterAll(async () => {
  if (!admin) return;
  const addons = await admin.from('booking_addons').delete().eq('id', addonId);
  expect(addons.error).toBeNull();
  const recipients = await admin.from('owner_notify_recipients').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', lineUserId);
  expect(recipients.error).toBeNull();
  const lines = await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).in('line_user_id', [lineUserId, ownerCrudLineUserId]);
  expect(lines.error).toBeNull();
});

describe('0127 reconciled table grants and RLS', () => {
  it('authenticated tenant cannot read another tenant booking addons or owner notify recipients', async () => {
    const own = await ownerA.from('owner_notify_recipients').select('id, tenant_id').eq('tenant_id', SHOP_A.id).eq('line_user_id', lineUserId);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    const ownAddon = await ownerA.from('booking_addons').select('id, tenant_id').eq('id', addonId);
    expect(ownAddon.error).toBeNull();
    expect(ownAddon.data).toEqual([{ id: addonId, tenant_id: SHOP_A.id }]);
    const booking = await ownerB.from('booking_addons').select('id').eq('id', addonId);
    expect(booking.error).toBeNull();
    expect(booking.data).toEqual([]);
    const recipients = await ownerB.from('owner_notify_recipients').select('id').eq('tenant_id', SHOP_A.id);
    expect(recipients.error).toBeNull();
    expect(recipients.data).toEqual([]);
  });

  it('anon cannot read or write reconciled tables while authenticated addon writes remain denied', async () => {
    const anonRead = await anon.from('booking_addons').select('id').limit(1);
    expect(anonRead.error?.code).toBe('42501');
    const anonWrite = await anon.from('owner_notify_recipients').insert({ tenant_id: SHOP_A.id, line_user_id: lineUserId });
    expect(anonWrite.error?.code).toBe('42501');
    const authWrite = await ownerA.from('booking_addons').insert({ tenant_id: SHOP_A.id, booking_id: SHOP_A.bookingPending, name: `${PREFIX}denied` });
    expect(authWrite.error?.code).toBe('42501');
    const crossTenantWrite = await ownerB.from('owner_notify_recipients').insert({ tenant_id: SHOP_A.id, line_user_id: ownerCrudLineUserId });
    expect(crossTenantWrite.error?.code).toBe('42501');
  });

  it('authenticated owner retains tenant-scoped owner-notify CRUD', async () => {
    const inserted = await ownerA.from('owner_notify_recipients').insert({ tenant_id: SHOP_A.id, line_user_id: ownerCrudLineUserId }).select('id, tenant_id, notify_cancel').single();
    expect(inserted.error).toBeNull();
    expect(inserted.data).toMatchObject({ tenant_id: SHOP_A.id, notify_cancel: true });
    const updated = await ownerA.from('owner_notify_recipients').update({ notify_cancel: false }).eq('id', inserted.data!.id).select('id, notify_cancel').single();
    expect(updated.error).toBeNull();
    expect(updated.data).toMatchObject({ id: inserted.data!.id, notify_cancel: false });
    const removed = await ownerA.from('owner_notify_recipients').delete().eq('id', inserted.data!.id).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([{ id: inserted.data!.id }]);
  });
});
