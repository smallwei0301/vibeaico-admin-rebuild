import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeState = vi.hoisted(() => ({
  planCount: 10,
  failPlanId: null as string | null,
  soldOutRows: 0,
  flood: false,
  customRows: null as null | Array<{ seats_booked: number; capacity: number; departs_on?: string; start_time?: string | null }>,
  lookaheadAvailable: false,
  lookaheadStartedToday: false,
  onlySoldOut: false,
  salesMode: 'FIXED_DEPARTURE',
  gallery: undefined as undefined | string[],
  tripExtra: undefined as undefined | Record<string, unknown>,
  planText: undefined as undefined | { name?: string; description?: string },
  tenantBasic: undefined as undefined | Record<string, unknown>,
  lineId: '@abc',
  seasons: [] as Array<Record<string, unknown>>,
  modeFor: null as null | ((i: number) => string),
  active: 0,
  maxActive: 0,
  calls: [] as Array<{ table: string; filters: Record<string, unknown>; single: boolean }>,
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let single = false;
      let rangeArgs: [number, number] | null = null;
      const run = async () => {
        fakeState.calls.push({ table, filters: { ...filters }, single, ...(rangeArgs ? { range: rangeArgs } : {}) } as never);
        if (table === 'tenants') {
          const id = filters.shop_code === 'demo' ? 'tenant-1' : 'tenant-2';
          return { data: { id, shop_code: filters.shop_code, name: 'Demo', business_type: null, tenant_settings: fakeState.tenantBasic ? { basic: fakeState.tenantBasic, line: { lineBasicId: fakeState.lineId } } : null }, error: null };
        }
        if (table === 'trip_plan_seasons') return { data: fakeState.seasons, error: null };
        if (table === 'trips') {
          const all = [
            { id: 'trip-1', tenant_id: 'tenant-1', slug: 'hike', status: 'PUBLISHED' },
            { id: 'trip-2', tenant_id: 'tenant-1', slug: 'draft', status: 'DRAFT' },
            { id: 'trip-3', tenant_id: 'tenant-2', slug: 'other-shop', status: 'PUBLISHED' },
          ].map((r) => ({ ...r, ...(fakeState.gallery ? { gallery: fakeState.gallery } : {}) })).filter((r) => Object.entries(filters).every(([k, v]) => !(k in r) || (r as Record<string, unknown>)[k] === v))
            .map((r) => ({ ...r, title: 'Hike', summary: '', location: '花蓮', cover_image_url: null, duration_hours: 2, refund_policy_type: 'STANDARD', ...(fakeState.tripExtra ?? {}) }));
          return { data: single ? (all[0] ?? null) : all, error: null };
        }
        if (table === 'trip_plans') {
          const [pFrom, pTo] = rangeArgs ?? [0, Number.MAX_SAFE_INTEGER];
          const all = Array.from({ length: fakeState.planCount }, (_, i) => ({
            id: `plan-${i}`, trip_id: 'trip-1', name: fakeState.planText?.name ?? `P${i}`, description: fakeState.planText?.description ?? '', price_per_person: 100,
            price_type: 'PER_PERSON', min_party: 1, max_party: 4, sales_mode: fakeState.modeFor ? fakeState.modeFor(i) : fakeState.salesMode,
          }));
          return { data: all.slice(pFrom, pTo + 1), error: null };
        }
        if (table === 'trip_departures' && filters.plan_id) {
          fakeState.active += 1;
          fakeState.maxActive = Math.max(fakeState.maxActive, fakeState.active);
          await new Promise((r) => setTimeout(r, 5));
          fakeState.active -= 1;
          const planId = filters.plan_id as string;
          if (fakeState.customRows && rangeArgs) {
            const [from, to] = rangeArgs;
            return {
              data: fakeState.customRows.slice(from, to + 1).map((r, k) => ({
                id: `c-${from + k}`, departs_on: '2098-01-01', start_time: null, ...r,
                min_to_depart_snapshot: 1, formation_deadline_at: null, formation_status: 'COLLECTING',
              })),
              error: null,
            };
          }
          if (fakeState.flood && rangeArgs) {
            const [from, to] = rangeArgs;
            const rows = [];
            const last = from >= 600 ? from + 2 : to;
            for (let i = from; i <= last; i += 1) {
              const sellable = from >= 600 && fakeState.lookaheadAvailable && i === last;
              const started = sellable && fakeState.lookaheadStartedToday;
              rows.push({ id: `flood-${i}`, departs_on: '2098-01-01', start_time: started ? '09:00:00' : null, capacity: 1, seats_booked: sellable ? 0 : 1,
                min_to_depart_snapshot: 1, formation_deadline_at: null, formation_status: 'COLLECTING' });
            }
            return { data: rows, error: null };
          }
          if (planId === fakeState.failPlanId) return { data: null, error: { message: 'boom' } };
          const n = Number(planId.replace('plan-', ''));
          const soldOut = Array.from({ length: fakeState.soldOutRows }, (_, k) => ({
            id: `so-${n}-${k}`, departs_on: '2098-01-0' + (k % 9 + 1), start_time: null, capacity: 2, seats_booked: 2,
            min_to_depart_snapshot: 1, formation_deadline_at: null, formation_status: 'COLLECTING',
          }));
          return {
            data: fakeState.onlySoldOut ? soldOut : [...soldOut, { id: `dep-${n}`, departs_on: '2099-01-01', start_time: '09:00:00', capacity: 5, seats_booked: n % 5,
              min_to_depart_snapshot: 2, formation_deadline_at: '2098-12-30T00:00:00+00:00', formation_status: 'COLLECTING' }],
            error: null,
          };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: () => chain,
        gte: () => chain,
        order: () => chain,
        range: (a: number, b: number) => { rangeArgs = [a, b]; return chain; },
        eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
        maybeSingle: () => { single = true; return run(); },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));

const ROOT = process.cwd();
const loader = readFileSync(resolve(ROOT, 'src/server/public-shop.ts'), 'utf8');
const shopPage = readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/page.tsx'), 'utf8');
const detailPage = readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/trips/[slug]/page.tsx'), 'utf8');
const detailClient = readFileSync(resolve(ROOT, 'src/components/public/PublicTripDetailsClient.tsx'), 'utf8');
const route = readFileSync(
  resolve(ROOT, 'src/app/api/public/shops/[shopCode]/trips/[slug]/route.ts'), 'utf8',
);

describe('#11 公開行程詳情', () => {
  it('從店家頁可到 slug 詳情頁，並由安全頁殼與公開 API 分工載入資料', () => {
    expect(shopPage).toContain('`/s/${shopCode}/trips/${encodeURIComponent(trip.slug)}`');
    expect(detailPage).toContain('<PublicTripDetailsClient');
    expect(detailPage).not.toContain('loadPublicTripDetails');
    expect(detailClient).toContain("fetch(path, { cache: 'no-store', signal })");
    expect(detailClient).toContain('/api/public/shops/');
    expect(route).toContain('loadPublicTripDetails(shopCode, slug)');
    expect(route).not.toMatch(/createAdminSupabase|\.from\(['"]trips['"]\)/);
  });

  it('詳情查詢只讀安全欄位，且同時限制 tenant、trip id、slug 與 PUBLISHED 狀態', () => {
    const columns = loader.match(/const PUBLIC_TRIP_DETAILS_COLUMNS = \[([\s\S]*?)\]\s*as const/);
    const detailQuery = loader.slice(loader.indexOf('async function loadPublicTripDetailsUncached'));
    expect(columns, '找不到公開詳情 select 白名單').toBeTruthy();
    expect(columns?.[1]).toContain('cover_image_url');
    expect(detailQuery).toContain(".select(PUBLIC_TRIP_DETAILS_COLUMNS.join(', '))");
    expect(detailQuery).toContain(".eq('tenant_id', shopData.tenantId)");
    expect(detailQuery).toContain(".eq('slug', slug)");
    expect(detailQuery).toContain(".eq('status', 'PUBLISHED')");
    expect(columns?.[1]).not.toMatch(/midao_listing_note|midao_listing|tenant_settings|customers|staff|tour_orders/);
    expect(detailQuery).toContain(".select('id, departs_on, start_time, capacity, seats_booked, min_to_depart_snapshot, formation_deadline_at, formation_status')");
    expect(detailQuery).toContain(".eq('trip_id', tripId)");
    expect(detailQuery).toContain(".eq('plan_id', plan.id)");
    expect(detailQuery).toContain(".eq('status', 'OPEN')");
    expect(loader).toContain(".eq('plan_id', plan.id)");
    expect(detailQuery).toContain('.range(offset, offset + pageSize - 1)');
    expect(detailQuery).toContain('departuresMayBeTruncated');
    expect(detailClient).toContain('t.departures.truncated');
  });

  it('公開 API 有節流、CORS 與不快取設定，並以 404 隱藏未公開行程', () => {
    expect(route).toContain("from '@/server/public-trip-rate-limit'");
    expect(route).toContain("consumePublicTripRateLimit('api', ip, shopCode)");
    expect(route).toContain('SHOP_CODE_PATTERN.test(shopCode)');
    expect(route).toContain("from '@/server/public-cors'");
    expect(route).toContain('publicCorsHeaders(');
    expect(route).toContain('export function OPTIONS');
    expect(route).toContain("fail(404, '找不到這個行程', ERR.NOT_FOUND)");
    expect(route).toContain('fail(500, \'系統發生錯誤，請稍後再試\', ERR.INTERNAL)');
    expect(route).toContain('withCors(');
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(detailPage).toContain("export const dynamic = 'force-dynamic'");
  });

  it('詳情頁沿用真實 REQUEST／FIXED 入口，INSTANT 只顯示聯絡說明', () => {
    expect(detailClient).toContain("href={`/s/${shopCode}/plans/${plan.id}/request`}");
    expect(detailClient).toContain("href={`/s/${shopCode}/plans/${plan.id}/book`}");
    expect(detailClient).toContain("plan.salesMode === 'INSTANT'");
    expect(detailClient).not.toMatch(/href=\{`\/s\/\$\{shopCode\}\/plans\/\$\{plan\.id\}\/instant/);
    expect(detailClient).toContain('plan.departures');
    expect(detailClient).toContain('trip.meetingPointMapUrl');
    expect(detailClient).toContain('trip.inclusions');
    expect(detailClient).toContain('trip.exclusions');
    expect(detailClient).toContain('trip.notices');
  });

  it('詳情 select 欄位只含 canonical migrations 的 trips 欄位，不含 region／category', () => {
    const body = loader.match(/const PUBLIC_TRIP_DETAILS_COLUMNS = \[([\s\S]*?)\]\s*as const/)?.[1] ?? '';
    const cols = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).not.toContain('region');
    expect(cols).not.toContain('category');

    const dir = resolve(ROOT, 'supabase/migrations');
    const defined = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(resolve(dir, file), 'utf8');
      const create = sql.match(/create table if not exists public\.trips \(([\s\S]*?)\n\);/);
      if (create) {
        for (const line of create[1].split('\n')) {
          const m = line.match(/^\s{2}([a-z_]+)\s+\S/);
          if (m) defined.add(m[1]);
        }
      }
      for (const alter of sql.matchAll(/alter table (?:if exists )?public\.trips\b([\s\S]*?);/gi)) {
        for (const m of alter[1].matchAll(/add column if not exists ([a-z_]+)/gi)) defined.add(m[1]);
      }
    }
    expect([...defined]).toContain('location');
    expect(cols.filter((c) => !defined.has(c)), '公開詳情不得 select 非 canonical 欄位').toEqual([]);
  });
});

describe('#11 公開行程詳情：方案團次查詢併發上限', () => {
  beforeEach(() => {
    fakeState.planCount = 10;
    fakeState.failPlanId = null;
    fakeState.soldOutRows = 0;
    fakeState.flood = false;
    fakeState.customRows = null;
    fakeState.lookaheadAvailable = false;
    fakeState.lookaheadStartedToday = false;
    fakeState.onlySoldOut = false;
    fakeState.salesMode = 'FIXED_DEPARTURE';
    fakeState.modeFor = null;
    fakeState.gallery = undefined;
    fakeState.tripExtra = undefined;
    fakeState.planText = undefined;
    fakeState.tenantBasic = undefined;
    fakeState.lineId = '@abc';
    fakeState.seasons = [];
    fakeState.active = 0;
    fakeState.maxActive = 0;
    fakeState.calls = [];
  });

  it('10 個方案時同時進行的 trip_departures 查詢不超過 3，且結果順序與方案一致', async () => {
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const result = await loadPublicTripDetails('demo', 'hike');
    expect(fakeState.maxActive).toBeGreaterThan(1);
    expect(fakeState.maxActive).toBeLessThanOrEqual(3);
    const plans = result?.trip.plans ?? [];
    expect(plans.map((p) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => `plan-${i}`));
    plans.forEach((plan, i) => {
      expect(plan.departures.map((d) => d.id)).toEqual([`dep-${i}`]);
      expect(plan.departures[0].seatsLeft).toBe(5 - (i % 5));
      expect(plan.departures[0]).toMatchObject({
        minToDepart: 2,
        formationDeadlineAt: '2098-12-30T00:00:00+00:00',
        formationStatus: 'COLLECTING',
      });
    });
  });

  it('任一方案團次查詢失敗時整個請求 reject（fail-closed）', async () => {
    fakeState.failPlanId = 'plan-4';
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    await expect(loadPublicTripDetails('demo', 'hike')).rejects.toThrow('PUBLIC_TRIP_DETAILS');
  });
});

describe('#11 公開行程詳情：以 slug 直查，不讀全店行程清單', () => {
  beforeEach(() => {
    fakeState.planCount = 3;
    fakeState.failPlanId = null;
    fakeState.soldOutRows = 0;
    fakeState.flood = false;
    fakeState.customRows = null;
    fakeState.lookaheadAvailable = false;
    fakeState.lookaheadStartedToday = false;
    fakeState.onlySoldOut = false;
    fakeState.salesMode = 'FIXED_DEPARTURE';
    fakeState.modeFor = null;
    fakeState.gallery = undefined;
    fakeState.active = 0;
    fakeState.maxActive = 0;
    fakeState.calls = [];
  });

  it('trips 只查一次，條件含 tenant、slug、PUBLISHED 並用 maybeSingle；方案綁 tenant+trip+active', async () => {
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const result = await loadPublicTripDetails('demo', 'hike');
    const tripCalls = fakeState.calls.filter((c) => c.table === 'trips');
    expect(tripCalls).toHaveLength(1);
    expect(tripCalls[0]).toMatchObject({
      single: true,
      filters: { tenant_id: 'tenant-1', slug: 'hike', status: 'PUBLISHED' },
    });
    const planCalls = fakeState.calls.filter((c) => c.table === 'trip_plans');
    expect(planCalls).toHaveLength(1);
    expect(planCalls[0].filters).toMatchObject({ tenant_id: 'tenant-1', trip_id: 'trip-1', active: true });
    expect(fakeState.calls.some((c) => c.table === 'services')).toBe(false);
    expect(result?.trip.plans).toHaveLength(3);
  });

  it('客滿團次保留並標示 soldOut、seatsLeft 0；有上限且不占可售名額；輸出不含 seats_booked 推導人數', async () => {
    fakeState.planCount = 1;
    fakeState.soldOutRows = 9;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const result = await loadPublicTripDetails('demo', 'hike');
    const deps = result?.trip.plans[0].departures ?? [];
    const soldOut = deps.filter((d) => d.soldOut);
    expect(soldOut).toHaveLength(6);
    expect(soldOut.every((d) => d.seatsLeft === 0 && d.soldOut === true)).toBe(true);
    expect(deps.filter((d) => !d.soldOut)).toHaveLength(1);
    expect(result?.trip.plans[0].soldOutOmitted).toBe(true);
    expect(result?.trip.plans[0].departuresMayBeTruncated).toBe(false);
    for (const d of deps) expect(d).not.toHaveProperty('currentParticipants');
    expect(JSON.stringify(result)).not.toMatch(/currentParticipants|seatsBooked|seats_booked/);
  });

  it('7 筆以上客滿且 0 筆可售：列 6 筆客滿、soldOutOmitted、不標記可售截斷；有略過客滿不會讓 mayBeTruncated 變 true', async () => {
    fakeState.planCount = 1;
    fakeState.soldOutRows = 9;
    fakeState.onlySoldOut = true;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const plan = (await loadPublicTripDetails('demo', 'hike'))?.trip.plans[0];
    expect(plan?.departures).toHaveLength(6);
    expect(plan?.departures.every((d) => d.soldOut === true)).toBe(true);
    expect(plan?.soldOutOmitted).toBe(true);
    expect(plan?.departuresMayBeTruncated).toBe(false);
  });

  it('M4：每一次 trip_departures 查詢（分頁與 lookahead）都必須帶 status=OPEN、tenant、trip、plan 條件', async () => {
    fakeState.planCount = 1;
    fakeState.flood = true;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    await loadPublicTripDetails('demo', 'hike');
    const queries = fakeState.calls.filter((c) => c.table === 'trip_departures');
    // 600 列 / 每頁 120 = 5 頁，再加 1 次 lookahead。
    expect(queries).toHaveLength(6);
    for (const q of queries) {
      expect(q.filters).toMatchObject({ tenant_id: 'tenant-1', trip_id: 'trip-1', plan_id: 'plan-0', status: 'OPEN' });
    }
    expect(queries.filter((q) => (q as never as { range: number[] }).range[0] >= 600)).toHaveLength(1);
  });

  it('超過掃描上限且 lookahead 全客滿 → truncated=false、soldOutOmitted=true、CTA 隱藏', async () => {
    fakeState.planCount = 1;
    fakeState.flood = true;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const { bookingCtaState } = await import('@/lib/public-trip-client-state');
    const plan = (await loadPublicTripDetails('demo', 'hike'))?.trip.plans[0];
    expect(plan?.departures.every((d) => d.soldOut === true)).toBe(true);
    expect(plan?.departuresMayBeTruncated).toBe(false);
    expect(plan?.soldOutOmitted).toBe(true);
    expect(bookingCtaState(plan!)).toBe('fixed-unavailable');
  });

  it('超過掃描上限且 lookahead 有可售 → truncated=true（只影響提示文案）、CTA 仍隱藏', async () => {
    fakeState.planCount = 1;
    fakeState.flood = true;
    fakeState.lookaheadAvailable = true;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const { bookingCtaState } = await import('@/lib/public-trip-client-state');
    const plan = (await loadPublicTripDetails('demo', 'hike'))?.trip.plans[0];
    expect(plan?.departuresMayBeTruncated).toBe(true);
    // truncated 不開啟 CTA：列出的團次都客滿 → 仍為 unavailable（預約頁看不到 lookahead 那一列）。
    expect(bookingCtaState(plan!)).toBe('fixed-unavailable');
  });

  describe.each([
    ['剛好 6 筆可售（頁面讀完）', Array.from({ length: 6 }, () => ({ seats_booked: 0, capacity: 5 })), false, false],
    ['7 筆可售 → 還有未列出', Array.from({ length: 7 }, () => ({ seats_booked: 0, capacity: 5 })), true, false],
    ['6 筆可售＋後面全客滿 → 沒有更多可售，只標 soldOutOmitted', [
      ...Array.from({ length: 6 }, () => ({ seats_booked: 0, capacity: 5 })),
      ...Array.from({ length: 3 }, () => ({ seats_booked: 5, capacity: 5 })),
    ], false, true],
    ['第一頁（120 列）滿，6 筆可售後全客滿，lookahead 頁有可售 → truncated（客滿列也被略過故 soldOutOmitted）', [
      ...Array.from({ length: 6 }, () => ({ seats_booked: 0, capacity: 5 })),
      ...Array.from({ length: 114 }, () => ({ seats_booked: 5, capacity: 5 })),
      ...Array.from({ length: 10 }, () => ({ seats_booked: 5, capacity: 5 })),
      { seats_booked: 0, capacity: 5 },
    ], true, true],
  ])('截斷旗標：%s', (_label, rows, truncated, soldOutOmitted) => {
    it('departuresMayBeTruncated／soldOutOmitted', async () => {
      fakeState.planCount = 1;
      fakeState.customRows = rows;
      const { loadPublicTripDetails } = await import('@/server/public-shop');
      const plan = (await loadPublicTripDetails('demo', 'hike'))?.trip.plans[0];
      expect(plan?.departures.filter((d) => !d.soldOut)).toHaveLength(6);
      expect(plan?.departuresMayBeTruncated).toBe(truncated);
      expect(Boolean(plan?.soldOutOmitted)).toBe(soldOutOmitted);
    });
  });

  it('方案查詢只讀 MAX+1（61）筆、帶 tenant／trip／active 與穩定排序；61 個方案只輸出 60 個且 plansMayBeTruncated=true（寫英文固定 warn）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fakeState.planCount = 250;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const result = await loadPublicTripDetails('demo', 'hike');
    expect(result?.trip.plans).toHaveLength(60);
    expect(result?.trip.plansMayBeTruncated).toBe(true);
    expect(result?.trip.plans[59].id).toBe('plan-59');
    expect(warn).toHaveBeenCalledWith('public trip details: plan output limit reached');
    const planCalls = fakeState.calls.filter((c) => c.table === 'trip_plans');
    expect(planCalls).toHaveLength(1);
    expect(planCalls[0].filters).toMatchObject({ tenant_id: 'tenant-1', trip_id: 'trip-1', active: true });
    expect((planCalls[0] as never as { range: number[] }).range).toEqual([0, 60]);
    warn.mockRestore();
  });

  it('剛好 60 個方案 → 不帶 plansMayBeTruncated、不 warn；61 個 → 帶旗標', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    fakeState.planCount = 60;
    const exact = await loadPublicTripDetails('demo', 'hike');
    expect(exact?.trip.plans).toHaveLength(60);
    expect(exact?.trip).not.toHaveProperty('plansMayBeTruncated');
    expect(warn).not.toHaveBeenCalled();
    fakeState.planCount = 61;
    const over = await loadPublicTripDetails('demo', 'hike');
    expect(over?.trip.plans).toHaveLength(60);
    expect(over?.trip.plansMayBeTruncated).toBe(true);
    warn.mockRestore();
  }, 30_000);

  it('方案 name 截到 300、description 截到 2000（含 emoji 不破碎）', async () => {
    fakeState.planCount = 1;
    fakeState.planText = { name: '😀'.repeat(500), description: 'd'.repeat(5000) };
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const plan = (await loadPublicTripDetails('demo', 'hike'))!.trip.plans[0];
    expect(plan.name).toBe('😀'.repeat(300));
    expect(Array.from(plan.description)).toHaveLength(2000);
  });

  it.each([
    ['tenantName', 'name', 300],
    ['tenantDescription', 'description', 2000],
    ['tenantAddress', 'address', 300],
  ])('店家層級欄位 %s → shop.%s 在詳情輸出截到 %i 字', async (basicKey, field, max) => {
    fakeState.planCount = 1;
    fakeState.tenantBasic = { [basicKey]: 'x'.repeat(9000) };
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const shop = (await loadPublicTripDetails('demo', 'hike'))!.shop as unknown as Record<string, string>;
    expect(Array.from(shop[field])).toHaveLength(max);
    expect(shop.lineBasicId).toBe('@abc');
  });

  it('C15：lookahead 讀到的可售列全是今天已開始的團次 → truncated=false（lookahead 也要過濾）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2098-01-01T02:00:00Z')); // 台北 10:00
    try {
      fakeState.planCount = 1;
      fakeState.flood = true;
      fakeState.lookaheadAvailable = true;
      fakeState.lookaheadStartedToday = true;
      const { loadPublicTripDetails } = await import('@/server/public-shop');
      const plan = (await loadPublicTripDetails('demo', 'hike'))?.trip.plans[0];
      expect(plan?.departuresMayBeTruncated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('方案數上限：31 個方案只有前 30 個查團次，第 31 個帶 departuresNotLoaded 且 CTA 不開；總查詢數受限', async () => {
    fakeState.planCount = 31;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const { bookingCtaState } = await import('@/lib/public-trip-client-state');
    const result = await loadPublicTripDetails('demo', 'hike');
    const plans = result?.trip.plans ?? [];
    expect(plans).toHaveLength(31);
    expect(plans.slice(0, 30).every((p) => !p.departuresNotLoaded && p.departures.length === 1)).toBe(true);
    expect(plans[30].departuresNotLoaded).toBe(true);
    expect(plans[30].departures).toEqual([]);
    expect(bookingCtaState(plans[30])).toBe('dates-not-loaded');
    const depCalls = fakeState.calls.filter((c) => c.table === 'trip_departures' && c.filters.plan_id);
    expect(depCalls.map((c) => c.filters.plan_id)).not.toContain('plan-30');
    expect(depCalls.length).toBe(30);
    // 最壞情況總查詢數：30 × (5 頁 + 1 lookahead) ＝ 180。
    expect(depCalls.length).toBeLessThanOrEqual(30 * 6);
  });

  it('INSTANT 不進團次查詢集合：不查、departures 為 []、不標 departuresNotLoaded、不占 30 個額度；第 31 個 FIXED 才是 notLoaded', async () => {
    fakeState.planCount = 36; // 前 5 個 INSTANT，其後 31 個 FIXED
    fakeState.modeFor = (i) => (i < 5 ? 'INSTANT' : 'FIXED_DEPARTURE');
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const plans = (await loadPublicTripDetails('demo', 'hike'))?.trip.plans ?? [];
    expect(plans).toHaveLength(36);
    // fake 對任何 plan_id 都回傳 OPEN 團次，所以 INSTANT 的 departures 為空代表「沒有查」。
    for (const p of plans.slice(0, 5)) {
      expect(p.salesMode).toBe('INSTANT');
      expect(p.departures).toEqual([]);
      expect(p).not.toHaveProperty('departuresNotLoaded');
    }
    expect(plans.slice(5, 35).every((p) => p.departures.length === 1 && !p.departuresNotLoaded)).toBe(true);
    expect(plans[35].departuresNotLoaded).toBe(true);
    const queried = fakeState.calls
      .filter((c) => c.table === 'trip_departures' && c.filters.plan_id)
      .map((c) => c.filters.plan_id as string);
    expect(queried).toHaveLength(30);
    for (let i = 0; i < 5; i += 1) expect(queried).not.toContain(`plan-${i}`);
    expect(queried).not.toContain('plan-35');
  });

  it('圖庫：20 張合法加 5 張非法 → 輸出恰為上限（8），順序不變、非法被濾掉', async () => {
    const legal = Array.from({ length: 20 }, (_, i) => `https://img.example.com/g${i}.jpg`);
    const mixed: string[] = [];
    legal.forEach((u, i) => { mixed.push(u); if (i % 4 === 0) mixed.push(`javascript:bad${i}`); });
    expect(mixed.filter((u) => u.startsWith('javascript')).length).toBe(5);
    fakeState.planCount = 1;
    fakeState.gallery = mixed;
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const { MAX_PUBLIC_GALLERY_IMAGES } = await import('@/lib/trip-gallery');
    const result = await loadPublicTripDetails('demo', 'hike');
    expect(MAX_PUBLIC_GALLERY_IMAGES).toBe(8);
    expect(result?.trip.galleryUrls).toEqual(legal.slice(0, 8));
  });

  describe('公開文字欄位與陣列上限', () => {
    const load = async (extra: Record<string, unknown>) => {
      fakeState.planCount = 1;
      fakeState.tripExtra = extra;
      const { loadPublicTripDetails } = await import('@/server/public-shop');
      return (await loadPublicTripDetails('demo', 'hike'))!.trip;
    };

    it('超長文字截到各欄位上限（description 5000、tagline／summary／safetyNotice 2000、單行欄位 300）', async () => {
      const trip = await load({
        description: 'd'.repeat(9000), tagline: 't'.repeat(9000), summary: 's'.repeat(9000), notes: 'n'.repeat(9000),
        title: 'x'.repeat(900), location: 'l'.repeat(900), meeting_point: 'm'.repeat(900),
      });
      expect(Array.from(trip.description)).toHaveLength(5000);
      expect(Array.from(trip.tagline)).toHaveLength(2000);
      expect(Array.from(trip.summary)).toHaveLength(2000);
      expect(Array.from(trip.safetyNotice)).toHaveLength(2000);
      expect(Array.from(trip.title)).toHaveLength(300);
      expect(Array.from(trip.location)).toHaveLength(300);
      expect(Array.from(trip.meetingPoint)).toHaveLength(300);
    });

    it('陣列最多 20 項、每項最多 300 字；inclusions（多行字串）同樣處理，順序不變', async () => {
      const many = Array.from({ length: 25 }, (_, i) => `item-${i}-` + 'z'.repeat(500));
      const trip = await load({ exclusions: many, notices: many, includes: many.join('\n') });
      for (const list of [trip.exclusions, trip.notices, trip.inclusions]) {
        expect(list).toHaveLength(20);
        expect(list.every((x) => Array.from(x).length === 300)).toBe(true);
        expect(list[0].startsWith('item-0-')).toBe(true);
        expect(list[19].startsWith('item-19-')).toBe(true);
      }
    });

    it('含 emoji 時以字元截斷，不產生破碎字元（無孤立 surrogate）', async () => {
      const trip = await load({ description: '😀'.repeat(6000), exclusions: ['👍'.repeat(400)] });
      expect(Array.from(trip.description)).toHaveLength(5000);
      expect(trip.description).toBe('😀'.repeat(5000));
      expect(trip.exclusions[0]).toBe('👍'.repeat(300));
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(trip.description)).toBe(false);
    });

    it('未超限的內容原樣輸出', async () => {
      const trip = await load({ description: '正常說明', exclusions: ['a', 'b'] });
      expect(trip.description).toBe('正常說明');
      expect(trip.exclusions).toEqual(['a', 'b']);
    });
  });

  describe('店家時區（basic.timezone）', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2098-01-02T02:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });
    const row = (departs_on: string, start_time: string | null) => ({ departs_on, start_time, seats_booked: 0, capacity: 5 });
    const run = async (timezone: unknown) => {
      fakeState.planCount = 1;
      fakeState.tenantBasic = timezone === undefined ? {} : { timezone };
      fakeState.customRows = [
        row('2098-01-01', '17:00:00'),
        row('2098-01-01', '19:00:00'),
        row('2098-01-02', '09:00:00'),
        row('2098-01-02', '11:00:00'),
      ];
      const { loadPublicTripDetails } = await import('@/server/public-shop');
      const result = await loadPublicTripDetails('demo', 'hike');
      return { ids: result!.trip.plans[0].departures.map((d) => d.id), timeZone: result!.timeZone };
    };

    it('America/Los_Angeles（LA 為 1/1 18:00，台北已是 1/2 10:00）：LA 今天已過的排除，LA 明天的（台北今天 09:00）保留', async () => {
      const r = await run('America/Los_Angeles');
      expect(r.timeZone).toBe('America/Los_Angeles');
      expect(r.ids).toEqual(['c-1', 'c-2', 'c-3']);
    });

    it('正規化為 canonical 名稱；偏移寫法回退台北（T1）', async () => {
      const { resolvePublicTimeZone } = await import('@/lib/public-time-zone');
      expect(resolvePublicTimeZone('asia/taipei')).toBe('Asia/Taipei');
      expect(resolvePublicTimeZone(' America/Los_Angeles ')).toBe('America/Los_Angeles');
      expect(resolvePublicTimeZone('+08:00')).toBe('Asia/Taipei');
    });

    it('Q2：半夜 00:00 輸出 "00:00"，不是 "24:00"', async () => {
      const { tenantNowParts } = await import('@/lib/public-time-zone');
      // UTC 2098-01-01 16:00 ＝ 台北 2098-01-02 00:00
      expect(tenantNowParts('Asia/Taipei', Date.parse('2098-01-01T16:00:00Z'))).toEqual({ today: '2098-01-02', hm: '00:00' });
    });

    it('Q4：超過 64 字元一律回退（即使 Intl 接受）', async () => {
      const { resolvePublicTimeZone } = await import('@/lib/public-time-zone');
      const original = Intl.DateTimeFormat;
      const long = 'Z'.repeat(80);
      const stub = function (this: unknown, _l: unknown, o: { timeZone: string }) {
        return { format: () => '', resolvedOptions: () => ({ timeZone: o.timeZone }) };
      } as unknown as typeof Intl.DateTimeFormat;
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = stub;
      try {
        expect(resolvePublicTimeZone(long)).toBe('Asia/Taipei');
        expect(resolvePublicTimeZone('Z'.repeat(64))).toBe('Z'.repeat(64));
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = original;
      }
    });

    it.each([undefined, 'Mars/Phobos', 42, 'x'.repeat(80)])('時區 %j 缺值或無效 → 回退台北（台北 1/2 10:00）', async (tz) => {
      const r = await run(tz);
      expect(r.timeZone).toBe('Asia/Taipei');
      // 台北今天 1/2：09:00 已過排除；11:00 保留；1/1 的日期是過去，但查詢以 gte 過濾（fake 不過濾），所以只確認台北規則。
      expect(r.ids).toContain('c-3');
      expect(r.ids).not.toContain('c-2');
    });
  });

  describe('店家欄位格式（C1）', () => {
    const shopWith = async (basic: Record<string, unknown>) => {
      fakeState.planCount = 1;
      fakeState.tenantBasic = basic;
      const { loadPublicTripDetails } = await import('@/server/public-shop');
      return (await loadPublicTripDetails('demo', 'hike'))!.shop;
    };

    it('email：超過 254 或格式不合 → 空字串；合法則保留', async () => {
      expect((await shopWith({ tenantEmail: 'a'.repeat(250) + '@b.co' })).email).toBe('');
      expect((await shopWith({ tenantEmail: 'not-an-email' })).email).toBe('');
      expect((await shopWith({ tenantEmail: 'shop@example.com' })).email).toBe('shop@example.com');
    });

    it('phone（T3）：顯示字串保留原樣、phoneHref 只留數字與 +；含分機或過長 → phoneHref 為空字串', async () => {
      const a = await shopWith({ tenantPhone: '03-123-4567' });
      expect(a.phone).toBe('03-123-4567');
      expect(a.phoneHref).toBe('031234567');
      const b = await shopWith({ tenantPhone: '02-1234-5678#12' });
      expect(b.phone).toBe('02-1234-5678#12');
      expect(b.phoneHref).toBe('');
      for (const withExt of ['02-1234-5678 ext. 12', '02-1234-5678 轉 12', '02-1234-5678 分機12', '02-1234 x12']) {
        expect((await shopWith({ tenantPhone: withExt })).phoneHref, withExt).toBe('');
      }
      expect((await shopWith({ tenantPhone: '+886 2 1234 5678' })).phoneHref).toBe('+88621234 5678'.replace(' ', ''));
      expect((await shopWith({ tenantPhone: '1'.repeat(21) })).phoneHref).toBe('');
      const long = await shopWith({ tenantPhone: '9'.repeat(100) });
      expect(Array.from(long.phone)).toHaveLength(40);
      expect(long.phoneHref).toBe('');
      const text = await shopWith({ tenantPhone: 'call me' });
      expect(text.phone).toBe('call me');
      expect(text.phoneHref).toBe('');
      expect((await shopWith({ tenantPhone: '   ' })).phone).toBe('');
    });

    it('lineBasicId（C2）：超過 64 或含非 [A-Za-z0-9@._-] 字元 → 空字串', async () => {
      expect((await shopWith({})).lineBasicId).toBe('@abc');
      for (const bad of ['@' + 'a'.repeat(64), 'bad id', 'ab/cd', '龜山島']) {
        fakeState.lineId = bad;
        expect((await shopWith({})).lineBasicId, bad).toBe('');
      }
      fakeState.lineId = '@shop.id_1-2';
      expect((await shopWith({})).lineBasicId).toBe('@shop.id_1-2');
    });

    it('client 對空字串不顯示對應按鈕', () => {
      const actions = readFileSync(resolve(ROOT, 'src/components/public/PublicContactActions.tsx'), 'utf8');
      expect(actions).toContain("phone.kind === 'link'");
      expect(actions).toContain("phone.kind === 'text'");
      expect(actions).toContain('if (shop.email) {');
      expect(actions).toContain('if (shop.lineBasicId) {');
    });
  });

  it('URL（C2）：超過 2048 字元的 cover／gallery／地圖連結被丟棄，合法者保留', async () => {
    const long = 'https://example.com/' + 'a'.repeat(2100);
    const ok = 'https://example.com/ok.jpg';
    fakeState.planCount = 1;
    fakeState.tripExtra = { cover_image_url: long, gallery: [long, ok], meeting_point_map_url: long };
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const trip = (await loadPublicTripDetails('demo', 'hike'))!.trip;
    expect(trip.coverImageUrl).toBe('');
    expect(trip.galleryUrls).toEqual([ok]);
    expect(trip.meetingPointMapUrl).toBe('');
  });

  describe('季節單價（0132 規則）', () => {
    const season = (over: Record<string, unknown>) => ({
      id: 's-a', plan_id: 'plan-0', start_month: 7, start_day: 1, end_month: 8, end_day: 31, price_override: 3000, sort_order: 0, ...over,
    });
    const loadSeason = async (rows: Array<Record<string, unknown>>, departs: string[]) => {
      fakeState.planCount = 1;
      fakeState.seasons = rows;
      fakeState.customRows = departs.map((d) => ({ departs_on: d, start_time: '09:00:00', seats_booked: 0, capacity: 5 }));
      const { loadPublicTripDetails } = await import('@/server/public-shop');
      return (await loadPublicTripDetails('demo', 'hike'))!.trip.plans[0];
    };

    it('命中季節的團次輸出 unitPrice，未命中用基本價 100；方案標 seasonalPricing', async () => {
      const plan = await loadSeason([season({})], ['2098-07-15', '2098-09-15']);
      expect(plan.seasonalPricing).toBe(true);
      expect(plan.departures.map((d) => d.unitPrice)).toEqual([3000, 100]);
    });

    it('沒有啟用季節的方案：不輸出 unitPrice、不標 seasonalPricing', async () => {
      const plan = await loadSeason([], ['2098-07-15']);
      expect(plan).not.toHaveProperty('seasonalPricing');
      expect(plan.departures[0]).not.toHaveProperty('unitPrice');
    });

    it('季節查詢綁 tenant、plan in、active；達 1000 列視為不完整 → 不輸出 unitPrice 但標 seasonalPricing', async () => {
      const rows = Array.from({ length: 1000 }, (_, i) => season({ id: `s-${i}`, price_override: 1 }));
      const plan = await loadSeason(rows, ['2098-07-15']);
      expect(plan.seasonalPricing).toBe(true);
      expect(plan.departures[0]).not.toHaveProperty('unitPrice');
      const call = fakeState.calls.find((c) => c.table === 'trip_plan_seasons')!;
      expect(call.filters).toMatchObject({ tenant_id: 'tenant-1', active: true });
    });
  });

  it('M1：成團欄位只在 FIXED_DEPARTURE 輸出；REQUEST／INSTANT 不帶', async () => {
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    for (const mode of ['REQUEST', 'INSTANT', 'FIXED_DEPARTURE']) {
      fakeState.planCount = 1;
      fakeState.salesMode = mode;
      const result = await loadPublicTripDetails('demo', 'hike');
      const dep = result?.trip.plans[0].departures[0] ?? {};
      for (const key of ['minToDepart', 'formationDeadlineAt', 'formationStatus']) {
        expect(key in dep, `${mode} ${key}`).toBe(mode === 'FIXED_DEPARTURE');
      }
    }
  });

  it('region 為空字串，location 照常回傳', async () => {
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    const result = await loadPublicTripDetails('demo', 'hike');
    expect(result?.trip.region).toBe('');
    expect(result?.trip.location).toBe('花蓮');
  });

  it.each([
    ['demo', 'draft'],
    ['demo', 'other-shop'],
    ['other', 'hike'],
    ['demo', 'missing'],
  ])('shop=%s slug=%s 回 null（DRAFT／他店／不存在）', async (shop, slug) => {
    const { loadPublicTripDetails } = await import('@/server/public-shop');
    expect(await loadPublicTripDetails(shop, slug)).toBeNull();
  });
});
