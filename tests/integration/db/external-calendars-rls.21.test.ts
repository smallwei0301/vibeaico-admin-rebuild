/**
 * Issue #21 external calendar RLS — canonical TEST only.
 *
 * This is intentionally a direct PostgREST test. It proves the database
 * boundary still holds when a caller bypasses the application's API routes.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SHOP_A, SHOP_B } from '../../fixtures';

const TAG = '[G3-447] external-calendar';
const calendarId = randomUUID();
const eventId = randomUUID();

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
  // A prior interrupted run must not make the proof pass or fail by accident.
  await admin.from('external_calendars').delete().like('name', `${TAG}%`);

  const { error: calendarError } = await admin.from('external_calendars').insert({
    id: calendarId,
    tenant_id: SHOP_A.id,
    name: `${TAG} ${calendarId}`,
    ics_url: `https://example.test/${calendarId}.ics`,
  });
  expect(calendarError, 'G3 RLS fixture calendar must be created by TEST service role').toBeNull();

  const { error: eventError } = await admin.from('external_calendar_events').insert({
    id: eventId,
    external_calendar_id: calendarId,
    tenant_id: SHOP_A.id,
    uid: `g3-${eventId}`,
    title: `${TAG} event`,
    start_at: '2030-01-01T00:00:00.000Z',
    end_at: '2030-01-01T01:00:00.000Z',
  });
  expect(eventError, 'G3 RLS fixture cache event must be created by TEST service role').toBeNull();

  ownerA = testClient(process.env.TEST_SUPABASE_ANON_KEY!);
  ownerB = testClient(process.env.TEST_SUPABASE_ANON_KEY!);
  expect((await ownerA.auth.signInWithPassword(SHOP_A.owner)).error).toBeNull();
  expect((await ownerB.auth.signInWithPassword(SHOP_B.owner)).error).toBeNull();
});

afterAll(async () => {
  if (admin) await admin.from('external_calendars').delete().like('name', `${TAG}%`);
});

describe('0115 external calendars RLS', () => {
  it('B 店登入使用者讀不到 A 店的 external calendar（tenant 隔離）', async () => {
    const { data, error } = await ownerB.from('external_calendars').select('id').eq('id', calendarId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('A 店登入使用者讀得到自己的 external calendar（避免全表被拒的假陰性）', async () => {
    const { data, error } = await ownerA.from('external_calendars').select('id, tenant_id').eq('id', calendarId);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: calendarId, tenant_id: SHOP_A.id }]);
  });

  it('authenticated 角色不能直接寫入 external calendar event cache', async () => {
    const { error } = await ownerA.from('external_calendar_events').insert({
      external_calendar_id: calendarId,
      tenant_id: SHOP_A.id,
      uid: `forged-${randomUUID()}`,
      title: 'forged client cache event',
      start_at: '2030-01-02T00:00:00.000Z',
      end_at: '2030-01-02T01:00:00.000Z',
    });
    expect(error, 'event cache write must remain service-role/RPC only').not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});
