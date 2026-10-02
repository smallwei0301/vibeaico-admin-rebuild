import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTripCarousel, type TripCardSource } from '@/server/trip-flex';

const permanentRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  permanentRedirect: (...args: unknown[]) => permanentRedirect(...args),
}));

import LegacyTripRedirectPage from '@/app/s/[shopCode]/trip/[slug]/page';

const LABELS = { altText: 'x', priceFrom: '最低', priceUnknown: '價格洽詢', bookCta: '我要預約' };
const source = (slug: string): TripCardSource => ({
  slug, title: 't', tagline: '', summary: '', coverImageUrl: '', minPrice: 100,
});

describe('#11 LINE 行程連結 /trip/{slug} 相容轉址', () => {
  beforeEach(() => permanentRedirect.mockClear());

  it.each(['guishan-island', '龜山島 一日遊'])('slug=%s 永久轉址到 /trips/{encoded slug}', async (slug) => {
    await LegacyTripRedirectPage({ params: Promise.resolve({ shopCode: 'demo', slug }) });
    expect(permanentRedirect).toHaveBeenCalledTimes(1);
    expect(permanentRedirect).toHaveBeenCalledWith(`/s/demo/trips/${encodeURIComponent(slug)}`);
  });

  it('不雙重編碼：params 為解碼後的值，轉址只編碼一次', async () => {
    await LegacyTripRedirectPage({ params: Promise.resolve({ shopCode: 'a b', slug: '龜山島 一日遊' }) });
    const target = permanentRedirect.mock.calls[0][0] as string;
    expect(target).toBe(`/s/${encodeURIComponent('a b')}/trips/${encodeURIComponent('龜山島 一日遊')}`);
    expect(target).not.toContain('%25');
  });

  it('trip-flex 產生的 CTA 路徑正好符合本相容路由 /s/[shopCode]/trip/[slug]', async () => {
    const slug = '龜山島 一日遊';
    const carousel = buildTripCarousel([source(slug)], 'https://example.com/s/demo', LABELS) as any;
    const uri: string = carousel.contents.contents[0].footer.contents[0].action.uri;
    const m = new URL(uri).pathname.match(/^\/s\/([^/]+)\/trip\/([^/]+)$/);
    expect(m).not.toBeNull();
    await LegacyTripRedirectPage({
      params: Promise.resolve({ shopCode: decodeURIComponent(m![1]), slug: decodeURIComponent(m![2]) }),
    });
    expect(permanentRedirect).toHaveBeenCalledWith(`/s/demo/trips/${encodeURIComponent(slug)}`);
  });
});
