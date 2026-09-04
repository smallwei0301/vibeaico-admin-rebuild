import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { swapPlanOrder } from '@/lib/trip-plan-quick-edit';
import type { TripPlan } from '@/lib/types';

function makePlan(id: string, sortOrder: number): TripPlan {
  return {
    id,
    tripId: 'trip-1',
    name: `方案 ${id}`,
    description: '',
    durationMinutes: 60,
    priceType: 'PER_PERSON',
    basePrice: 1000,
    childPrice: null,
    minParticipants: 1,
    maxParticipants: 10,
    bookingType: 'SCHEDULED',
    depositMode: 'FULL',
    depositValue: 0,
    active: true,
    yearRound: true,
    seasons: [],
    reviewState: 'NONE',
    reviewNote: '',
    sortOrder,
  };
}

describe('#42 plan display-order persistence', () => {
  it('swaps the sortOrder of two adjacent plans, keeping every other plan untouched', () => {
    const plans = [makePlan('p1', 0), makePlan('p2', 1), makePlan('p3', 2)];
    const moved = swapPlanOrder(plans, 0, 1);
    expect(moved.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
    expect(moved.find((p) => p.id === 'p1')?.sortOrder).toBe(1);
    expect(moved.find((p) => p.id === 'p2')?.sortOrder).toBe(0);
    expect(moved.find((p) => p.id === 'p3')?.sortOrder).toBe(2);
  });

  it('moving the last plan down (or the first plan up) is a no-op that returns the same array', () => {
    const plans = [makePlan('p1', 0), makePlan('p2', 1)];
    expect(swapPlanOrder(plans, 1, 1)).toBe(plans);
    expect(swapPlanOrder(plans, 0, -1)).toBe(plans);
  });

  it('the plan list is rendered in sortOrder — the real /api/trips/[id]/plans route orders by sort_order', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/trips/[id]/plans/route.ts'),
      'utf8',
    );
    expect(route).toContain("order('sort_order', { ascending: true })");
  });

  it('the trip detail page persists the swap through the existing per-plan PUT endpoint', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/tenant/trips/[id]/page.tsx'),
      'utf8',
    );
    expect(source).toContain('swapPlanOrder');
    expect(source).toContain('movePlan');
    expect(source).toContain('saveTripPlan(tripId, { id: reordered[index].id, sortOrder: reordered[index].sortOrder })');
    expect(source).toContain('saveTripPlan(tripId, { id: reordered[target].id, sortOrder: reordered[target].sortOrder })');
    expect(source).toContain('t.plans.labels.moveUp');
    expect(source).toContain('t.plans.labels.moveDown');
  });
});
