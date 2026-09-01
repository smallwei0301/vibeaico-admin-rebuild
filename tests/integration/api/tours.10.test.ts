/**
 * #8-A focused HTTP acceptance matrix.  This file is intentionally source-only
 * in the Terra lane: running it invokes the shared TEST reset/seed lane and is
 * reserved for the owner of TEST_VALIDATION (currently #35 / run 33467611493).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const PLAN_ID = '7a000000-0000-4000-8000-000000000011';

async function json<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

beforeAll(async () => {
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

describe('trips and lifecycle actions', () => {
  it('GET list succeeds; unauthenticated request is 401 AUTH_001', async () => {
    const response = await ownerA.get('/api/trips');
    expect(response.status).toBe(200);
    expect((await json(response)).success).toBe(true);
    const anonymous = await fetch(`${BASE}/api/trips`);
    expect(anonymous.status).toBe(401);
    expect((await json(anonymous)).code).toBe('AUTH_001');
  });

  it('invalid create is 400 REQ_001 and other tenant cannot read the trip', async () => {
    const invalid = await ownerA.post('/api/trips', { title: '' });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).code).toBe('REQ_001');
    const crossTenant = await ownerB.get(`/api/trips/${TRIP_A.id}`);
    expect(crossTenant.status).toBe(404);
  });

  it('supports publish/unpublish and NONE/REJECTED listing transitions', async () => {
    const response = await ownerA.post('/api/trips', { title: `lifecycle-${randomUUID()}` });
    expect(response.status).toBe(200);
    const tripId = (await json<{ id: string }>(response)).data!.id;
    try {
      const listing = await ownerA.post(`/api/trips/${tripId}/request-midao-listing`);
      expect(listing.status).toBe(200);
      expect((await json(listing)).data).toMatchObject({ midaoListing: 'PENDING' });
      const duplicateListing = await ownerA.post(`/api/trips/${tripId}/request-midao-listing`);
      expect(duplicateListing.status).toBe(409);
      const publish = await ownerA.post(`/api/trips/${tripId}/publish`);
      expect(publish.status).toBe(200);
      const unpublish = await ownerA.post(`/api/trips/${tripId}/unpublish`);
      expect(unpublish.status).toBe(200);
    } finally {
      await admin.from('trips').delete().eq('id', tripId).eq('tenant_id', SHOP_A.id);
    }
  });
});

describe('plans, departures and addons CRUD', () => {
  it('creates and updates each child resource with tenant-owned parent checks', async () => {
    const trip = await ownerA.post('/api/trips', { title: `#8-A ${randomUUID()}`, slug: `test-${randomUUID()}` });
    expect(trip.status).toBe(200);
    const tripId = (await json<{ id: string }>(trip)).data!.id;
    try {
      const plan = await ownerA.post(`/api/trips/${tripId}/plans`, { name: '測試方案', pricePerPerson: 1000 });
      expect(plan.status).toBe(200);
      const planId = (await json<{ id: string }>(plan)).data!.id;
      const departure = await ownerA.post(`/api/trips/${tripId}/departures`, {
        planId, departsOn: '2027-01-10', capacity: 2, startTime: '09:00',
      });
      expect(departure.status).toBe(200);
      const addon = await ownerA.post(`/api/trips/${tripId}/addons`, { name: '接送', price: 0 });
      expect(addon.status).toBe(200);
      expect((await json(addon)).data).toMatchObject({ name: '接送', price: 0 });
      const plans = await ownerA.get(`/api/trips/${tripId}/plans`);
      expect((await json(plans)).data).toHaveLength(1);
      const update = await ownerA.put(`/api/trip-plans/${planId}`, { pricePerPerson: 1200 });
      expect(update.status).toBe(200);
      const departureId = (await json<{ id: string }>(departure)).data!.id;
      await admin.from('trip_departures').update({ seats_booked: 1 }).eq('id', departureId);
      const invalidCapacity = await ownerA.put(`/api/trip-departures/${departureId}`, { capacity: 0 });
      expect(invalidCapacity.status).toBe(400);
      const lowCapacity = await ownerA.put(`/api/trip-departures/${departureId}`, { capacity: 1 });
      expect(lowCapacity.status).toBe(409);
      const batch = await ownerA.post(`/api/trips/${tripId}/departures/batch`, {
        planId, from: '2027-02-01', to: '2027-02-07', weekdays: [1], capacity: 2,
      });
      expect(batch.status).toBe(200);
      expect((await json<{ created: number; skipped: number }>(batch)).data).toMatchObject({ created: 1, skipped: 0 });
      const batchAgain = await ownerA.post(`/api/trips/${tripId}/departures/batch`, {
        planId, from: '2027-02-01', to: '2027-02-07', weekdays: [1], capacity: 2,
      });
      expect((await json<{ created: number; skipped: number }>(batchAgain)).data).toMatchObject({ created: 0, skipped: 1 });
      const addonId = (await json<{ id: string }>(addon)).data!.id;
      expect((await ownerA.put(`/api/trip-addons/${addonId}`, { stock: null })).status).toBe(200);
      expect((await ownerA.delete(`/api/trip-addons/${addonId}`)).status).toBe(200);
      expect((await ownerA.delete(`/api/trip-plans/${planId}`)).status).toBe(200);
    } finally {
      await admin.from('trips').delete().eq('id', tripId).eq('tenant_id', SHOP_A.id);
    }
  });

  it('batch rejects a cross-tenant/missing parent with 404 REQ_002', async () => {
    const result = await ownerA.post('/api/trips/TRIP_NOT_FOUND/departures/batch', {
      planId: PLAN_ID, from: '2027-02-01', to: '2027-02-07', weekdays: [1], capacity: 2,
    });
    expect(result.status).toBe(404);
    expect((await json(result)).code).toBe('REQ_002');
  });
});
