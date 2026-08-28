import { describe, expect, it } from 'vitest';
import type { TripPlan } from '@/lib/types';
import {
  getCurrentAdvancedPlanFields,
  getPlanProvenanceView,
  getQuickPlanFields,
  PLAN_ADVANCED_PENDING_FIELDS,
  checkPlanEditFieldOwnership,
} from '@/lib/trip-plan-editor';

const plan: TripPlan = {
  id: 'plan-1', tripId: 'trip-1', name: '老城散步', description: '三小時導覽',
  durationMinutes: 180, priceType: 'PER_PERSON', basePrice: 1200, childPrice: 600,
  minParticipants: 2, maxParticipants: 8, bookingType: 'SCHEDULED',
  depositMode: 'DEPOSIT_PERCENT', depositValue: 30, active: true, yearRound: false,
  seasons: [], reviewState: 'NONE', reviewNote: '', sortOrder: 1,
};

describe('trip plan editor view model', () => {
  it('quick edit exposes only the frequent guide-facing fields', () => {
    expect(getQuickPlanFields(plan, {
      childPriceExpanded: false,
      preview: { summary: '老城散步 · 每人 NT$1,200', href: '/trips/trip-1' },
    })).toEqual({
      name: '老城散步',
      description: '三小時導覽',
      basePrice: 1200,
      childPrice: 600,
      active: true,
      preview: { summary: '老城散步 · 每人 NT$1,200', href: '/trips/trip-1' },
    });
    const planWithoutChildPrice = { ...plan, childPrice: null };
    expect(getQuickPlanFields(planWithoutChildPrice, {
      childPriceExpanded: false,
      preview: { summary: '', href: '/trips/trip-1' },
    })).not.toHaveProperty('childPrice');
    expect(getQuickPlanFields(planWithoutChildPrice, {
      childPriceExpanded: true,
      preview: { summary: '', href: '/trips/trip-1' },
    })).toHaveProperty('childPrice', null);
  });

  it('keeps the currently supported advanced fields separate and names pending canonical fields', () => {
    expect(getCurrentAdvancedPlanFields(plan)).toEqual({
      priceType: 'PER_PERSON',
      durationMinutes: 180,
      minParticipants: 2,
      maxParticipants: 8,
      bookingType: 'SCHEDULED',
      depositMode: 'DEPOSIT_PERCENT',
      depositValue: 30,
      yearRound: false,
      seasons: [],
    });
    expect(PLAN_ADVANCED_PENDING_FIELDS).toEqual([
      'groupSalesMode', 'minToDepart', 'formationDeadlineDays',
    ]);
  });

  it('rejects advanced-only fields submitted through quick edit', () => {
    expect(checkPlanEditFieldOwnership('quick', { name: '新名稱', depositMode: 'FULL' }))
      .toEqual({ ok: false, invalidFields: ['depositMode'] });
  });

  it('marks assisted provenance honestly without locking the guide editor', () => {
    expect(getPlanProvenanceView('PLATFORM_ASSISTED')).toEqual({
      badgeKey: 'platformAssisted',
      canEdit: true,
    });
    expect(getPlanProvenanceView('IMPORTED')).toEqual({ badgeKey: 'imported', canEdit: true });
    expect(getPlanProvenanceView('GUIDE')).toEqual({ badgeKey: null, canEdit: true });
  });
});
