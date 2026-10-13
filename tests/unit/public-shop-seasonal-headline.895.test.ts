/**
 * #895：店家公開首頁的季節定價方案不得以基本價當售價，也不得把基本價納入「NT$X 起」。
 * loader 與詳情頁同一個 helper（hasSeasonalPricing）；季節查詢失敗視為季節定價（不確定）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  seasonPlans: [] as string[],
  seasonFail: false,
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const inFilters: Record<string, unknown[]> = {};
      let single = false;
      let cols = '';
      const run = async () => {
        if (table === 'tenants') return { data: { id: 'tenant-1', shop_code: 'demo', name: 'Demo', business_type: null, tenant_settings: null }, error: null };
        if (table === 'trips') {
          const rows = [{ id: 'trip-1', slug: 'trip-1', title: 't', summary: '', location: '', cover_image_url: null, duration_hours: 2, refund_policy_type: 'STANDARD', status: 'PUBLISHED', tenant_id: 'tenant-1' }];
          return { data: single ? rows[0] : rows, error: null };
        }
        if (table === 'trip_plans') {
          return { data: ['plain', 'seasonal', 'instant'].map((id, i) => ({
            id, trip_id: 'trip-1', sort_order: i, name: id, description: '', price_per_person: 1000, price_type: 'PER_PERSON',
            min_party: 1, max_party: 8, sales_mode: id === 'instant' ? 'INSTANT' : 'FIXED_DEPARTURE',
          })), error: null };
        }
        if (table === 'trip_plan_seasons') {
          if (fx.seasonFail) return { data: null, error: { message: 'boom' } };
          return { data: fx.seasonPlans.filter((id) => (inFilters.plan_id ?? []).includes(id)).map((plan_id, i) => ({
            id: `s${i}`, plan_id, start_month: 1, start_day: 1, end_month: 12, end_day: 31, price_override: 2000, sort_order: 0,
          })), error: null };
        }
        void cols;
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: (c?: string) => { cols = c ?? ''; return chain; },
        in: (k: string, v: unknown[]) => { inFilters[k] = v; return chain; },
        gte: () => chain, order: () => chain, range: () => chain, eq: () => chain,
        maybeSingle: () => { single = true; return run(); },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));

import { loadPublicShop } from '@/server/public-shop';

const page = readFileSync(resolve(__dirname, '../../src/app/s/[shopCode]/page.tsx'), 'utf8');
const i18n = readFileSync(resolve(__dirname, '../../src/i18n/zh-TW/pages/public-shop.ts'), 'utf8');

describe('#895 loadPublicShop seasonalPricing', () => {
  beforeEach(() => { fx.seasonPlans = []; fx.seasonFail = false; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('有季節的方案（含 INSTANT）標 seasonalPricing，沒有季節的不標', async () => {
    fx.seasonPlans = ['seasonal', 'instant'];
    const plans = Object.fromEntries((await loadPublicShop('demo'))!.trips[0].plans.map((p) => [p.id, p.seasonalPricing]));
    expect(plans).toEqual({ plain: undefined, seasonal: true, instant: true });
  });

  it('季節查詢失敗（未知）→ 全部視為季節定價，不把基本價當確定售價', async () => {
    fx.seasonFail = true;
    const plans = (await loadPublicShop('demo'))!.trips[0].plans;
    expect(plans.every((p) => p.seasonalPricing === true)).toBe(true);
  });
});

describe('#895 首頁 render 分支', () => {
  it('季節方案顯示季節標題而非基本價；最低價排除季節方案', () => {
    expect(page).toContain("plan.bookingCta === 'fixed' || plan.bookingCta === 'request' ? t.trips.seasonalByDepartureHeadline : t.trips.seasonalHeadline");
    expect(page).toContain('formatCurrency(plan.pricePerPerson)');
    expect(page).toContain('trip.plans.filter((p) => !p.seasonalPricing)');
    expect(i18n).toContain('seasonalHeadline:');
    expect(i18n).toContain('seasonalByDepartureHeadline:');
  });
});
