/**
 * #42 Advanced Settings bounded persistence slice.
 * The test uses the existing tenant-scoped Plan API and does not perform
 * schema changes or direct authenticated-table DML.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type PlanResponse = {
  id: string;
  minParticipants: number;
  maxParticipants: number;
  depositMode: 'NONE' | 'DEPOSIT_FIXED' | 'DEPOSIT_PERCENT' | 'FULL';
  depositValue: number;
};

async function json<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

beforeAll(async () => {
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('#42 Advanced Settings persistence', () => {
  it('persists party limits and deposit policy through the existing Plan API', async () => {
    const tripResponse = await ownerA.post('/api/trips', {
      title: `#42 Advanced ${randomUUID()}`,
      slug: `test-${randomUUID()}`,
    });
    expect(tripResponse.status).toBe(200);
    const tripId = (await json<{ id: string }>(tripResponse)).data!.id;

    try {
      const planResponse = await ownerA.post(`/api/trips/${tripId}/plans`, {
        name: '可調整人數方案',
        pricePerPerson: 3000,
        minParty: 1,
        maxParty: 10,
        depositMode: 'FULL',
        depositValue: 0,
      });
      expect(planResponse.status).toBe(200);
      const planId = (await json<PlanResponse>(planResponse)).data!.id;

      const departureResponse = await ownerA.post(`/api/trips/${tripId}/departures`, {
        planId,
        departsOn: '2027-01-10',
        capacity: 5,
        startTime: '09:00',
      });
      expect(departureResponse.status).toBe(200);
      const departureId = (await json<{ id: string }>(departureResponse)).data!.id;

      const before = await admin.from('trip_departures')
        .select('*')
        .eq('tenant_id', SHOP_A.id).eq('id', departureId).single();
      expect(before.error).toBeNull();

      const update = await ownerA.put(`/api/trip-plans/${planId}`, {
        minParty: 2,
        maxParty: 8,
        depositMode: 'DEPOSIT_PERCENT',
        depositValue: 30,
      });
      expect(update.status).toBe(200);
      expect((await json<PlanResponse>(update)).data).toMatchObject({
        id: planId,
        minParticipants: 2,
        maxParticipants: 8,
        depositMode: 'DEPOSIT_PERCENT',
        depositValue: 30,
      });

      const reread = await ownerA.get(`/api/trips/${tripId}/plans`);
      expect(reread.status).toBe(200);
      expect((await json<PlanResponse[]>(reread)).data).toEqual([
        expect.objectContaining({
          id: planId,
          minParticipants: 2,
          maxParticipants: 8,
          depositMode: 'DEPOSIT_PERCENT',
          depositValue: 30,
        }),
      ]);

      const after = await admin.from('trip_departures')
        .select('*')
        .eq('tenant_id', SHOP_A.id).eq('id', departureId).single();
      expect(after.error).toBeNull();
      expect(after.data).toEqual(before.data);
    } finally {
      await admin.from('trips').delete().eq('id', tripId).eq('tenant_id', SHOP_A.id);
    }
  });
});
