import { describe, expect, it } from 'vitest';

import { mapTripPlan } from '@/server/mappers';
import { toAdvancedPlanPayload, toQuickPlanPayload } from '@/lib/trip-plan-quick-edit';
import type { TripPlan } from '@/lib/types';

const row = (source?: unknown) => ({
  id: 'plan-1',
  trip_id: 'trip-1',
  name: '標準方案',
  description: '',
  price_per_person: 3000,
  child_price: null,
  min_party: 1,
  max_party: 10,
  deposit_mode: 'FULL',
  deposit_value: 0,
  sort_order: 1,
  active: true,
  ...(source === undefined ? {} : { source }),
});

/*
 * #42 驗收：source=PLATFORM_ASSISTED 要顯示 badge，但導遊仍可編輯。
 * badge 的前提是 source 真的從資料庫送到前端契約——0095 起 trip_plans.source
 * 是真實欄位，但 mapTripPlan 一直沒有把它讀出來。
 */
describe('#42 方案來源標記', () => {
  it('把資料庫的 source 送進前端契約', () => {
    expect(mapTripPlan(row('PLATFORM_ASSISTED')).source).toBe('PLATFORM_ASSISTED');
    expect(mapTripPlan(row('IMPORTED')).source).toBe('IMPORTED');
    expect(mapTripPlan(row('GUIDE')).source).toBe('GUIDE');
  });

  /*
   * 收斂方向刻意是 fail-closed：寧可少顯示一個 badge，也不要把不認識的
   * 來源值當成「Midao 代建」秀給導遊看。
   */
  it.each([
    ['未帶欄位', undefined],
    ['空字串', ''],
    ['null', null],
    ['未知值', 'SOMETHING_ELSE'],
    ['小寫', 'platform_assisted'],
    ['數字', 1],
  ])('把 %s 收斂成 GUIDE 而不是代建', (_label, value) => {
    expect(mapTripPlan(row(value)).source).toBe('GUIDE');
  });

  /*
   * source 由伺服器端依代登入狀態決定，客戶端不得傳入。兩個 payload
   * 都是白名單投影，這裡把「不得外洩」釘成回歸測試而不是慣例。
   */
  it('Quick 與 Advanced payload 都不帶 source', () => {
    const plan = { ...mapTripPlan(row('PLATFORM_ASSISTED')) } as TripPlan;
    expect(Object.keys(toQuickPlanPayload(plan))).not.toContain('source');
    expect(Object.keys(toAdvancedPlanPayload(plan))).not.toContain('source');
  });
});
