/** #42 / 18 §2.2: real HTTP creation and raw DB snapshots, no schema changes or orders. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

let admin: SupabaseClient;
let owner: AuthedApi;
let otherOwner: AuthedApi;
const trips: string[] = [];
let originalBasic: Record<string, unknown> | undefined;
const json = async (response: Response) => response.json() as Promise<{ success: boolean; data: any; message?: string }>;

beforeAll(async () => {
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  owner = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  otherOwner = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});
afterEach(async () => {
  if (originalBasic) {
    expect((await owner.put('/api/settings', { basic: originalBasic })).status).toBe(200);
    originalBasic = undefined;
  }
  if (trips.length) {
    const { error } = await admin.from('trips').delete().eq('tenant_id', SHOP_A.id).in('id', trips.splice(0));
    expect(error).toBeNull();
  }
});
async function newPlan() {
  const tripResponse = await owner.post('/api/trips', { title: `#42 snapshot ${randomUUID()}`, slug: `test-${randomUUID()}` });
  expect(tripResponse.status).toBe(200);
  const tripId = (await json(tripResponse)).data.id as string;
  trips.push(tripId);
  const planResponse = await owner.post(`/api/trips/${tripId}/plans`, { name: '成團方案', pricePerPerson: 2000, minParty: 1, maxParty: 8 });
  expect(planResponse.status).toBe(200);
  const planId = (await json(planResponse)).data.id as string;
  return { tripId, planId };
}
async function rows(tripId: string) {
  const { data, error } = await admin.from('trip_departures').select('*')
    .eq('tenant_id', SHOP_A.id).eq('trip_id', tripId).order('departs_on');
  expect(error).toBeNull();
  return data!;
}

describe('#42 Plan rules are consumed by future single and batch departures', () => {
  it('save/reload Plan → single/batch raw DB snapshots; later Plan edits preserve earlier rows', async () => {
    const { tripId, planId } = await newPlan();
    const updated = await owner.put(`/api/trip-plans/${planId}`, {
      salesMode: 'FIXED_DEPARTURE', participationMode: 'SHARED', minToDepart: 4, formationDeadlineDaysBefore: 7,
    });
    expect(updated.status).toBe(200);
    const reread = await owner.get(`/api/trips/${tripId}/plans`);
    expect((await json(reread)).data[0]).toMatchObject({ minParticipants: 1, minToDepart: 4, formationDeadlineDaysBefore: 7 });
    const first = await owner.post(`/api/trips/${tripId}/departures`, {
      planId, departsOn: '2042-01-15', startTime: '00:30', capacity: 8, primaryStaffId: SHOP_A.staffA2,
    });
    expect(first.status).toBe(200);
    const before = (await rows(tripId))[0];
    expect(before).toMatchObject({ min_to_depart_snapshot: 4, formation_status: 'COLLECTING' });
    expect(new Date(before.formation_deadline_at).toISOString()).toBe('2042-01-07T16:30:00.000Z');

    expect((await owner.put(`/api/trip-plans/${planId}`, { minToDepart: 6, formationDeadlineDaysBefore: 0 })).status).toBe(200);
    expect((await rows(tripId))[0]).toEqual(before);
    const second = await owner.post(`/api/trips/${tripId}/departures`, {
      planId, departsOn: '2042-01-16', startTime: '00:30', capacity: 8, primaryStaffId: SHOP_A.staffA2,
    });
    expect(second.status).toBe(200);
    const batch = await owner.post(`/api/trips/${tripId}/departures/batch`, {
      planId, from: '2042-01-17', to: '2042-01-18', weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00', capacity: 8, primaryStaffId: SHOP_A.staffA2,
    });
    expect(batch.status).toBe(200);
    expect((await json(batch)).data.created).toBe(2);
    const saved = await rows(tripId);
    expect(saved).toHaveLength(4);
    expect(saved[0]).toEqual(before);
    expect(saved.slice(1).every((row) => row.min_to_depart_snapshot === 6 && row.formation_status === 'COLLECTING')).toBe(true);
    expect(saved.slice(1).map((row) => new Date(row.formation_deadline_at).toISOString())).toEqual([
      '2042-01-15T16:30:00.000Z', '2042-01-17T01:00:00.000Z', '2042-01-18T01:00:00.000Z',
    ]);
  });

  it('capacity/past-deadline/tenant failures leave zero rows; explicit confirmation unblocks a near departure', async () => {
    const { tripId, planId } = await newPlan();
    expect((await owner.put(`/api/trip-plans/${planId}`, { minToDepart: 4, formationDeadlineDaysBefore: 7 })).status).toBe(200);
    // Relative dates keep the past-default scenario true when CI runs on another day.
    const day = (offset: number) => new Date(Date.now() + offset * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
    const single = { planId, departsOn: day(2), startTime: '09:00', capacity: 8, primaryStaffId: SHOP_A.staffA2 };
    const batch = { planId, from: day(2), to: day(3), weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', capacity: 8, primaryStaffId: SHOP_A.staffA2 };
    for (const [suffix, body] of [['', single], ['/batch', batch]] as const) {
      const lowCapacity = await owner.post(`/api/trips/${tripId}/departures${suffix}`, { ...body, capacity: 3 });
      expect(lowCapacity.status).toBe(400);
      const past = await owner.post(`/api/trips/${tripId}/departures${suffix}`, body);
      expect(past.status).toBe(400);
      expect((await json(past)).message).toContain('請選擇新的成團截止時間');
      expect(await rows(tripId)).toEqual([]);
    }
    const foreign = await otherOwner.post(`/api/trips/${tripId}/departures`, { ...single, departsOn: '2042-02-01' });
    expect([403, 404]).toContain(foreign.status);
    const another = await newPlan();
    expect((await owner.post(`/api/trips/${another.tripId}/departures`, { ...single, departsOn: '2042-02-01' })).status).toBe(404);
    expect(await rows(tripId)).toEqual([]);
    expect(await rows(another.tripId)).toEqual([]);

    const override = new Date(Date.now() + 86400000).toISOString();
    const confirmed = await owner.post(`/api/trips/${tripId}/departures`, { ...single, formationDeadlineAt: override });
    expect(confirmed.status).toBe(200);
    expect(new Date((await rows(tripId))[0].formation_deadline_at).toISOString()).toBe(override);
    // Different dates avoid assignment overlap with the just-created single departure.
    const confirmedBatch = await owner.post(`/api/trips/${tripId}/departures/batch`, {
      ...batch, from: day(3), to: day(4), formationDeadlineAt: override,
    });
    expect(confirmedBatch.status).toBe(200);
    expect((await json(confirmedBatch)).data.created).toBe(2);
    expect((await rows(tripId)).every((row) => row.min_to_depart_snapshot === 4
      && new Date(row.formation_deadline_at).toISOString() === override)).toBe(true);
  });
  it('tenant Tokyo/New York calendar snapshots and PUT guards persist through HTTP/raw DB', async () => {
    const settings = await json(await owner.get('/api/settings'));
    originalBasic = { ...settings.data.basic };
    const setZone = async (timezone: string) => expect((await owner.put('/api/settings', { basic: { ...originalBasic, timezone } })).status).toBe(200);
    const { tripId, planId } = await newPlan();
    expect((await owner.put(`/api/trip-plans/${planId}`, { minToDepart: 4, formationDeadlineDaysBefore: 7 })).status).toBe(200);
    await setZone('Asia/Tokyo');
    const tokyo = await owner.post(`/api/trips/${tripId}/departures`, {
      planId, departsOn: '2042-01-15', startTime: '00:30', capacity: 8, primaryStaffId: SHOP_A.staffA2, formationTimeZone: 'Asia/Tokyo',
    });
    expect(tokyo.status).toBe(200);
    const saved = (await rows(tripId))[0];
    expect(new Date(saved.formation_deadline_at).toISOString()).toBe('2042-01-07T15:30:00.000Z');
    expect((await owner.put(`/api/trip-departures/${saved.id}`, { capacity: 3 })).status).toBe(400);
    expect((await owner.put(`/api/trip-departures/${saved.id}`, { departsOn: '2042-01-05' })).status).toBe(400);
    expect((await rows(tripId))[0]).toEqual(saved);
    expect((await owner.put(`/api/trip-plans/${planId}`, { minToDepart: 7 })).status).toBe(200);
    expect((await owner.put(`/api/trip-departures/${saved.id}`, {
      departsOn: '2042-01-05', formationDeadlineAt: '2042-01-04T00:00:00Z', formationTimeZone: 'Asia/Tokyo',
    })).status).toBe(200);
    expect((await rows(tripId))[0]).toMatchObject({ departs_on: '2042-01-05', min_to_depart_snapshot: 4 });
    expect(new Date((await rows(tripId))[0].formation_deadline_at).toISOString()).toBe('2042-01-04T00:00:00.000Z');
    await setZone('America/New_York');
    const batch = await owner.post(`/api/trips/${tripId}/departures/batch`, {
      planId, from: '2042-03-12', to: '2042-03-13', weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '10:00', capacity: 8,
      primaryStaffId: SHOP_A.staffA2, formationTimeZone: 'America/New_York',
    });
    expect(batch.status).toBe(200);
    const all = await rows(tripId);
    expect(all.slice(1).map(row => new Date(row.formation_deadline_at).toISOString())).toEqual(['2042-03-05T15:00:00.000Z', '2042-03-06T15:00:00.000Z']);
    // Legacy elapsed/null cutoffs must not prevent unrelated edits.
    const legacy = all[1];
    expect((await admin.from('trip_departures').update({ formation_deadline_at: null }).eq('tenant_id', SHOP_A.id).eq('id', legacy.id)).error).toBeNull();
    expect((await owner.put(`/api/trip-departures/${legacy.id}`, { note: 'legacy snapshot preserved', capacity: 7 })).status).toBe(200);
    expect((await rows(tripId))[1]).toMatchObject({ formation_deadline_at: null, min_to_depart_snapshot: 7, note: 'legacy snapshot preserved' });
  });

});
