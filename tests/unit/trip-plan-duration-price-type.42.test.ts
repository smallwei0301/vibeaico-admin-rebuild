import { describe, expect, it } from 'vitest';

import { mapTripPlan } from '@/server/mappers';

const row = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

/*
 * #42 驗收：durationMinutes / priceType / yearRound 在 0110 之前是
 * mapTripPlan() 寫死的假值。這裡釘住它們現在真的讀資料庫欄位，而不是
 * 不管方案怎麼設定畫面永遠顯示同一組數字。
 */
describe('#42 方案時長／計價方式／全年販售', () => {
  it('把 duration_minutes / price_type / year_round 真實值讀進前端契約', () => {
    const plan = mapTripPlan(row({
      duration_minutes: 240,
      price_type: 'PER_GROUP',
      year_round: false,
    }));
    expect(plan.durationMinutes).toBe(240);
    expect(plan.priceType).toBe('PER_GROUP');
    expect(plan.yearRound).toBe(false);
  });

  it('duration_minutes 為 Postgres 字串數值 → 轉成 number', () => {
    expect(mapTripPlan(row({ duration_minutes: '90' })).durationMinutes).toBe(90);
  });

  it('未帶欄位（尚未套用 0110 migration 的舊環境）→ 退回 DB 預設值的解讀', () => {
    const plan = mapTripPlan(row());
    expect(plan.durationMinutes).toBe(60);
    expect(plan.priceType).toBe('PER_PERSON');
    expect(plan.yearRound).toBe(true);
  });

  /*
   * fail-closed：未知 price_type 一律收斂成 PER_PERSON，與 mapTripPlan()
   * 對 salesMode／source 既有的收斂方向一致——寧可少一個「每團計價」的
   * 顯示，也不要把不認得的值當成整團一口價，影響訂單金額計算。
   */
  it.each([
    ['null', null],
    ['空字串', ''],
    ['未知值', 'SOMETHING_ELSE'],
    ['小寫', 'per_group'],
    ['數字', 1],
  ])('price_type 為 %s → 收斂成 PER_PERSON', (_label, value) => {
    expect(mapTripPlan(row({ price_type: value })).priceType).toBe('PER_PERSON');
  });

  it('year_round=false 不會被 ?? 誤判成「沒設定」而翻成 true', () => {
    expect(mapTripPlan(row({ year_round: false })).yearRound).toBe(false);
  });
});
