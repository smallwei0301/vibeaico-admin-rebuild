/**
 * #46：店家首頁團次徽章的 `linkable` 必須與預約頁候選集合同一規則——
 * 今天已開始者、剩餘名額 < minParty 者都不可連到預約頁。（首頁每個行程只列前 6 個團次，同方案名次 <= 6，
 * 因此 12 個候選上限在首頁不可能觸及；上限由共用的 selectBookingCandidates 在 LINE／預約頁端驗證。）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ deps: [] as Array<Record<string, unknown>>, min: 1 }));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      let single = false;
      const run = async () => {
        if (table === 'tenants') return { data: { id: 'tenant-1', shop_code: 'demo', name: 'Demo', business_type: null, tenant_settings: null }, error: null };
        if (table === 'trips') {
          const row = { id: 'trip-1', slug: 'trip-1', title: 't', summary: '', location: '', cover_image_url: null, duration_hours: 2, refund_policy_type: 'STANDARD' };
          return { data: single ? row : [row], error: null };
        }
        if (table === 'trip_plans') {
          return { data: [{ id: 'pf', trip_id: 'trip-1', sort_order: 0, name: 'pf', description: '', price_per_person: 100, price_type: 'PER_PERSON', min_party: fx.min, max_party: 8, sales_mode: 'FIXED_DEPARTURE' }], error: null };
        }
        if (table === 'trip_departures') return { data: fx.deps, error: null };
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain, in: () => chain, gte: () => chain, order: () => chain, range: () => chain, eq: () => chain,
        maybeSingle: () => { single = true; return run(); },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));

import { loadPublicShop } from '@/server/public-shop';

const dep = (id: string, departsOn: string, startTime: string | null, seatsBooked = 1) => ({
  id, trip_id: 'trip-1', plan_id: 'pf', departs_on: departsOn, start_time: startTime, capacity: 5, seats_booked: seatsBooked,
});

async function linkableById() {
  const shop = await loadPublicShop('demo');
  const out = new Map<string, boolean | undefined>();
  for (const d of shop?.trips[0].departures ?? []) out.set(d.id, d.linkable);
  return out;
}

describe('首頁團次徽章 linkable（與預約頁候選集合一致）', () => {
  // 台北 2098-01-01 10:00
  beforeEach(() => { fx.min = 1; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2098-01-01T02:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('今天已開始的團次不列；之後的團次 linkable', async () => {
    fx.deps = [dep('started', '2098-01-01', '09:00:00'), dep('later', '2098-01-01', '15:00:00')];
    const m = await linkableById();
    expect(m.has('started')).toBe(false);
    expect(m.get('later')).toBe(true);
  });

  it('剩餘名額 < minParty 的團次不 linkable，但仍占候選名次', async () => {
    fx.min = 4;
    fx.deps = [dep('few', '2098-01-02', '09:00:00', 4), dep('enough', '2098-01-03', '09:00:00', 1)];
    const m = await linkableById();
    expect(m.get('few')).toBe(false);
    expect(m.get('enough')).toBe(true);
  });
});
