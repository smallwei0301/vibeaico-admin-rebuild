/**
 * issue #8／2026-09-11 Owner Decision — 「複製行程」的完整持久化複製
 * -----------------------------------------------------------------------------
 * `docs/decisions/2026-09-11-guide-trip-duplication.md` 要求複製一次要同時帶入
 * Trip 本身、全部 TripPlan（含季節定價）、全部 TripAddon，三者全部成功或全部失敗，
 * 且明確排除 TripDeparture／TourOrder 等營運資料。
 *
 * 這裡直接呼叫 `src/services/tours.ts` 的 `duplicateTripFully()`（不是讀原始碼字串），
 * 對著 mock 資料集（`NEXT_PUBLIC_USE_MOCK` 預設 true，見 `src/config/env.ts`）驗證：
 *   ① 新 Trip／全部方案／全部方案的季節定價／全部加購都真的多了一份，欄位值相符。
 *   ② 新 Trip 一律 DRAFT／NONE，不沿用來源的 PUBLISHED／Midao 審核狀態。
 *   ③ TripDeparture／TourOrder 完全沒有被複製（數量不變）。
 *   ④ 複製中途失敗時，剛建立的新 Trip 會被清掉，不留下只有 Trip 沒有方案的半套複本。
 */
import { describe, expect, it } from 'vitest';
import {
  createTrip, deleteTrip, duplicateTripFully, getTrip, listTripAddons,
  listTripDepartures, listTripPlans, listTrips, listTourOrders,
  saveTripAddon, saveTripPlan, saveTripPlanSeason,
} from '@/services/tours';
import { MOCK_TRIPS, MOCK_TRIP_PLANS, MOCK_TRIP_ADDONS, MOCK_TRIP_DEPARTURES } from '@/mock/tours';

const SOURCE_TRIP_ID = 'tp_1';

