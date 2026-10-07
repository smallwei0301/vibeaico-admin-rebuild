/**
 * #42 — deleteTrip（mock 分支）LISTED 擋閘行為測試。
 * 獨立成檔：trip-delete-listed.42.test.ts 會把 `@/config/env` mock 成 USE_MOCK=false
 * 以測 route，無法同檔測 mock 分支。這裡不 mock env（預設 USE_MOCK=true）。
 */
import { describe, expect, it } from 'vitest';
import type { Trip, TripPlan } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { MOCK_TRIPS, MOCK_TRIP_PLANS } from '@/mock/tours';
import { deleteTrip } from '@/services/tours';

describe('#42 deleteTrip（mock 分支）行為', () => {
  // 在測試內自建行程／方案（含季節），不改共用 mock 資料；結束後清掉。
  const seed = (id: string, midaoListing: 'NONE' | 'LISTED') => {
    const trip = { ...MOCK_TRIPS[0], id, midaoListing } as Trip;
    const plan = {
      ...MOCK_TRIP_PLANS[0], id: `${id}_plan`, tripId: id,
      seasons: [{ id: `${id}_ss`, name: 's', startMonth: 1, endMonth: 2 }],
    } as unknown as TripPlan;
    MOCK_TRIPS.push(trip);
    MOCK_TRIP_PLANS.push(plan);
    return { trip, plan };
  };
  const cleanup = (id: string) => {
    for (const arr of [MOCK_TRIPS, MOCK_TRIP_PLANS] as { id: string; tripId?: string }[][]) {
      for (let i = arr.length - 1; i >= 0; i -= 1) if (arr[i].id === id || arr[i].tripId === id) arr.splice(i, 1);
    }
  };

  it('LISTED 行程 reject 409 REQ_003，行程、方案與季節都沒被刪', async () => {
    const { plan } = seed('t42_listed', 'LISTED');
    try {
      const err = await deleteTrip('t42_listed').then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).code).toBe('REQ_003');
      expect(MOCK_TRIPS.some((t) => t.id === 't42_listed')).toBe(true);
      const kept = MOCK_TRIP_PLANS.find((p) => p.id === plan.id);
      expect(kept).toBeDefined();
      expect(kept!.seasons).toHaveLength(1);
    } finally { cleanup('t42_listed'); }
  });

  it('NONE 行程成功刪除，連帶清掉方案', async () => {
    seed('t42_none', 'NONE');
    try {
      await expect(deleteTrip('t42_none')).resolves.toBeUndefined();
      expect(MOCK_TRIPS.some((t) => t.id === 't42_none')).toBe(false);
      expect(MOCK_TRIP_PLANS.some((p) => p.tripId === 't42_none')).toBe(false);
    } finally { cleanup('t42_none'); }
  });
});
