import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_B, STAFF_A2, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

let staffApi: AuthedApi;
let ownerBApi: AuthedApi;
let staffClient: SupabaseClient;

beforeAll(async () => {
  staffApi = await loginAs(STAFF_A2.email, STAFF_A2.password);
  ownerBApi = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  staffClient = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await staffClient.auth.signInWithPassword({
    email: STAFF_A2.email,
    password: STAFF_A2.password,
  });
  expect(error).toBeNull();
});

describe('#447 / 0110 create_tour_order AUTHZ boundary', () => {
  it('STAFF cannot use the MANAGER-only manual-order route', async () => {
    const response = await staffApi.post('/api/tour-orders/manual', {
      departureId: TRIP_A.departure1,
      customerName: '#447 STAFF forbidden',
      customerPhone: '0912345678',
      partySize: 1,
    });
    expect(response.status).toBe(403);
  });

  it('cross-tenant owner cannot use another tenant departure', async () => {
    const response = await ownerBApi.post('/api/tour-orders/manual', {
      departureId: TRIP_A.departure1,
      customerName: '#447 cross-tenant forbidden',
      customerPhone: '0912345678',
      partySize: 1,
    });
    expect([403, 404]).toContain(response.status);
  });

  it('authenticated role cannot invoke SECURITY DEFINER create_tour_order directly', async () => {
    // Deliberately use SHOP_B + SHOP_A departure. If EXECUTE were accidentally
    // restored, the function would stop at DEPARTURE_NOT_FOUND before any seat/order
    // mutation. Correct ACL must reject earlier with PostgreSQL 42501.
    const { data, error } = await staffClient.rpc('create_tour_order', {
      p_tenant: SHOP_B.id,
      p_order_no: 'TO9901014470',
      p_departure: TRIP_A.departure1,
      p_party_size: 1,
      p_customer: null,
      p_contact: { name: '#447 authz probe', phone: '0912345678' },
      p_source: 'MANUAL',
      p_payment_method: null,
      p_note: '#447 direct rpc must be forbidden',
      p_hold_expires: null,
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error?.code).toBe('42501');
  });
});
