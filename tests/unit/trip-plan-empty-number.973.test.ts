import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAdvancedPlan, validateQuickPlan } from '@/lib/trip-plan-quick-edit';
import type { TripPlan } from '@/lib/types';

const plan: TripPlan = {
  id: 'plan-1', tripId: 'trip-1', name: '標準方案', description: '',
  durationMinutes: 180, priceType: 'PER_PERSON', basePrice: 3000, childPrice: null,
  minParticipants: 1, maxParticipants: 10, bookingType: 'SCHEDULED',
  depositMode: 'FULL', depositValue: 0, active: true, yearRound: true,
  seasons: [], reviewState: 'NONE', reviewNote: '', sortOrder: 0,
};

describe('#973 清空數字欄位不得默默變 0', () => {
  it('基本價 NaN（清空）被擋，明確 0 仍允許', () => {
    expect(validateQuickPlan({ ...plan, basePrice: NaN }, false)).toBe('basePrice');
    expect(validateQuickPlan({ ...plan, basePrice: 0 }, false)).toBeNull();
  });

  it('時長 NaN／0 被進階驗證擋下，合法值通過', () => {
    expect(validateAdvancedPlan({ ...plan, durationMinutes: NaN })).toBe('durationMinutes');
    expect(validateAdvancedPlan({ ...plan, durationMinutes: 0 })).toBe('durationMinutes');
    expect(validateAdvancedPlan(plan)).toBeNull();
  });

  it('頁面原始碼不再把空字串轉成 0', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/tenant/trips/[id]/page.tsx'), 'utf8');
    for (const k of ['basePrice', 'durationMinutes', 'minParticipants', 'maxParticipants', 'depositValue']) {
      expect(src).not.toContain(`${k}: Number(e.target.value)`);
      expect(src).toContain(`${k}: e.target.valueAsNumber`);
    }
    expect(src).toContain("durationMinutes') {");
  });
});
