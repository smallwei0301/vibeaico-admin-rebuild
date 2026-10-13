/**
 * #46「團次直達預約」：
 *  1. 預約頁 `?departure=<id>`：只預選 plan.departures 內的 id，未知 id 靜默忽略。
 *  2. 店家首頁團次徽章：只有 bookingCta === 'fixed' 的方案才是直達預約連結。
 *  3. LINE「近期團次」回覆：只有啟用中的 FIXED_DEPARTURE 方案才附深連結。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

const fx = vi.hoisted(() => ({
  bookingPlan: null as unknown,
  shop: null as unknown,
  lineReplies: [] as Array<{ text: string }[]>,
}));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/server/public-tour-booking', () => ({ loadPublicBookingPlan: async () => fx.bookingPlan }));
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
    const dep = (id: string, seatsBooked: number) => ({ id, planId: 'pf', departsOn: '2098-01-01', startTime: '09:00', capacity: 5, seatsBooked });
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
    const dep = (id: string, planId: string) => ({ id, planId, departsOn: '2098-01-01', startTime: '09:00', capacity: 10, seatsBooked: 1 });
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

describe('LINE「近期團次」深連結', () => {
  it('只有啟用中的 FIXED_DEPARTURE 方案附深連結', async () => {
    fx.lineReplies.length = 0;
    const today = new Date().toISOString().slice(0, 10);
    const deps = [
      { id: 'dep/1', trip_id: 'tr', plan_id: 'pf', departs_on: today, start_time: '09:00:00', capacity: 5, seats_booked: 1 },
      { id: 'dep-2', trip_id: 'tr', plan_id: 'pi', departs_on: today, start_time: null, capacity: 5, seats_booked: 1 },
      { id: 'dep-3', trip_id: 'tr', plan_id: 'pr', departs_on: today, start_time: null, capacity: 5, seats_booked: 1 },
      { id: 'dep-4', trip_id: 'tr', plan_id: 'pq', departs_on: today, start_time: null, capacity: 5, seats_booked: 1 },
    ];
    const plans = [
      { id: 'pf', name: '固定', sales_mode: 'FIXED_DEPARTURE', active: true },
      { id: 'pi', name: '停用', sales_mode: 'FIXED_DEPARTURE', active: false },
      { id: 'pr', name: '申請', sales_mode: 'REQUEST', active: true },
      { id: 'pq', name: '即時', sales_mode: 'INSTANT', active: true },
    ];
    // 通用 chain：任何 filter 方法回自己，await 時回該表資料
    const chain = (data: unknown) => {
      const c: any = { then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res) };
      for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) c[m] = () => c;
      return c;
    };
    const admin = {
      from: (t: string) => chain(t === 'trips' ? [{ id: 'tr', title: '行程' }] : t === 'trip_departures' ? deps : plans),
    };
    const ok = await replyDepartures({
      admin, token: 'k', replyToken: 'r', userId: 'u', lineConfig: {},
      tenant: { id: 'ten', shop_code: 'demo', name: 'D', business_type: 'GUIDE' },
    } as any);
    expect(ok).toBe(true);
    const text = fx.lineReplies[0][0].text;
    const base = `${APP_URL.replace(/\/$/, '')}/s/demo`;
    expect(text).toContain(`${base}/plans/pf/book?departure=dep%2F1`);
    expect(text.match(/\/book\?departure=/g)?.length).toBe(1);
    // 結尾仍保留店家首頁網址
    expect(text.trimEnd().endsWith(base)).toBe(true);
    // 深連結緊接在對應團次行的下一行
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.includes('固定'));
    expect(lines[i + 1]).toBe(`${base}/plans/pf/book?departure=dep%2F1`);
    expect(lines[i + 2]).toContain('停用');
  });

  it('額滿的 FIXED_DEPARTURE 團次不附深連結，仍有餘位者才附', async () => {
    fx.lineReplies.length = 0;
    const today = new Date().toISOString().slice(0, 10);
    const deps = [
      { id: 'dep-open', trip_id: 'tr', plan_id: 'pf', departs_on: today, start_time: null, capacity: 5, seats_booked: 1 },
      { id: 'dep-full', trip_id: 'tr', plan_id: 'pf', departs_on: today, start_time: null, capacity: 5, seats_booked: 5 },
      { id: 'dep-over', trip_id: 'tr', plan_id: 'pf', departs_on: today, start_time: null, capacity: 5, seats_booked: 6 },
    ];
    const plans = [{ id: 'pf', name: '固定', sales_mode: 'FIXED_DEPARTURE', active: true }];
    const chain = (data: unknown) => {
      const c: any = { then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res) };
      for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) c[m] = () => c;
      return c;
    };
    const admin = {
      from: (t: string) => chain(t === 'trips' ? [{ id: 'tr', title: '行程' }] : t === 'trip_departures' ? deps : plans),
    };
    const ok = await replyDepartures({
      admin, token: 'k', replyToken: 'r', userId: 'u', lineConfig: {},
      tenant: { id: 'ten', shop_code: 'demo', name: 'D', business_type: 'GUIDE' },
    } as any);
    expect(ok).toBe(true);
    const text = fx.lineReplies[0][0].text;
    expect(text).toContain('departure=dep-open');
    expect(text).not.toContain('dep-full');
    expect(text).not.toContain('dep-over');
    expect(text.match(/\/book\?departure=/g)?.length).toBe(1);
  });

  it('方案 min_party=4：剩 4 位的團次附連結，剩 1 位的不附', async () => {
    fx.lineReplies.length = 0;
    const today = new Date().toISOString().slice(0, 10);
    const deps = [
      { id: 'dep-four', trip_id: 'tr', plan_id: 'pf', departs_on: today, start_time: null, capacity: 5, seats_booked: 1 },
      { id: 'dep-one', trip_id: 'tr', plan_id: 'pf', departs_on: today, start_time: null, capacity: 5, seats_booked: 4 },
    ];
    const plans = [{ id: 'pf', name: '固定', sales_mode: 'FIXED_DEPARTURE', active: true, min_party: 4 }];
    const chain = (data: unknown) => {
      const c: any = { then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res) };
      for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) c[m] = () => c;
      return c;
    };
    const admin = {
      from: (t: string) => chain(t === 'trips' ? [{ id: 'tr', title: '行程' }] : t === 'trip_departures' ? deps : plans),
    };
    const ok = await replyDepartures({
      admin, token: 'k', replyToken: 'r', userId: 'u', lineConfig: {},
      tenant: { id: 'ten', shop_code: 'demo', name: 'D', business_type: 'GUIDE' },
    } as any);
    expect(ok).toBe(true);
    const text = fx.lineReplies[0][0].text;
    expect(text).toContain('departure=dep-four');
    expect(text).not.toContain('dep-one');
    expect(text.match(/\/book\?departure=/g)?.length).toBe(1);
  });
});
