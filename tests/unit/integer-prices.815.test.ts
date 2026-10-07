import { describe, expect, it } from 'vitest';
import {
  addonCreateSchema,
  planCreateSchema,
  planUpdateSchema,
  seasonCreateSchema,
  seasonUpdateSchema,
} from '@/server/tour-domain';
import {
  isValidAddonPrice,
  isValidSeasonPriceOverride,
  validateAdvancedPlan,
  validateQuickPlan,
} from '@/lib/trip-plan-quick-edit';
import type { TripPlan } from '@/lib/types';

const basePlan = { name: '方案', pricePerPerson: 1000 };
const season = { name: '旺季', startMonth: 7, startDay: 1, endMonth: 8, endDay: 31 };

describe('#815 價格限制為整數元：server schema', () => {
  it('pricePerPerson 小數被拒、整數通過', () => {
    expect(planCreateSchema.safeParse({ ...basePlan, pricePerPerson: 100.5 }).success).toBe(false);
    expect(planCreateSchema.safeParse({ ...basePlan, pricePerPerson: 100 }).success).toBe(true);
    expect(planUpdateSchema.safeParse({ pricePerPerson: 100.5 }).success).toBe(false);
    expect(planUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('childPrice 小數被拒；null／省略維持原行為', () => {
    expect(planUpdateSchema.safeParse({ childPrice: 50.5 }).success).toBe(false);
    expect(planUpdateSchema.safeParse({ childPrice: 50 }).success).toBe(true);
    expect(planUpdateSchema.safeParse({ childPrice: null }).success).toBe(true);
    expect(planUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('depositValue 不論 FIXED 或 PERCENT 都限整數', () => {
    expect(planCreateSchema.safeParse({
      ...basePlan, depositMode: 'DEPOSIT_FIXED', depositValue: 100.5,
    }).success).toBe(false);
    expect(planCreateSchema.safeParse({
      ...basePlan, depositMode: 'DEPOSIT_FIXED', depositValue: 100,
    }).success).toBe(true);
    expect(planCreateSchema.safeParse({
      ...basePlan, depositMode: 'DEPOSIT_PERCENT', depositValue: 30.5,
    }).success).toBe(false);
    expect(planCreateSchema.safeParse({
      ...basePlan, depositMode: 'DEPOSIT_PERCENT', depositValue: 30,
    }).success).toBe(true);
  });

  it('加購 price 小數被拒、整數與省略通過', () => {
    expect(addonCreateSchema.safeParse({ name: '餐點', price: 100.5 }).success).toBe(false);
    expect(addonCreateSchema.safeParse({ name: '餐點', price: 100 }).success).toBe(true);
    expect(addonCreateSchema.safeParse({ name: '餐點' }).success).toBe(true);
  });

  it('季節 priceOverride 小數被拒；整數、null、省略通過', () => {
    expect(seasonCreateSchema.safeParse({ ...season, priceOverride: 100.5 }).success).toBe(false);
    expect(seasonCreateSchema.safeParse({ ...season, priceOverride: 100 }).success).toBe(true);
    expect(seasonCreateSchema.safeParse({ ...season, priceOverride: null }).success).toBe(true);
    expect(seasonCreateSchema.safeParse(season).success).toBe(true);
    expect(seasonUpdateSchema.safeParse({ priceOverride: 0.1 }).success).toBe(false);
  });
});

function plan(over: Partial<TripPlan> = {}): TripPlan {
  return {
    id: 'p1', tripId: 't1', name: '方案', description: '', priceType: 'PER_PERSON',
    basePrice: 1000, childPrice: null, minParticipants: 1, maxParticipants: 10,
    depositMode: 'FULL', depositValue: 0, durationMinutes: 60, yearRound: true,
    active: true, sortOrder: 0, seasons: [],
    ...over,
  } as TripPlan;
}

describe('#815 價格限制為整數元：前端驗證', () => {
  it('基本價小數 → basePrice；整數通過', () => {
    expect(validateQuickPlan(plan({ basePrice: 100.5 }), false)).toBe('basePrice');
    expect(validateQuickPlan(plan({ basePrice: 100 }), false)).toBeNull();
  });

  it('兒童價小數 → childPrice；null 與未顯示不驗', () => {
    expect(validateQuickPlan(plan({ childPrice: 50.5 }), true)).toBe('childPrice');
    expect(validateQuickPlan(plan({ childPrice: 50 }), true)).toBeNull();
    expect(validateQuickPlan(plan({ childPrice: null }), true)).toBeNull();
    expect(validateQuickPlan(plan({ childPrice: 50.5 }), false)).toBeNull();
  });

  it('定金小數 → deposit（FIXED 與 PERCENT）', () => {
    expect(validateAdvancedPlan(plan({ depositMode: 'DEPOSIT_FIXED', depositValue: 100.5 }))).toBe('deposit');
    expect(validateAdvancedPlan(plan({ depositMode: 'DEPOSIT_PERCENT', depositValue: 30.5 }))).toBe('deposit');
    expect(validateAdvancedPlan(plan({ depositMode: 'DEPOSIT_FIXED', depositValue: 100 }))).toBeNull();
    expect(validateAdvancedPlan(plan({ depositMode: 'DEPOSIT_PERCENT', depositValue: 30 }))).toBeNull();
  });

  it('季節售價與加購價', () => {
    expect(isValidSeasonPriceOverride(null)).toBe(true);
    expect(isValidSeasonPriceOverride(100)).toBe(true);
    expect(isValidSeasonPriceOverride(100.5)).toBe(false);
    expect(isValidSeasonPriceOverride(-1)).toBe(false);
    expect(isValidAddonPrice(100)).toBe(true);
    expect(isValidAddonPrice(100.5)).toBe(false);
    expect(isValidAddonPrice(Number.NaN)).toBe(false);
  });
});
