/** Direct canonical-TEST proof for Issue #42 seasonal pricing persistence and RLS. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';

const PREFIX = `g3-42-0128-${randomUUID()}-`;
let admin: SupabaseClient;
let ownerA: SupabaseClient;
let ownerB: SupabaseClient;
let anon: SupabaseClient;
let seasonId: string;

function client(key: string) {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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

  const inserted = await admin.from('trip_plan_seasons').insert({
    tenant_id: SHOP_A.id,
    plan_id: TRIP_A.planA1,
    name: `${PREFIX}summer`,
    start_month: 6,
    start_day: 1,
    end_month: 8,
    end_day: 31,
    price_override: 1800,
    active: true,
    sort_order: 1,
  }).select('id').single();
  expect(inserted.error).toBeNull();
  seasonId = inserted.data!.id;
});

afterAll(async () => {
  if (!admin) return;
  const { error } = await admin.from('trip_plan_seasons').delete().like('name', `${PREFIX}%`);
  expect(error).toBeNull();
});

describe('0128 seasonal pricing RLS and tenant-boundary contract', () => {
  it('A 店 owner 讀得到自己的季節定價，B 店 owner 完全查不到（tenant 隔離）', async () => {
    const own = await ownerA.from('trip_plan_seasons')
      .select('id, tenant_id, plan_id, name, price_override')
      .eq('id', seasonId);
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{
      id: seasonId,
      tenant_id: SHOP_A.id,
      plan_id: TRIP_A.planA1,
      name: `${PREFIX}summer`,
      price_override: 1800,
    }]);

    const crossTenant = await ownerB.from('trip_plan_seasons').select('id').eq('id', seasonId);
    expect(crossTenant.error).toBeNull();
    expect(crossTenant.data).toEqual([]);
  });

  it('anon 不能讀取，authenticated 角色不能直接寫入 seasonal pricing', async () => {
    const anonymousRead = await anon.from('trip_plan_seasons').select('id').eq('id', seasonId);
    expect(anonymousRead.error?.code).toBe('42501');

    const authenticatedWrite = await ownerA.from('trip_plan_seasons').insert({
      tenant_id: SHOP_A.id,
      plan_id: TRIP_A.planA1,
      name: `${PREFIX}denied`,
      start_month: 9,
      start_day: 1,
      end_month: 10,
      end_day: 31,
      price_override: 1900,
    });
    expect(authenticatedWrite.error?.code).toBe('42501');
  });

  it('複合 tenant／plan foreign key 拒絕跨店配對', async () => {
    const result = await admin.from('trip_plan_seasons').insert({
      tenant_id: SHOP_B.id,
      plan_id: TRIP_A.planA1,
      name: `${PREFIX}cross-tenant-fk`,
      start_month: 1,
      start_day: 1,
      end_month: 1,
      end_day: 31,
      price_override: 2000,
    });
    expect(result.error?.code).toBe('23503');
  });

  it('日期、名稱與價格 constraints 拒絕不合法季節資料', async () => {
    const cases = [
      { name: `${PREFIX}invalid-date`, start_month: 2, start_day: 30, end_month: 3, end_day: 1, price_override: 100 },
      { name: `${PREFIX}negative-price`, start_month: 3, start_day: 1, end_month: 3, end_day: 31, price_override: -1 },
      { name: `${PREFIX}   `, start_month: 3, start_day: 1, end_month: 3, end_day: 31, price_override: 100 },
    ];
    for (const item of cases) {
      const result = await admin.from('trip_plan_seasons').insert({
        tenant_id: SHOP_A.id,
        plan_id: TRIP_A.planA1,
        ...item,
      });
      expect(result.error?.code).toBe('23514');
    }
  });
});
