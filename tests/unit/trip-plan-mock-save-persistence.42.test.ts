/**
 * #42 — mock（骨架/demo）模式下，Trip Plan 的儲存真的要留下來
 * -----------------------------------------------------------------------------
 * `src/services/tours.ts` 的 `saveTripPlan()`／`deleteTripPlan()` 的 mock 分支
 * 曾經是 `() => undefined`——`/tenant/trips/[id]` 頁面存檔當下會樂觀地把
 * `planDraft` 直接寫進自己的本地 `plans` React state，畫面看起來立刻成功；
 * 但共用的 `MOCK_TRIP_PLANS` 陣列（`listTripPlans()` 唯一的資料來源）從未真的
 * 被改到。只要使用者離開這個行程詳情頁、再點回來（不需要真的重整瀏覽器，
 * 單純 React 元件重新掛載、重新呼叫 `listTripPlans()`），剛剛存的變更就會
 * 消失——與 `docs/AGENT-PLAYBOOK.md` 一貫在抓的「畫面說成功、值沒真的留下」
 * 假成功是同一個模式，只是發生在 demo/mock 分支而不是真後端。
 *
 * 這裡直接呼叫真正的 service function（不是讀原始碼字串），驗證
 * `saveTripPlan()`／`deleteTripPlan()` 的效果會反映在下一次 `listTripPlans()`
 * 讀到的結果裡——這正是「離開頁面重進來」在程式碼層級對應的動作。
 *
 * `NEXT_PUBLIC_USE_MOCK` 預設 `true`（`src/config/env.ts`），所以測試環境本來
 * 就是 mock 分支，不需要另外設環境變數。
 */
import { describe, expect, it } from 'vitest';
import { deleteTripPlan, listTripPlans, saveTripPlan } from '@/services/tours';
import { MOCK_TRIP_PLANS } from '@/mock/tours';

describe('#42 saveTripPlan（mock 分支）真的把異動寫回 MOCK_TRIP_PLANS', () => {
  it('更新既有方案後，重新呼叫 listTripPlans() 讀到新值（不是存檔前的舊值）', async () => {
    const target = MOCK_TRIP_PLANS[0];
    const original = target.durationMinutes;
    const changed = original + 15;

    await saveTripPlan(target.tripId, { id: target.id, durationMinutes: changed });

    const reread = await listTripPlans(target.tripId);
    const found = reread.find((p) => p.id === target.id);
    expect(found, '找不到剛更新的方案').toBeDefined();
    expect(found!.durationMinutes, 'listTripPlans() 讀回的仍是存檔前的舊值——mock 分支沒有真的寫回').toBe(changed);

    // 還原，避免污染其他測試共用的同一份 MOCK_TRIP_PLANS。
    await saveTripPlan(target.tripId, { id: target.id, durationMinutes: original });
  });

  it('只合併有帶到的欄位，不清掉其他既有欄位（同一份 payload 只改一個欄位時）', async () => {
    const target = MOCK_TRIP_PLANS[0];
    const originalName = target.name;
    const originalDuration = target.durationMinutes;
    const changedDuration = originalDuration + 5;

    await saveTripPlan(target.tripId, { id: target.id, durationMinutes: changedDuration });

    const reread = await listTripPlans(target.tripId);
    const found = reread.find((p) => p.id === target.id)!;
    expect(found.name, '只改 durationMinutes 卻把 name 洗掉了').toBe(originalName);
    expect(found.durationMinutes).toBe(changedDuration);

    await saveTripPlan(target.tripId, { id: target.id, durationMinutes: originalDuration });
  });

  it('不帶 id 的 payload（新建方案的呼叫方式）不動任何既有列', async () => {
    const before = MOCK_TRIP_PLANS.length;
    await saveTripPlan('some-trip-id', { name: '未帶 id，不該影響既有資料' });
    expect(MOCK_TRIP_PLANS.length, '不該憑空新增或動到既有列').toBe(before);
  });
});

describe('#42 deleteTripPlan（mock 分支）真的把方案從 MOCK_TRIP_PLANS 移除', () => {
  it('刪除後 listTripPlans() 不再回傳這筆', async () => {
    const target = MOCK_TRIP_PLANS[MOCK_TRIP_PLANS.length - 1];
    const snapshot = { ...target };

    await deleteTripPlan(target.id);

    const reread = await listTripPlans(snapshot.tripId);
    expect(reread.some((p) => p.id === snapshot.id), '刪除後 listTripPlans() 仍讀得到這筆').toBe(false);

    // 還原，避免污染其他測試共用的同一份 MOCK_TRIP_PLANS。
    MOCK_TRIP_PLANS.push(snapshot);
  });
});
