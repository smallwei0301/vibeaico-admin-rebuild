/**
 * #1090：公開商店頁建單的來源通路。
 * 預設 VIBEAI_SHOP；只有 channel === 'LINE'（網址 ?src=line 帶出）才記 LINE；
 * 旅客不能指定 MANUAL／MIDAO，非法值回退 VIBEAI_SHOP（不回 400）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolvePublicOrderSource, withLineSource, isLineSourceSearch,
} from '@/lib/public-order-channel';
import { buildTripCarousel } from '@/server/trip-flex';
import { submitPublicTourRequestSchema } from '@/server/public-tour-request';
import { submitPublicTourBookingSchema } from '@/server/public-tour-booking';

const base = {
  shopCode: 'shop', planId: '11111111-1111-4111-8111-111111111111',
  departureId: '22222222-2222-4222-8222-222222222222', partySize: 2,
  contactName: '旅客', contactPhone: '0912345678',
};

describe('resolvePublicOrderSource', () => {
  it('預設（未帶 channel）記 VIBEAI_SHOP', () => {
    expect(resolvePublicOrderSource(undefined)).toBe('VIBEAI_SHOP');
    expect(resolvePublicOrderSource('SHOP')).toBe('VIBEAI_SHOP');
  });
  it('channel=LINE 記 LINE', () => {
    expect(resolvePublicOrderSource('LINE')).toBe('LINE');
  });
  it('非法來源（含 MANUAL／MIDAO／大小寫變體／非字串）一律回退 VIBEAI_SHOP', () => {
    for (const v of ['MANUAL', 'MIDAO', 'VIBEAI_SHOP', 'line', 'x', '', null, 1, {}]) {
      expect(resolvePublicOrderSource(v)).toBe('VIBEAI_SHOP');
    }
  });
});

describe('schema 只新增選填 channel', () => {
  it('申請與預約 schema 不帶 channel 仍通過；帶非法字串不被拒（由伺服器回退）', () => {
    for (const schema of [submitPublicTourRequestSchema, submitPublicTourBookingSchema]) {
      expect(schema.safeParse(base).success).toBe(true);
      const withLine = schema.parse({ ...base, channel: 'LINE' });
      expect(resolvePublicOrderSource(withLine.channel)).toBe('LINE');
      const bad = schema.parse({ ...base, channel: 'MANUAL' });
      expect(resolvePublicOrderSource(bad.channel)).toBe('VIBEAI_SHOP');
    }
  });
});

describe('LINE 連結帶 src=line', () => {
  it('withLineSource 處理有／無查詢字串，且不重複', () => {
    expect(withLineSource('https://x.test/s/shop')).toBe('https://x.test/s/shop?src=line');
    expect(withLineSource('https://x.test/s/shop/plans/p/book?departure=d')).toBe('https://x.test/s/shop/plans/p/book?departure=d&src=line');
    expect(withLineSource('https://x.test/s/shop?src=line')).toBe('https://x.test/s/shop?src=line');
  });
  it('isLineSourceSearch 只認 src=line', () => {
    expect(isLineSourceSearch('?src=line')).toBe(true);
    expect(isLineSourceSearch('?src=LINE')).toBe(true);
    expect(isLineSourceSearch('?src=manual')).toBe(false);
    expect(isLineSourceSearch('')).toBe(false);
  });
  it('isLineSourceSearch 也認圖文選單的 utm_source=line，其他值不算', () => {
    expect(isLineSourceSearch('?utm_source=line')).toBe(true);
    expect(isLineSourceSearch('?utm_source=LINE')).toBe(true);
    expect(isLineSourceSearch('?utm_source=other')).toBe(false);
    expect(isLineSourceSearch('?utm_medium=line')).toBe(false);
    expect(isLineSourceSearch('?foo=line')).toBe(false);
  });
  it('line-events 產生的公開連結皆經 withLineSource', () => {
    const src = readFileSync('src/server/line-events.ts', 'utf8');
    expect(src).toContain('withLineSource(buildShopUrl(appUrl, shopCode))');
    expect(src).toContain('withLineSource(`${buildShopUrl(APP_URL, ctx.tenant.shop_code)}/plans/');
    // 不得再有未經包裝直接使用原始 helper 的呼叫
    // wrapper、行程輪播的乾淨 base、團次直達連結 = 3 處；其餘一律走 wrapper
    expect(src.match(/buildShopUrl\(/g)?.length).toBe(3);
    // 輪播 shopUrl 必須是乾淨 base（不可帶 query，否則 /trip/{slug} 會接在 ?src=line 後面）
    expect(src).toContain('const shopUrl = buildShopUrl(APP_URL, ctx.tenant.shop_code);');
  });
  it('公開建單 server 不再寫死 p_source: LINE', () => {
    for (const f of ['src/server/public-tour-request.ts', 'src/server/public-tour-booking.ts']) {
      const s = readFileSync(f, 'utf8');
      expect(s).not.toMatch(/p_source:\s*'LINE'/);
      expect(s).toContain('p_source: resolvePublicOrderSource(input.channel)');
    }
  });
});

describe('withLineSource：query／hash 與連結結構', () => {
  it('已有 query 用 &、hash 保留在最後、已有 src 不重複', () => {
    expect(withLineSource('https://x.test/a?b=1#h')).toBe('https://x.test/a?b=1&src=line#h');
    expect(withLineSource('https://x.test/a#h')).toBe('https://x.test/a?src=line#h');
    expect(withLineSource('https://x.test/a?src=qr#h')).toBe('https://x.test/a?src=qr#h');
    expect(withLineSource('https://x.test/a?')).toBe('https://x.test/a?src=line');
  });
  it('輪播行程連結：路徑在前、src=line 在後，可被 URL 解析', () => {
    const labels = { altText: 'a', priceFrom: 'p', priceUnknown: 'u', bookCta: 'b' };
    const card = { slug: '龜山島 一日遊', title: 't', tagline: '', summary: '', coverImageUrl: '', minPrice: 1 };
    for (const shopUrl of ['https://x.test/s/shop', 'https://x.test/s/shop/']) {
      const flex: any = buildTripCarousel([card], shopUrl, labels);
      const uri = flex.contents.contents[0].footer.contents[0].action.uri as string;
      expect(uri).toBe(`https://x.test/s/shop/trip/${encodeURIComponent('龜山島 一日遊')}?src=line`);
      const u = new URL(uri);
      expect(u.pathname).toBe(`/s/shop/trip/${encodeURIComponent('龜山島 一日遊')}`);
      expect(u.searchParams.get('src')).toBe('line');
    }
  });
  it('團次直達與店家頁連結結構正確', () => {
    const deep = withLineSource('https://x.test/s/shop/plans/p1/book?departure=d1');
    const u = new URL(deep);
    expect(u.pathname).toBe('/s/shop/plans/p1/book');
    expect(u.searchParams.get('departure')).toBe('d1');
    expect(u.searchParams.get('src')).toBe('line');
    const shop = new URL(withLineSource('https://x.test/s/shop'));
    expect(shop.pathname).toBe('/s/shop');
    expect(shop.search).toBe('?src=line');
  });
});

describe('channel 非法值不擋預約（回退 VIBEAI_SHOP）', () => {
  it('超長或非字串 channel 不回 400，source 回退 VIBEAI_SHOP', () => {
    for (const schema of [submitPublicTourRequestSchema, submitPublicTourBookingSchema]) {
      for (const channel of ['x'.repeat(100), 123, { a: 1 }, ['LINE'], null]) {
        const r = schema.safeParse({ ...base, channel });
        expect(r.success).toBe(true);
        if (r.success) expect(resolvePublicOrderSource(r.data.channel)).toBe('VIBEAI_SHOP');
      }
      const ok = schema.parse({ ...base, channel: 'LINE' });
      expect(resolvePublicOrderSource(ok.channel)).toBe('LINE');
    }
  });
});

describe('/trip/[slug] 轉址保留 LINE 來源', () => {
  it('src=line 與 utm_source=line 都保留（正規化為 src=line），其他值不保留', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock('next/navigation', () => ({
      notFound: () => { throw new Error('notFound'); },
      permanentRedirect: (u: string) => { calls.push(u); },
    }));
    const { default: Page } = await import('@/app/s/[shopCode]/trip/[slug]/page');
    const run = (sp: Record<string, string | string[] | undefined>) =>
      Page({ params: Promise.resolve({ shopCode: 'shop', slug: 'abc' }), searchParams: Promise.resolve(sp) });
    await run({ src: 'line' });
    await run({ utm_source: 'line' });
    await run({ utm_source: ['line'] });
    await run({ utm_source: 'other' });
    await run({});
    expect(calls).toEqual([
      '/s/shop/trips/abc?src=line',
      '/s/shop/trips/abc?src=line',
      '/s/shop/trips/abc?src=line',
      '/s/shop/trips/abc',
      '/s/shop/trips/abc',
    ]);
    vi.doUnmock('next/navigation');
  });
});
