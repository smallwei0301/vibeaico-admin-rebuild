/**
 * #46「團次直達預約」：
 *  1. 預約頁 `?departure=<id>`：只預選 plan.departures 內的 id，未知 id 靜默忽略。
 *  2. 店家首頁團次徽章：只有 bookingCta === 'fixed' 的方案才是直達預約連結。
 *  3. LINE「近期團次」回覆：連結資格＝預約頁自己的 loadPublicBookingPlan + isDepartureBookableOnPage（單一來源），
 *     載入器回 null／丟錯、季節價未知、名額不足、不在候選內的團次都不附連結。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const fx = vi.hoisted(() => ({
  bookingPlan: null as unknown,
  bookingPlansById: {} as Record<string, unknown>,
  shop: null as unknown,
  lineReplies: [] as Array<{ text: string }[]>,
}));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/server/public-tour-booking', async (importActual) => ({
  ...(await importActual<typeof import('@/server/public-tour-booking')>()),
  loadPublicBookingPlan: async (_shop: string, planId: string) => (planId in fx.bookingPlansById ? fx.bookingPlansById[planId] : fx.bookingPlan),
}));
vi.mock('@/app/s/[shopCode]/plans/[planId]/book/BookingForm', () => ({ BookingForm: () => null }));
vi.mock('@/server/public-shop', () => ({ loadPublicShop: async () => fx.shop }));
vi.mock('@/server/promotion-events', () => ({ recordPromotionPageView: async () => undefined }));
vi.mock('@/components/public/PublicContactActions', () => ({ PublicContactActions: () => null }));
vi.mock('@/server/features', () => ({ isFeatureActive: async () => true }));
vi.mock('@/server/line', () => ({
  lineReply: async (_t: string, _r: string, msgs: Array<{ text: string }>) => { fx.lineReplies.push(msgs); },
  lineProfile: async () => null,
}));

import BookPage from '@/app/s/[shopCode]/plans/[planId]/book/page';
import ShopPage from '@/app/s/[shopCode]/page';
import { replyDepartures } from '@/server/line-events';
import { APP_URL } from '@/config/env';
import { isDepartureBookableOnPage } from '@/lib/public-booking-price';

const bookingPlan = (ids: string[]) => ({
  tenantId: 't', shopName: 's', tripId: 'trip', tripTitle: 'T', planId: 'p1', planName: 'P',
  planDescription: '', pricePerPerson: 100, priceType: 'PER_PERSON', minParty: 1, maxParty: 4,
  refundPolicyType: 'STANDARD',
  departures: ids.map((id) => ({ id, departsOn: '2098-01-01', startTime: '09:00', seatsLeft: 5 })),
});

function formProps(el: ReactElement) {
  const form = (el.props as { children: ReactElement }).children;
  return form.props as { initialDepartureId: string };
}

async function renderBook(departure?: string | string[]) {
  const el = (await BookPage({
    params: Promise.resolve({ shopCode: 'demo', planId: 'p1' }),
    searchParams: Promise.resolve({ departure }),
  })) as ReactElement;
  return formProps(el).initialDepartureId;
}

describe('預約頁 ?departure= 預選', () => {
  beforeEach(() => { fx.bookingPlan = bookingPlan(['d1', 'd2']); });
  it('合法團次 id → 預選', async () => {
    expect(await renderBook('d2')).toBe('d2');
  });
  it('未知 id 或未帶參數 → 空（靜默忽略）', async () => {
    expect(await renderBook('nope')).toBe('');
    expect(await renderBook(undefined)).toBe('');
  });
  it('陣列參數取第一個並同樣驗證', async () => {
    expect(await renderBook(['d1', 'x'])).toBe('d1');
    expect(await renderBook(['x', 'd1'])).toBe('');
  });
});

describe('預約頁預選：單一團次須達方案最低人數', () => {
  it('seatsLeft < minParty 的團次不預選', async () => {
    fx.bookingPlan = {
      ...bookingPlan([]), minParty: 4,
      departures: [
        { id: 'few', departsOn: '2098-01-01', startTime: '09:00', seatsLeft: 1 },
        { id: 'enough', departsOn: '2098-01-02', startTime: '09:00', seatsLeft: 4 },
      ],
    };
    expect(await renderBook('few')).toBe('');
    expect(await renderBook('enough')).toBe('enough');
  });
});

describe('店家首頁團次徽章', () => {
  it('方案 minParty=4：剩 4 位的團次有連結、剩 1 位的沒有；可及名稱含日期時間名額', async () => {
    const dep = (id: string, seatsBooked: number) => ({ id, planId: 'pf', departsOn: '2098-01-01', startTime: '09:00', capacity: 5, seatsBooked, linkable: seatsBooked <= 1 });
    fx.shop = {
      tenantId: 't', services: [],
      shop: { name: 'Demo', description: '', phone: '', email: '', address: '', lineBasicId: '', businessType: 'GUIDE' },
      trips: [{
        id: 'trip', slug: 'trip', title: 'T', summary: '', location: '', coverImageUrl: '', durationHours: 2,
        refundPolicyType: 'STANDARD',
        plans: [{ id: 'pf', name: 'pf', description: '', pricePerPerson: 100, priceType: 'PER_PERSON', minParty: 4, maxParty: 5, salesMode: 'FIXED_DEPARTURE', bookingCta: 'fixed' }],
        departures: [dep('d-four', 1), dep('d-one', 4)],
      }],
    };
    const el = (await ShopPage({
      params: Promise.resolve({ shopCode: 'demo' }),
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    const html = renderToStaticMarkup(el);
    expect(html).toContain('departure=d-four');
    expect(html).not.toContain('departure=d-one');
    // 不以 aria-label 覆蓋可見文字：連結名稱 = sr-only 前綴 + 可見的時間與剩餘名額
    expect(html).not.toMatch(/<a[^>]*aria-label/);
    expect(html).toMatch(/<a[^>]*><span class="sr-only">預約 <\/span>[^<]*09:00 · 剩 4 位<\/a>/);
  });

  it('只有 bookingCta=fixed 的方案團次是連到預約頁的連結', async () => {
    const plan = (id: string, bookingCta: string, salesMode: string) => ({
      id, name: id, description: '', pricePerPerson: 100, priceType: 'PER_PERSON', minParty: 1, maxParty: 4, salesMode, bookingCta,
    });
    const dep = (id: string, planId: string) => ({ id, planId, departsOn: '2098-01-01', startTime: '09:00', capacity: 10, seatsBooked: 1, linkable: true });
    fx.shop = {
      tenantId: 't', services: [],
      shop: { name: 'Demo', description: '', phone: '', email: '', address: '', lineBasicId: '', businessType: 'GUIDE' },
      trips: [{
        id: 'trip', slug: 'trip', title: 'T', summary: '', location: '', coverImageUrl: '', durationHours: 2,
        refundPolicyType: 'STANDARD',
        plans: [plan('pf', 'fixed', 'FIXED_DEPARTURE'), plan('pr', 'request', 'REQUEST'), plan('pu', 'fixed-unavailable', 'FIXED_DEPARTURE')],
        departures: [dep('d fixed', 'pf'), dep('d-req', 'pr'), dep('d-un', 'pu'), dep('d-none', '')],
      }],
    };
    const el = (await ShopPage({
      params: Promise.resolve({ shopCode: 'demo' }),
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    const html = renderToStaticMarkup(el);
    expect(html).toContain('href="/s/demo/plans/pf/book?departure=d%20fixed"');
    expect(html).not.toContain('departure=d-req');
    expect(html).not.toContain('departure=d-un');
    expect(html).not.toContain('departure=d-none');
    // 其他團次仍以純徽章顯示
    expect((html.match(/\/book\?departure=/g) ?? []).length).toBe(1);
    expect(html.match(/badge badge-primary/g)?.length).toBe(4);
  });
});

describe('isDepartureBookableOnPage（預約頁預選／送出資格的單一判斷）', () => {
  const plan = (over: Record<string, unknown> = {}, deps?: unknown[]) => ({
    minParty: 2, departures: deps ?? [
      { id: 'ok', seatsLeft: 2, unitPrice: 100 },
      { id: 'few', seatsLeft: 1, unitPrice: 100 },
      { id: 'noprice', seatsLeft: 5 },
    ], ...over,
  }) as Parameters<typeof isDepartureBookableOnPage>[0];
  it('名額達最低人數且價格可確定 → true', () => {
    expect(isDepartureBookableOnPage(plan(), 'ok')).toBe(true);
  });
  it('不在 plan.departures、空值、名額不足 → false', () => {
    expect(isDepartureBookableOnPage(plan(), 'nope')).toBe(false);
    expect(isDepartureBookableOnPage(plan(), '')).toBe(false);
    expect(isDepartureBookableOnPage(plan(), undefined)).toBe(false);
    expect(isDepartureBookableOnPage(plan(), 'few')).toBe(false);
  });
  it('有季節定價但團次無 unitPrice → false；無季節定價則以基本價可訂', () => {
    expect(isDepartureBookableOnPage(plan({ seasonalPricing: true }), 'noprice')).toBe(false);
    expect(isDepartureBookableOnPage(plan({ seasonalPricing: true }), 'ok')).toBe(true);
    expect(isDepartureBookableOnPage(plan(), 'noprice')).toBe(true);
  });
});

describe('預約頁預選：季節價未知的團次不預選', () => {
  it('seasonalPricing 且團次無 unitPrice → 空', async () => {
    fx.bookingPlansById = {};
    fx.bookingPlan = {
      ...bookingPlan([]), seasonalPricing: true,
      departures: [
        { id: 'unknown', departsOn: '2098-01-01', startTime: '09:00', seatsLeft: 5 },
        { id: 'priced', departsOn: '2098-01-02', startTime: '09:00', seatsLeft: 5, unitPrice: 120 },
      ],
    };
    expect(await renderBook('unknown')).toBe('');
    expect(await renderBook('priced')).toBe('priced');
  });
});

describe('LINE「近期團次」深連結（連結資格＝預約頁載入器 + 共用判斷）', () => {
  afterEach(() => { fx.bookingPlansById = {}; });
  const dep = (id: string, planId: string, seatsBooked = 1) => ({
    id, trip_id: 'tr', plan_id: planId, departs_on: '2098-01-01', start_time: null, capacity: 5, seats_booked: seatsBooked,
  });
  /**
   * 模擬 PostgREST：trip_departures 有兩種查詢——
   *  A（帶 trip_plans!inner 內嵌）：只回有方案的團次，內嵌方案；若有 .eq('trip_plans.active', true) 則先濾掉停用方案，再取 limit。
   *  B（.is('plan_id', null)）：只回無方案團次。
   * planError 表示方案內嵌查詢（A）失敗；depError 表示無方案查詢（B）失敗。
   */
  const lineAdmin = (deps: any[], plans: any[], opts: { planError?: unknown; depError?: unknown; settingsError?: unknown; settingsThrow?: boolean; log?: Array<{ eq: Array<[string, unknown]>; neq: Array<[string, unknown]>; noPlan: boolean; limit?: number }> } = {}) => {
    const settings = () => {
      const c: any = { select: () => c, eq: () => c };
      c.maybeSingle = () => {
        if (opts.settingsThrow) return Promise.reject(new Error('settings boom'));
        return Promise.resolve({ data: null, error: opts.settingsError ?? null });
      };
      return c;
    };
    const departures = () => {
      const q = { eq: [] as Array<[string, unknown]>, neq: [] as Array<[string, unknown]>, noPlan: false, limit: undefined as number | undefined };
      opts.log?.push(q);
      const c: any = {};
      c.then = (res: (v: unknown) => unknown) => {
        if (q.noPlan) {
          const data = deps.filter((d) => d.plan_id == null).slice(0, q.limit ?? 1000);
          return Promise.resolve({ data, error: opts.depError ?? null }).then(res);
        }
        const activeOnly = q.eq.some(([k, v]) => k === 'trip_plans.active' && v === true);
        const data = deps
          .filter((d) => d.plan_id != null)
          .map((d) => ({ ...d, trip_plans: plans.find((p) => p.id === d.plan_id) ?? null }))
          .filter((d) => d.trip_plans && (!activeOnly || d.trip_plans.active === true))
          .filter((d) => q.neq.every(([k, v]) => k !== 'trip_plans.sales_mode' || d.trip_plans.sales_mode !== v))
          .slice(0, q.limit ?? 1000);
        return Promise.resolve({ data, error: opts.planError ?? null }).then(res);
      };
      for (const m of ['select', 'in', 'gte', 'lte', 'neq', 'order', 'range']) c[m] = () => c;
      c.eq = (k: string, v: unknown) => { q.eq.push([k, v]); return c; };
      c.neq = (k: string, v: unknown) => { q.neq.push([k, v]); return c; };
      c.is = (k: string, v: unknown) => { if (k === 'plan_id' && v === null) q.noPlan = true; return c; };
      c.limit = (n: number) => { q.limit = n; return c; };
      return c;
    };
    const trips = () => {
      const c: any = { select: () => c, eq: () => c, order: () => c, limit: () => c, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'tr', title: '行程' }], error: null }).then(res) };
      return c;
    };
    return { from: (t: string) => t === 'tenant_settings' ? settings() : t === 'trips' ? trips() : departures() };
  };
  const runLine = async (deps: unknown[], plans: unknown[]) => {
    fx.lineReplies.length = 0;
    const ok = await replyDepartures({
      admin: lineAdmin(deps, plans), token: 'k', replyToken: 'r', userId: 'u', lineConfig: {},
      tenant: { id: 'ten', shop_code: 'demo', name: 'D', business_type: 'GUIDE' },
    } as any);
    expect(ok).toBe(true);
    return fx.lineReplies[0][0].text;
  };
  const fixedPlans = [{ id: 'pf', name: '固定', sales_mode: 'FIXED_DEPARTURE', active: true }];
  const bp = (ids: Array<string | Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
    ...bookingPlan([]), minParty: 1,
    departures: ids.map((x) => typeof x === 'string'
      ? { id: x, departsOn: '2098-01-01', startTime: '', seatsLeft: 4 } : { departsOn: '2098-01-01', startTime: '', seatsLeft: 4, ...x }),
    ...over,
  });

  const baseCtx = (admin: unknown) => ({
    admin, token: 'k', replyToken: 'r', userId: 'u', lineConfig: {},
    tenant: { id: 'ten', shop_code: 'demo', name: 'D', business_type: 'GUIDE' },
  }) as any;

  it('方案內嵌查詢失敗 → 回 false 且不送出「沒有團次」回覆', async () => {
    fx.lineReplies.length = 0;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = await replyDepartures(baseCtx(lineAdmin([dep('d1', 'pf')], fixedPlans, { planError: { message: 'boom' } })));
    spy.mockRestore();
    expect(ok).toBe(false);
    expect(fx.lineReplies).toHaveLength(0);
  });

  it('replyDepartures 不查 plan_id 為 null 的團次（公開頁不列，避免佔掉 limit）', async () => {
    fx.bookingPlansById = { pf: bp(['d1']) };
    const log: Array<{ eq: Array<[string, unknown]>; neq: Array<[string, unknown]>; noPlan: boolean; limit?: number }> = [];
    fx.lineReplies.length = 0;
    const ok = await replyDepartures(baseCtx(lineAdmin([dep('d1', 'pf')], fixedPlans, { log, depError: { message: 'boom' } })));
    expect(ok).toBe(true);
    expect(log.some((q) => q.noPlan)).toBe(false);
  });

  it('tenant_settings 回 error → 回 false 且不送出回覆（不假設 Asia/Taipei）', async () => {
    fx.lineReplies.length = 0;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = await replyDepartures(baseCtx(lineAdmin([dep('d1', 'pf')], fixedPlans, { settingsError: { message: 'boom' } })));
    expect(ok).toBe(false);
    expect(fx.lineReplies).toHaveLength(0);
    const thrown = await replyDepartures(baseCtx(lineAdmin([dep('d1', 'pf')], fixedPlans, { settingsThrow: true })));
    spy.mockRestore();
    expect(thrown).toBe(false);
    expect(fx.lineReplies).toHaveLength(0);
  });

  it('tenant_settings 查詢成功但無設定 → 回退預設時區並正常列出', async () => {
    fx.bookingPlansById = { pf: bp(['d1']) };
    expect(await runLine([dep('d1', 'pf')], fixedPlans)).toContain('固定');
  });

  it('前 10 筆團次都屬停用方案 → 查詢 A 帶 trip_plans.active=true 於 limit 前過濾，仍列出啟用團次', async () => {
    fx.bookingPlansById = { pf: bp(['dep-live']) };
    const plans = [...fixedPlans, { id: 'pi', name: '停用', sales_mode: 'FIXED_DEPARTURE', active: false }];
    const stale = Array.from({ length: 10 }, (_, i) => dep(`dep-off-${i}`, 'pi'));
    const log: Array<{ eq: Array<[string, unknown]>; neq: Array<[string, unknown]>; noPlan: boolean; limit?: number }> = [];
    fx.lineReplies.length = 0;
    const ok = await replyDepartures(baseCtx(lineAdmin([...stale, dep('dep-live', 'pf')], plans, { log })));
    expect(ok).toBe(true);
    const text = fx.lineReplies[0][0].text;
    const queryA = log.find((q) => !q.noPlan)!;
    expect(queryA.eq).toContainEqual(['trip_plans.active', true]);
    expect(queryA.limit).toBe(10);
    expect(queryA.neq).toContainEqual(['trip_plans.sales_mode', 'INSTANT']);
    expect(log.some((q) => q.noPlan)).toBe(false);
    expect(text).toContain('固定');
    expect(text).toContain('departure=dep-live');
    expect(text).not.toContain('dep-off');
  });

  it('有方案團次依日期（再時間）排序並截到 10 筆；無方案團次不查、不佔名額', async () => {
    fx.bookingPlansById = {};
    const mk = (id: string, planId: string | null, day: string, time: string | null = null) => ({
      id, trip_id: 'tr', plan_id: planId, departs_on: day, start_time: time, capacity: 5, seats_booked: 1,
    });
    const deps = [
      mk('late-time', 'pf', '2098-01-10', '15:00:00'),
      ...Array.from({ length: 12 }, (_, i) => mk(`p${i}`, 'pf', `2098-01-${String(10 + i).padStart(2, '0')}`)),
      ...Array.from({ length: 8 }, (_, i) => mk(`n${i}`, null, `2098-01-${String(1 + i).padStart(2, '0')}`)),
    ];
    fx.lineReplies.length = 0;
    const ok = await replyDepartures(baseCtx(lineAdmin(deps, fixedPlans)));
    expect(ok).toBe(true);
    const text = fx.lineReplies[0][0].text;
    const days = text.split('\n').filter((l) => l.startsWith('・')).map((l) => l.slice(1, 11));
    expect(days).toHaveLength(10);
    expect(days).toEqual([...days].sort());
    expect(days[0]).toBe('2098-01-10');
    // 同日：無時間（空字串）排在有時間者之前
    expect(text.indexOf('2098-01-10 15:00')).toBeGreaterThan(text.indexOf('2098-01-10 行程'));
  });

  it('方案內嵌為陣列時同樣可解析名稱', async () => {
    fx.bookingPlansById = { pf: bp(['d1']) };
    const base = lineAdmin([dep('d1', 'pf')], fixedPlans);
    const wrapped = { from: (t: string) => {
      const c = base.from(t);
      if (t !== 'trip_departures') return c;
      const origThen = c.then;
      c.then = (res: (v: any) => unknown) => origThen((r: any) => res({ ...r, data: r.data.map((d: any) => ({ ...d, trip_plans: d.trip_plans ? [d.trip_plans] : d.trip_plans })) }));
      return c;
    } };
    fx.lineReplies.length = 0;
    expect(await replyDepartures(baseCtx(wrapped))).toBe(true);
    expect(fx.lineReplies[0][0].text).toContain('固定');
  });

  it('只有啟用中的 FIXED_DEPARTURE 方案附深連結，連結緊接在對應團次行下方', async () => {
    fx.bookingPlansById = { pf: bp(['dep/1']), pi: bp(['dep-2']), pr: bp(['dep-3']), pq: bp(['dep-4']) };
    const plans = [
      { id: 'pf', name: '固定', sales_mode: 'FIXED_DEPARTURE', active: true },
      { id: 'pi', name: '停用', sales_mode: 'FIXED_DEPARTURE', active: false },
      { id: 'pr', name: '申請', sales_mode: 'REQUEST', active: true },
      { id: 'pq', name: '即時', sales_mode: 'INSTANT', active: true },
    ];
    const text = await runLine([dep('dep/1', 'pf'), dep('dep-2', 'pi'), dep('dep-3', 'pr'), dep('dep-4', 'pq')], plans);
    const base = `${APP_URL.replace(/\/$/, '')}/s/demo`;
    expect(text).toContain(`${base}/plans/pf/book?departure=dep%2F1`);
    expect(text.match(/\/book\?departure=/g)?.length).toBe(1);
    expect(text.trimEnd().endsWith(base)).toBe(true);
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.includes('固定'));
    expect(lines[i + 1]).toBe(`${base}/plans/pf/book?departure=dep%2F1`);
    // #1022：已停用方案的團次不再列出（旅客點進公開頁找不到該方案）。
    expect(text).not.toContain('停用');
    expect(lines[i + 2]).toContain('申請');
  });

  it('預約頁載入的方案不含該團次（額滿／已開始／超出前 12 個候選）→ 不附連結，清單仍列出', async () => {
    fx.bookingPlansById = { pf: bp(['dep-open']) };
    const text = await runLine([dep('dep-open', 'pf'), dep('dep-full', 'pf', 5), dep('dep-late', 'pf')], fixedPlans);
    expect(text).toContain('departure=dep-open');
    expect(text).not.toContain('departure=dep-full');
    expect(text).not.toContain('departure=dep-late');
    expect(text).toContain('固定');
  });

  it('方案 minParty=4：預約頁剩 4 位者附連結，剩 1 位者不附', async () => {
    fx.bookingPlansById = { pf: bp([{ id: 'dep-four', seatsLeft: 4 }, { id: 'dep-one', seatsLeft: 1 }], { minParty: 4 }) };
    const text = await runLine([dep('dep-four', 'pf'), dep('dep-one', 'pf', 4)], fixedPlans);
    expect(text).toContain('departure=dep-four');
    expect(text).not.toContain('departure=dep-one');
  });

  it('季節價未知（seasonalPricing 但團次無 unitPrice）→ 不附連結；有 unitPrice 才附', async () => {
    fx.bookingPlansById = { pf: bp([{ id: 'dep-unknown' }, { id: 'dep-priced', unitPrice: 120 }], { seasonalPricing: true }) };
    const text = await runLine([dep('dep-unknown', 'pf'), dep('dep-priced', 'pf')], fixedPlans);
    expect(text).not.toContain('departure=dep-unknown');
    expect(text).toContain('departure=dep-priced');
  });

  it('一般方案（無季節定價）→ 附連結', async () => {
    fx.bookingPlansById = { pf: bp(['dep-a']) };
    expect(await runLine([dep('dep-a', 'pf')], fixedPlans)).toContain('departure=dep-a');
  });

  it('載入器回 null → 該方案不附連結（fail closed），團次清單仍顯示', async () => {
    fx.bookingPlansById = { pf: null };
    const text = await runLine([dep('dep-a', 'pf')], fixedPlans);
    expect(text).not.toContain('/book?departure=');
    expect(text).toContain('固定');
  });

  it('載入器丟錯 → 該方案不附連結，其他方案不受影響', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fx.bookingPlansById = { pf: new Proxy({}, { get() { throw new Error('boom'); } }), pg: bp(['dep-g']) };
    const plans = [...fixedPlans, { id: 'pg', name: '另一', sales_mode: 'FIXED_DEPARTURE', active: true }];
    const text = await runLine([dep('dep-a', 'pf'), dep('dep-g', 'pg')], plans);
    expect(text).not.toContain('departure=dep-a');
    expect(text).toContain('departure=dep-g');
    err.mockRestore();
  });
});