function sourceDuplicatePayload() {
  const source = MOCK_TRIPS.find((t) => t.id === SOURCE_TRIP_ID)!;
  return {
    title: `${source.title}（複本）`,
    slug: `${source.slug}-copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    tagline: source.tagline,
    summary: source.summary,
    description: source.description,
    coverImageUrl: source.coverImageUrl,
    galleryUrls: source.galleryUrls,
    region: source.region,
    meetingPoint: source.meetingPoint,
    meetingPointMapUrl: source.meetingPointMapUrl,
    inclusions: source.inclusions,
    exclusions: source.exclusions,
    notices: source.notices,
    safetyNotice: source.safetyNotice,
    refundPolicyType: source.refundPolicyType,
  };
}

/** 測試結束後把 duplicateTripFully() 建立的新 Trip 連同底下的 Plan／Addon 清乾淨。 */
async function cleanupDuplicate(newTripId: string) {
  const tIdx = MOCK_TRIPS.findIndex((t) => t.id === newTripId);
  if (tIdx >= 0) MOCK_TRIPS.splice(tIdx, 1);
  for (let i = MOCK_TRIP_PLANS.length - 1; i >= 0; i -= 1) {
    if (MOCK_TRIP_PLANS[i].tripId === newTripId) MOCK_TRIP_PLANS.splice(i, 1);
  }
  for (let i = MOCK_TRIP_ADDONS.length - 1; i >= 0; i -= 1) {
    if (MOCK_TRIP_ADDONS[i].tripId === newTripId) MOCK_TRIP_ADDONS.splice(i, 1);
  }
}

describe('duplicateTripFully()：Trip ＋ 全部 Plan（含季節）＋ 全部 Addon 一起真正持久化', () => {
  it('新 Trip 帶入來源內容欄位，且狀態重設為 DRAFT／NONE', async () => {
    const source = (await listTrips()).find((t) => t.id === SOURCE_TRIP_ID)!;
    expect(source.status, '這筆 fixture 的前提假設').not.toBe('DRAFT');

    const created = await duplicateTripFully(SOURCE_TRIP_ID, sourceDuplicatePayload());
    try {
      expect(created.id).not.toBe(SOURCE_TRIP_ID);
      expect(created.title).toBe(`${source.title}（複本）`);
      expect(created.summary).toBe(source.summary);
      expect(created.region).toBe(source.region);
      expect(created.status, '新複本必須一律 DRAFT，不得沿用來源的公開狀態').toBe('DRAFT');
      expect(created.midaoListing, '新複本必須一律 NONE，不得沿用來源的 Midao 審核狀態').toBe('NONE');

      const reread = await getTrip(created.id);
      expect(reread?.id).toBe(created.id);
    } finally {
      await cleanupDuplicate(created.id);
    }
  });

  it('複製來源全部 TripPlan（含季節定價），欄位值與來源一致', async () => {
    const sourcePlans = await listTripPlans(SOURCE_TRIP_ID);
    expect(sourcePlans.length).toBeGreaterThan(0);
    const sourceSeasonTotal = sourcePlans.reduce((n, p) => n + p.seasons.length, 0);
    expect(sourceSeasonTotal, '這筆 fixture 至少要有一個方案帶季節定價，測試才有意義').toBeGreaterThan(0);

    const created = await duplicateTripFully(SOURCE_TRIP_ID, sourceDuplicatePayload());
    try {
      const newPlans = await listTripPlans(created.id);
      expect(newPlans.length).toBe(sourcePlans.length);

      for (const sp of sourcePlans) {
        const np = newPlans.find((p) => p.name === sp.name);
        expect(np, `找不到複製後的方案 ${sp.name}`).toBeDefined();
        expect(np!.id).not.toBe(sp.id);
        expect(np!.tripId).toBe(created.id);
        expect(np!.basePrice).toBe(sp.basePrice);
        expect(np!.childPrice).toBe(sp.childPrice);
        expect(np!.durationMinutes).toBe(sp.durationMinutes);
        expect(np!.priceType).toBe(sp.priceType);
        expect(np!.minParticipants).toBe(sp.minParticipants);
        expect(np!.maxParticipants).toBe(sp.maxParticipants);
        expect(np!.depositMode).toBe(sp.depositMode);
        expect(np!.depositValue).toBe(sp.depositValue);
        expect(np!.active).toBe(sp.active);
        expect(np!.yearRound).toBe(sp.yearRound);

        expect(np!.seasons.length, `方案 ${sp.name} 的季節定價數量沒有對上`).toBe(sp.seasons.length);
        for (const ss of sp.seasons) {
          const ns = np!.seasons.find((s) => s.name === ss.name);
          expect(ns, `找不到複製後的季節 ${ss.name}`).toBeDefined();
          expect(ns!.id).not.toBe(ss.id);
          expect(ns!.startMonth).toBe(ss.startMonth);
          expect(ns!.startDay).toBe(ss.startDay);
          expect(ns!.endMonth).toBe(ss.endMonth);
          expect(ns!.endDay).toBe(ss.endDay);
          expect(ns!.priceOverride).toBe(ss.priceOverride);
        }

        // 新複本的方案送審狀態必須回到未審核，不得沿用來源的核准/退回結果。
        expect(np!.reviewState).toBe('NONE');
      }
    } finally {
      await cleanupDuplicate(created.id);
    }
  });

  it('複製來源全部 TripAddon，欄位值與來源一致', async () => {
    const sourceAddons = await listTripAddons(SOURCE_TRIP_ID);
    expect(sourceAddons.length).toBeGreaterThan(0);

    const created = await duplicateTripFully(SOURCE_TRIP_ID, sourceDuplicatePayload());
    try {
      const newAddons = await listTripAddons(created.id);
      expect(newAddons.length).toBe(sourceAddons.length);
      for (const sa of sourceAddons) {
        const na = newAddons.find((a) => a.name === sa.name);
        expect(na, `找不到複製後的加購 ${sa.name}`).toBeDefined();
        expect(na!.id).not.toBe(sa.id);
        expect(na!.tripId).toBe(created.id);
        expect(na!.price).toBe(sa.price);
        expect(na!.unit).toBe(sa.unit);
        expect(na!.stock).toBe(sa.stock);
        expect(na!.active).toBe(sa.active);
      }
    } finally {
      await cleanupDuplicate(created.id);
    }
  });

  it('明確不複製 TripDeparture／TourOrder（Owner Decision 的排除清單）', async () => {
    const beforeDepartures = MOCK_TRIP_DEPARTURES.length;
    const beforeOrders = (await listTourOrders({ size: 9999 })).totalElements;
    const sourceDepartures = await listTripDepartures(SOURCE_TRIP_ID);
    expect(sourceDepartures.length, '這筆 fixture 至少要有團次，測試才有意義').toBeGreaterThan(0);

    const created = await duplicateTripFully(SOURCE_TRIP_ID, sourceDuplicatePayload());
    try {
      const newDepartures = await listTripDepartures(created.id);
      expect(newDepartures.length, '新 Trip 不應該帶有任何團次').toBe(0);
      expect(MOCK_TRIP_DEPARTURES.length, '不應該新增任何團次列').toBe(beforeDepartures);

      const afterOrders = (await listTourOrders({ size: 9999 })).totalElements;
      expect(afterOrders, '不應該新增任何旅遊訂單').toBe(beforeOrders);
    } finally {
      await cleanupDuplicate(created.id);
    }
  });

  /**
   * `duplicateTripFully()` 內部呼叫的是同一個模組另外具名匯出的 service function
   * （`saveTripPlan`／`createTrip`／`deleteTrip`…），ESM live binding 下
   * `vi.spyOn(await import('@/services/tours'), 'fn')` 攔截不到那個內部呼叫。
   * 這裡改用它的第三個參數（依賴注入，見 `TripDuplicationDeps`）精準模擬「複製到
   * 一半失敗」，不需要整檔 `vi.mock()`、也不會動到真正的實作路徑。
   */
  it('中途失敗（第二個方案複製失敗）會清掉剛建立的新 Trip，不留下半套複本', async () => {
    const sourcePlans = await listTripPlans(SOURCE_TRIP_ID);
    expect(sourcePlans.length, '這筆 fixture 至少要有兩個方案，測試才能模擬「複製到一半」').toBeGreaterThanOrEqual(2);

    const beforeTripCount = MOCK_TRIPS.length;
    const beforePlanCount = MOCK_TRIP_PLANS.length;

    let call = 0;
    const failure = new Error('模擬第二個方案複製失敗（例如網路中斷或後端驗證錯誤）');

    let capturedError: unknown;
    try {
      await duplicateTripFully(SOURCE_TRIP_ID, sourceDuplicatePayload(), {
        createTrip, listTripPlans, listTripAddons, saveTripPlanSeason, saveTripAddon, deleteTrip,
        saveTripPlan: async (tripId, payload) => {
          call += 1;
          if (call === 2) throw failure;
          return saveTripPlan(tripId, payload);
        },
      });
    } catch (e) {
      capturedError = e;
    }

    expect(capturedError, '複製中途失敗必須把錯誤往外拋，不能假裝成功').toBeDefined();
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toContain(failure.message);

    // 新 Trip 不應該留在 MOCK_TRIPS 裡——如果留下代表半套複本沒被清掉。
    expect(MOCK_TRIPS.length, '失敗後不應該留下任何新增的 Trip').toBe(beforeTripCount);
    expect(MOCK_TRIP_PLANS.length, '失敗後不應該留下任何新增的方案').toBe(beforePlanCount);
  });

  it('新 Trip 建立失敗（createTrip 沒有回傳 id）不會嘗試複製方案／加購', async () => {
    const beforePlanCount = MOCK_TRIP_PLANS.length;
    const beforeAddonCount = MOCK_TRIP_ADDONS.length;

    await expect(duplicateTripFully(SOURCE_TRIP_ID, sourceDuplicatePayload(), {
      listTripPlans, listTripAddons, saveTripPlan, saveTripPlanSeason, saveTripAddon, deleteTrip,
      createTrip: async () => undefined as never,
    })).rejects.toThrow();

    expect(MOCK_TRIP_PLANS.length, '不該嘗試複製任何方案').toBe(beforePlanCount);
    expect(MOCK_TRIP_ADDONS.length, '不該嘗試複製任何加購').toBe(beforeAddonCount);
  });

  it('deleteTrip 本身也失敗時，仍然把原始錯誤往外拋（不吞掉、不假裝成功），並標記清理失敗', async () => {
    const planFailure = new Error('模擬方案複製失敗');
    let deleteWasCalledWith: string | undefined;

    let capturedError: unknown;
    try {
      await duplicateTripFully(SOURCE_TRIP_ID, sourceDuplicatePayload(), {
        createTrip, listTripPlans, listTripAddons, saveTripPlanSeason, saveTripAddon,
        saveTripPlan: async () => { throw planFailure; },
        deleteTrip: async (id) => {
          deleteWasCalledWith = id;
          throw new Error('模擬清理刪除也失敗');
        },
      });
    } catch (e) {
      capturedError = e;
    }

    expect(capturedError, '清理本身失敗也不能吞掉原始錯誤').toBeDefined();
    expect((capturedError as Error).message).toContain(planFailure.message);
    expect(deleteWasCalledWith, '應該真的嘗試呼叫 deleteTrip 清理新建的 Trip').toBeTruthy();
    expect((capturedError as { cleanupFailed?: boolean }).cleanupFailed, '清理失敗要如實標記，不能悄悄吞掉').toBe(true);

    // deleteTrip 被注入成一定失敗，沒有真的清除，這裡手動把測試中殘留的新 Trip 清掉，
    // 避免污染其他測試共用的 MOCK_TRIPS。
    if (deleteWasCalledWith) {
      await cleanupDuplicate(deleteWasCalledWith);
    }
  });
});
