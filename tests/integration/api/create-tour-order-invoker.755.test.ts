/**
 * #755 / 0136：canonical TEST（與 G3 release）上的 create_tour_order 回歸／契約測試。
 * service_role 無 JWT 建單後讀回 refund_policy_snapshot，必須等於 trips.refund_policy_type；
 * 跨租戶呼叫被拒絕且不留訂單；anon／authenticated 不得 EXECUTE。
 *
 * 注意：canonical TEST 上函式 owner 會繞過 RLS，因此本測試「不會」重現 Production 的
 * RLS 情境（owner 為 nobypassrls 的 production_migration_owner、trips 受 RLS 過濾而寫成 NULL）。
 * 它只守住 0136 之後的行為契約不回歸；Production 角色配置的重現是另一個待辦項目，
 * 需要已知 Production tour_orders 擁有者與授權後的本機隔離環境才能驗證。
 * 所有 fixture 變動（trips 政策、座位、訂單）都在 finally 還原。
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';

function client(key: string): SupabaseClient {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const args = (tenant: string, orderNo: string) => ({
  p_tenant: tenant,
  p_order_no: orderNo,
  p_departure: TRIP_A.departure1,
  p_party_size: 1,
  p_customer: null,
  p_contact: { name: '#755 probe', phone: '0912345678' },
  p_source: 'MANUAL',
  p_payment_method: null,
  p_note: '#755 probe',
  p_hold_expires: null,
});

let admin: SupabaseClient;
let anon: SupabaseClient;
let authenticated: SupabaseClient;

beforeAll(async () => {
  admin = client(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
  anon = client(process.env.TEST_SUPABASE_ANON_KEY!);
  authenticated = client(process.env.TEST_SUPABASE_ANON_KEY!);
  const { error } = await authenticated.auth.signInWithPassword(SHOP_A.owner);
  expect(error).toBeNull();
});

describe('#755 / 0136 create_tour_order refund policy snapshot boundary', () => {
  it('service_role create_tour_order snapshots STANDARD/FLEXIBLE/STRICT equal to trips.refund_policy_type, then restores', async () => {
    const original = await admin.from('trips').select('refund_policy_type').eq('id', TRIP_A.id).single();
    expect(original.error).toBeNull();
    const createdOrders: string[] = [];
    try {
      for (const policy of ['STANDARD', 'FLEXIBLE', 'STRICT']) {
        const update = await admin.from('trips').update({ refund_policy_type: policy }).eq('id', TRIP_A.id);
        expect(update.error).toBeNull();
        const { data: id, error } = await admin.rpc('create_tour_order', args(SHOP_A.id, `T755${randomUUID().slice(0, 8)}`));
        expect(error).toBeNull();
        expect(id).toBeTruthy();
        createdOrders.push(id as string);
        const row = await admin.from('tour_orders').select('refund_policy_snapshot').eq('id', id as string).single();
        expect(row.error).toBeNull();
        expect(row.data?.refund_policy_snapshot).toBe(policy);
      }
    } finally {
      const failures: unknown[] = [];
      for (const id of createdOrders) {
        const order = await admin.from('tour_orders').select('seats_reserved').eq('id', id).maybeSingle();
        if (order.error) failures.push(order.error);
        const deleted = await admin.from('tour_orders').delete().eq('id', id);
        if (deleted.error) failures.push(deleted.error);
        if (order.data?.seats_reserved === true) {
          const released = await admin.rpc('release_seats', { p_departure: TRIP_A.departure1, p_count: 1 });
          if (released.error) failures.push(released.error);
        }
      }
      const restore = await admin.from('trips')
        .update({ refund_policy_type: original.data!.refund_policy_type }).eq('id', TRIP_A.id);
      if (restore.error) failures.push(restore.error);
      if (failures.length) throw new AggregateError(failures, '#755 fixture cleanup failed');
    }
  });

  it('service_role create_tour_order rejects another tenant id for an existing departure without creating an order', async () => {
    const orderNo = `T755X${randomUUID().slice(0, 7)}`;
    const { data, error } = await admin.rpc('create_tour_order', args(SHOP_B.id, orderNo));
    expect(data).toBeNull();
    expect(error?.message).toContain('DEPARTURE_NOT_FOUND');
    const rows = await admin.from('tour_orders').select('id').eq('order_no', orderNo);
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([]);
  });

  it('anon and authenticated roles cannot execute create_tour_order directly', async () => {
    for (const caller of [anon, authenticated]) {
      const orderNo = `T755N${randomUUID().slice(0, 7)}`;
      const { data, error } = await caller.rpc('create_tour_order', args(SHOP_B.id, orderNo));
      expect(data).toBeNull();
      expect(error?.code === '42501' || /permission denied/i.test(error?.message ?? '')).toBe(true);
    }
  });
});
