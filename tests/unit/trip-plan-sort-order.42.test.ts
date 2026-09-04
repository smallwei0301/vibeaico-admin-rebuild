import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reorderPlans } from '@/lib/trip-plan-quick-edit';
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
  it('moves a plan and normalizes every plan\'s sortOrder to its array position', () => {
    const plans = [makePlan('p1', 0), makePlan('p2', 1), makePlan('p3', 2)];
    const { plans: moved, updates } = reorderPlans(plans, 0, 1);
    expect(moved.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
    expect(moved.find((p) => p.id === 'p1')?.sortOrder).toBe(1);
    expect(moved.find((p) => p.id === 'p2')?.sortOrder).toBe(0);
    expect(moved.find((p) => p.id === 'p3')?.sortOrder).toBe(2);
    // p3 did not move and was already at the correct position — no redundant PUT.
    expect(updates).toEqual(expect.arrayContaining([
      { id: 'p1', sortOrder: 1 },
      { id: 'p2', sortOrder: 0 },
    ]));
    expect(updates.find((u) => u.id === 'p3')).toBeUndefined();
    expect(updates).toHaveLength(2);
  });

  it(
    'REGRESSION (Sol audit): reproduces the canonical TEST seed tie — every plan '
    + 'shares sort_order 0 (scripts/test/seed.mjs never sets it) — and proves the '
    + 'persisted update actually differentiates the two moved plans, not 0/0',
    () => {
      const plans = [makePlan('a', 0), makePlan('b', 0), makePlan('c', 0)];
      const { plans: moved, updates } = reorderPlans(plans, 0, 1);

      // At least one real PUT must be persisted — a pure swap of two equal
      // values (0 <-> 0) would produce zero updates and silently do nothing
      // while still claiming success. That is the exact bug being fixed.
      expect(updates.length).toBeGreaterThan(0);

      // Whether or not every moved plan needed its own PUT (a plan that
      // lands back on its already-correct value needs none), the resulting,
      // fully-normalized sortOrder values must be genuinely different for
      // the two plans the user just reordered — not both still 0.
      const aFinal = moved.find((p) => p.id === 'a')!.sortOrder;
      const bFinal = moved.find((p) => p.id === 'b')!.sortOrder;
      expect(aFinal).not.toBe(bFinal);

      // Every persisted update must match what the in-memory list now says,
      // so a fresh GET after these PUTs reproduces the same order (no drift
      // between what was written and what is rendered).
      for (const u of updates) {
        expect(moved.find((p) => p.id === u.id)?.sortOrder).toBe(u.sortOrder);
      }

      // Sorting the resulting plans by their (now persisted) sortOrder must
      // equal what the user actually sees after the move: b, a, c.
      const bySortOrder = [...moved].sort((x, y) => x.sortOrder - y.sortOrder).map((p) => p.id);
      expect(bySortOrder).toEqual(['b', 'a', 'c']);
      expect(moved.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    },
  );

  it('is idempotent: reordering an already-normalized list produces the expected new updates only', () => {
    const plans = [makePlan('p1', 0), makePlan('p2', 1), makePlan('p3', 2)];
    const first = reorderPlans(plans, 0, 1);
    expect(first.updates).toHaveLength(2);
    // Re-running the same move on the already-moved (now normalized) list
    // swaps back and again yields exactly the two changed rows — never a
    // stale/duplicate update for an untouched plan.
    const second = reorderPlans(first.plans, 0, 1);
    expect(second.updates).toHaveLength(2);
    expect(second.plans.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('moving the last plan down (or the first plan up) is a no-op: same array reference, no updates', () => {
    const plans = [makePlan('p1', 0), makePlan('p2', 1)];
    const down = reorderPlans(plans, 1, 1);
    expect(down.plans).toBe(plans);
    expect(down.updates).toEqual([]);
    const up = reorderPlans(plans, 0, -1);
    expect(up.plans).toBe(plans);
    expect(up.updates).toEqual([]);
  });

  it('the plan list is rendered in sortOrder — the real /api/trips/[id]/plans route orders by sort_order', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/trips/[id]/plans/route.ts'),
      'utf8',
    );
    expect(route).toContain("order('sort_order', { ascending: true })");
  });

  it('the trip detail page persists moves via reorderPlans and skips the no-op toast', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/tenant/trips/[id]/page.tsx'),
      'utf8',
    );
    expect(source).toContain('reorderPlans');
    expect(source).toContain('movePlan');
    expect(source).toContain('if (updates.length === 0) return;');
    expect(source).toContain('updates.map((u) => saveTripPlan(tripId, { id: u.id, sortOrder: u.sortOrder }))');
    expect(source).toContain('t.plans.labels.moveUp');
    expect(source).toContain('t.plans.labels.moveDown');
  });
});
