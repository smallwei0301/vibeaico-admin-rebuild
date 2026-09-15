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
  durationMinutes: number;
  priceType: 'PER_PERSON' | 'PER_GROUP';
  yearRound: boolean;
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
        /**
         * issue #37：OPEN 團次現在必須有一位主導遊。
         *
         * ⚠️ 這裡刻意用 **staffA2**，不是 staffA1：`tours.10.test.ts` 也在
         * `2027-01-10 09:00` 建一個 SHOP_A 的團次並指派 staffA1，而那些行程是用
         * `POST /api/trips` 建的（沒有 durationHours → `trips.duration_hours` 為
         * null → 團次視為**整日**佔用）。兩個檔跑在同一個資料庫上，用同一位導遊
         * 就會撞班而 409。
         */
        primaryStaffId: SHOP_A.staffA2,
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

  /*
   * #42：durationMinutes / priceType / yearRound 在 0110 之前是
   * mapTripPlan() 寫死的假值——PUT 之後永遠不會反映在重新 GET 的結果上，
   * 因為 `trip_plans` 根本沒有這三個欄位。這裡不只看 200，也重新 GET 一次
   * 確認值真的存進資料庫，而不是只在回應裡回顯了請求體。
   */
  it('持久化時長／計價方式／全年販售，重新 GET 後值不變', async () => {
    const tripResponse = await ownerA.post('/api/trips', {
      title: `#42 Duration/PriceType ${randomUUID()}`,
      slug: `test-${randomUUID()}`,
    });
    expect(tripResponse.status).toBe(200);
    const tripId = (await json<{ id: string }>(tripResponse)).data!.id;

    try {
      const planResponse = await ownerA.post(`/api/trips/${tripId}/plans`, {
        name: '時長計價測試方案',
        pricePerPerson: 2000,
      });
      expect(planResponse.status).toBe(200);
      const created = (await json<PlanResponse>(planResponse)).data!;
      // 建立時不帶欄位 → 與 0110 的 DB 預設值一致
      expect(created.durationMinutes).toBe(60);
      expect(created.priceType).toBe('PER_PERSON');
      expect(created.yearRound).toBe(true);
      const planId = created.id;

      const update = await ownerA.put(`/api/trip-plans/${planId}`, {
        durationMinutes: 240,
        priceType: 'PER_GROUP',
        yearRound: false,
      });
      expect(update.status).toBe(200);
      expect((await json<PlanResponse>(update)).data).toMatchObject({
        id: planId,
        durationMinutes: 240,
        priceType: 'PER_GROUP',
        yearRound: false,
      });

      const reread = await ownerA.get(`/api/trips/${tripId}/plans`);
      expect(reread.status).toBe(200);
      expect((await json<PlanResponse[]>(reread)).data).toEqual([
        expect.objectContaining({
          id: planId,
          durationMinutes: 240,
          priceType: 'PER_GROUP',
          yearRound: false,
        }),
      ]);
    } finally {
      await admin.from('trips').delete().eq('id', tripId).eq('tenant_id', SHOP_A.id);
    }
  });
});

/*
 * #42：priceType 從純顯示變成真的影響金額——`create_tour_order` 現在依
 * `trip_plans.price_type` 決定 `total_amount`。PER_GROUP 是整團一口價
 * （與人數無關），PER_PERSON 維持既有「單價 × 人數」語意。兩種方案都用
 * party_size > 1 下單，用真實金額斷言而不是只看 200。
 */
describe('#42 priceType 影響 create_tour_order 的 total_amount', () => {
  it('PER_GROUP 一口價、PER_PERSON 單價乘人數', async () => {
    const tripResponse = await ownerA.post('/api/trips', {
      title: `#42 PriceType Order ${randomUUID()}`,
      slug: `test-${randomUUID()}`,
    });
    expect(tripResponse.status).toBe(200);
    const tripId = (await json<{ id: string }>(tripResponse)).data!.id;

    try {
      const perPersonPlan = await ownerA.post(`/api/trips/${tripId}/plans`, {
        name: '每人計價方案', pricePerPerson: 1000, minParty: 1, maxParty: 10,
      });
      expect(perPersonPlan.status).toBe(200);
      const perPersonPlanId = (await json<PlanResponse>(perPersonPlan)).data!.id;

      const perGroupPlan = await ownerA.post(`/api/trips/${tripId}/plans`, {
        name: '每團計價方案', pricePerPerson: 1000, minParty: 1, maxParty: 10,
      });
      expect(perGroupPlan.status).toBe(200);
      const perGroupPlanId = (await json<PlanResponse>(perGroupPlan)).data!.id;
      const setPriceType = await ownerA.put(`/api/trip-plans/${perGroupPlanId}`, { priceType: 'PER_GROUP' });
      expect(setPriceType.status).toBe(200);

      const perPersonDeparture = await ownerA.post(`/api/trips/${tripId}/departures`, {
        planId: perPersonPlanId, departsOn: '2027-02-10', capacity: 20, startTime: '09:00',
        primaryStaffId: SHOP_A.staffA2,
      });
      expect(perPersonDeparture.status).toBe(200);
      const perPersonDepartureId = (await json<{ id: string }>(perPersonDeparture)).data!.id;

      const perGroupDeparture = await ownerA.post(`/api/trips/${tripId}/departures`, {
        planId: perGroupPlanId, departsOn: '2027-02-11', capacity: 20, startTime: '09:00',
        primaryStaffId: SHOP_A.staffA2,
      });
      expect(perGroupDeparture.status).toBe(200);
      const perGroupDepartureId = (await json<{ id: string }>(perGroupDeparture)).data!.id;

      const partySize = 4;
      const perPersonOrder = await ownerA.post('/api/tour-orders/manual', {
        departureId: perPersonDepartureId,
        customerName: `#42 每人計價-${randomUUID().slice(0, 8)}`,
        customerPhone: '0912345678',
        partySize,
      });
      expect(perPersonOrder.status).toBe(200);
      const perPersonOrderData = (await json<any>(perPersonOrder)).data!;
      expect(perPersonOrderData.totalAmount).toBe(1000 * partySize);

      const perGroupOrder = await ownerA.post('/api/tour-orders/manual', {
        departureId: perGroupDepartureId,
        customerName: `#42 每團計價-${randomUUID().slice(0, 8)}`,
        customerPhone: '0912345678',
        partySize,
      });
      expect(perGroupOrder.status).toBe(200);
      const perGroupOrderData = (await json<any>(perGroupOrder)).data!;
      // 整團一口價：與人數無關，等於方案單價本身，不是 1000 * partySize。
      expect(perGroupOrderData.totalAmount).toBe(1000);

      await admin.from('tour_orders').delete().in('id', [perPersonOrderData.id, perGroupOrderData.id]);
    } finally {
      await admin.from('trips').delete().eq('id', tripId).eq('tenant_id', SHOP_A.id);
    }
  });
});
