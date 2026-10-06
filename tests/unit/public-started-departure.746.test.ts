/**
 * #746：旅客不可預約／申請「今天已過開始時間」的團次。
 *
 * 兩層防線都要證：
 *   1. `hasStartedToday` 的邊界（`<=`：開始時間剛好等於現在＝已開始）。
 *   2. 送出路徑（submitPublicTourBooking／submitPublicTourRequest）重新載入同一個 loader，
 *      找不到該團次就丟 DEPARTURE_NOT_AVAILABLE，且**完全沒有呼叫** create_tour_order rpc
 *      （不是呼叫了才被 DB 擋——名額與訂單都不能動）。
 * 時間用 fake Date 固定：2098-01-02T02:00:00Z ＝ 台北 2098-01-02 10:00。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const DEP = {
  started: '22222222-2222-4222-8222-000000000001',
  startedExact: '22222222-2222-4222-8222-000000000002',
  notYet: '22222222-2222-4222-8222-000000000003',
  nullTime: '22222222-2222-4222-8222-000000000004',
  tomorrow: '22222222-2222-4222-8222-000000000005',
};

const state = vi.hoisted(() => ({
  mode: 'FIXED_DEPARTURE' as string,
  tz: undefined as unknown,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  deps: [] as Array<{ id: string; departs_on: string; start_time: string | null }>,
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return { data: 'order-1', error: null };
    },
    from(table: string) {
      const run = async () => {
        if (table === 'tenants') {
          return { data: { id: 't1', tenant_settings: { basic: { tenantName: 'Shop', ...(state.tz === undefined ? {} : { timezone: state.tz }) } } }, error: null };
        }
        if (table === 'trip_plans') {
          return {
            data: {
              id: '11111111-1111-4111-8111-111111111111', trip_id: 'trip1', name: 'P', description: '', price_per_person: 1000,
              price_type: 'PER_PERSON', min_party: 1, max_party: 6, sales_mode: state.mode, active: true, request_hold_hours: 12,
            },
            error: null,
          };
        }
        if (table === 'trips') return { data: { id: 'trip1', title: 'T', status: 'PUBLISHED', refund_policy_type: 'STANDARD' }, error: null };
        if (table === 'trip_departures') {
          return { data: state.deps.map((d) => ({ ...d, capacity: 5, seats_booked: 0 })), error: null };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain, order: () => chain, eq: () => chain, gte: () => chain, in: () => chain, range: () => chain,
        maybeSingle: () => run(),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));
vi.mock('@/server/tour-order-no', () => ({ nextTourOrderNo: async () => 'TO9801020001' }));

import { hasStartedToday, tenantNowParts } from '@/lib/public-time-zone';
import { loadPublicBookingPlan, submitPublicTourBooking } from '@/server/public-tour-booking';
import { loadPublicRequestPlan, submitPublicTourRequest } from '@/server/public-tour-request';

const NOW_UTC = '2098-01-02T02:00:00Z'; // 台北 2098-01-02 10:00
const TODAY = '2098-01-02';
const TOMORROW = '2098-01-03';

describe('#746 hasStartedToday 邊界（實作為 <=：開始時間剛好等於現在 → 視為已開始）', () => {
  const now = { today: TODAY, hm: '10:00' };
  it('今天、開始時間早於現在 → 已開始', () => {
    expect(hasStartedToday({ departs_on: TODAY, start_time: '09:00:00' }, now)).toBe(true);
  });
  it('今天、開始時間剛好等於現在（10:00）→ 已開始（<= 邊界）', () => {
    expect(hasStartedToday({ departs_on: TODAY, start_time: '10:00:00' }, now)).toBe(true);
    expect(hasStartedToday({ departs_on: TODAY, start_time: '10:00' }, now)).toBe(true);
  });
  it('今天、開始時間比現在晚一分鐘（10:01）→ 未開始', () => {
    expect(hasStartedToday({ departs_on: TODAY, start_time: '10:01:00' }, now)).toBe(false);
  });
  it('今天、start_time 為 null → 未開始（無法判定，維持列出）', () => {
    expect(hasStartedToday({ departs_on: TODAY, start_time: null }, now)).toBe(false);
    expect(hasStartedToday({ departs_on: TODAY }, now)).toBe(false);
  });
  it('明天（即使開始時間字串更早）→ 未開始', () => {
    expect(hasStartedToday({ departs_on: TOMORROW, start_time: '00:00:00' }, now)).toBe(false);
  });
});

describe('#746 送出路徑拒絕今天已開始的團次（不呼叫 create_tour_order）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW_UTC));
    state.rpcCalls = [];
    state.tz = undefined; // 預設台北
    state.deps = [
      { id: DEP.started, departs_on: TODAY, start_time: '09:00:00' },
      { id: DEP.startedExact, departs_on: TODAY, start_time: '10:00:00' },
      { id: DEP.notYet, departs_on: TODAY, start_time: '10:01:00' },
      { id: DEP.nullTime, departs_on: TODAY, start_time: null },
      { id: DEP.tomorrow, departs_on: TOMORROW, start_time: '08:00:00' },
    ];
  });
  afterEach(() => { vi.useRealTimers(); });

  const bookingInput = (departureId: string) => ({
    shopCode: 'tenant-a', planId: PLAN_ID, departureId, partySize: 2, contactName: '王小明', contactPhone: '0912345678',
  });
  const requestInput = bookingInput;

  it('tenantNowParts 以店家時區換算（前提：台北 10:00）', () => {
    expect(tenantNowParts('Asia/Taipei')).toEqual({ today: TODAY, hm: '10:00' });
  });

  describe('FIXED_DEPARTURE：submitPublicTourBooking', () => {
    beforeEach(() => { state.mode = 'FIXED_DEPARTURE'; });

    it('預約頁資料不列出已開始（含剛好等於現在）的團次；未到、null、明天都列出', async () => {
      const plan = await loadPublicBookingPlan('tenant-a', PLAN_ID, { withSeasonPrices: false });
      expect(plan!.departures.map((d) => d.id)).toEqual([DEP.notYet, DEP.nullTime, DEP.tomorrow]);
    });

    it.each([['開始時間已過', DEP.started], ['開始時間剛好等於現在', DEP.startedExact]])(
      '%s → DEPARTURE_NOT_AVAILABLE，且沒有呼叫任何 rpc', async (_l, id) => {
        await expect(submitPublicTourBooking(bookingInput(id))).rejects.toMatchObject({ code: 'DEPARTURE_NOT_AVAILABLE' });
        expect(state.rpcCalls).toEqual([]);
      });

    it.each([['今天未到', DEP.notYet], ['今天 start_time 為 null', DEP.nullTime], ['明天', DEP.tomorrow]])(
      '%s → 呼叫 create_tour_order 且帶正確 departure', async (_l, id) => {
        await expect(submitPublicTourBooking(bookingInput(id))).resolves.toEqual({ orderId: 'order-1', orderNo: 'TO9801020001' });
        expect(state.rpcCalls).toHaveLength(1);
        expect(state.rpcCalls[0].fn).toBe('create_tour_order');
        expect(state.rpcCalls[0].args.p_departure).toBe(id);
      });

    it('店家時區影響判斷：洛杉磯 2098-01-01 18:00，台北視角「今天」的團次對它是明天 → 不算已開始', async () => {
      state.tz = 'America/Los_Angeles';
      state.deps = [{ id: DEP.started, departs_on: TODAY, start_time: '09:00:00' }];
      await expect(submitPublicTourBooking(bookingInput(DEP.started))).resolves.toMatchObject({ orderId: 'order-1' });
      expect(state.rpcCalls).toHaveLength(1);
    });
  });

  describe('REQUEST：submitPublicTourRequest', () => {
    beforeEach(() => { state.mode = 'REQUEST'; });

    it('申請頁資料不列出已開始（含剛好等於現在）的團次', async () => {
      const plan = await loadPublicRequestPlan('tenant-a', PLAN_ID, { withSeasonPrices: false });
      expect(plan!.departures.map((d) => d.id)).toEqual([DEP.notYet, DEP.nullTime, DEP.tomorrow]);
    });

    it.each([['開始時間已過', DEP.started], ['開始時間剛好等於現在', DEP.startedExact]])(
      '%s → DEPARTURE_NOT_AVAILABLE，且沒有呼叫任何 rpc', async (_l, id) => {
        await expect(submitPublicTourRequest(requestInput(id))).rejects.toMatchObject({ code: 'DEPARTURE_NOT_AVAILABLE' });
        expect(state.rpcCalls).toEqual([]);
      });

    it.each([['今天未到', DEP.notYet], ['今天 start_time 為 null', DEP.nullTime], ['明天', DEP.tomorrow]])(
      '%s → 呼叫 create_tour_order', async (_l, id) => {
        await expect(submitPublicTourRequest(requestInput(id))).resolves.toEqual({ orderId: 'order-1', orderNo: 'TO9801020001' });
        expect(state.rpcCalls).toHaveLength(1);
        expect(state.rpcCalls[0].args.p_departure).toBe(id);
      });

    it('店家時區影響判斷（申請 loader）：洛杉磯 2098-01-01 18:00，台北視角「今天」的團次對它是明天 → 列出且可送出', async () => {
      state.tz = 'America/Los_Angeles';
      state.deps = [{ id: DEP.started, departs_on: TODAY, start_time: '09:00:00' }];
      const plan = await loadPublicRequestPlan('tenant-a', PLAN_ID, { withSeasonPrices: false });
      expect(plan!.departures.map((d) => d.id)).toEqual([DEP.started]);
      await expect(submitPublicTourRequest(requestInput(DEP.started))).resolves.toMatchObject({ orderId: 'order-1' });
      expect(state.rpcCalls).toHaveLength(1);
    });
  });
});
