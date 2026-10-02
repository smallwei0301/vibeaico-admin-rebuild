import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTripCarousel, type TripCardSource } from '@/server/trip-flex';

const permanentRedirect = vi.fn();
const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({
  permanentRedirect: (...args: unknown[]) => permanentRedirect(...args),
  notFound: () => notFound(),
}));

import LegacyTripRedirectPage from '@/app/s/[shopCode]/trip/[slug]/page';

const LABELS = { altText: 'x', priceFrom: '最低', priceUnknown: '價格洽詢', bookCta: '我要預約' };
const source = (slug: string): TripCardSource => ({
  slug, title: 't', tagline: '', summary: '', coverImageUrl: '', minPrice: 100,
});

describe('#11 LINE 行程連結 /trip/{slug} 相容轉址', () => {
  beforeEach(() => { permanentRedirect.mockClear(); notFound.mockClear(); });

  // Next 15 的 page params 不會 URL 解碼：mock 必須給「未解碼」的編碼字串。
  it.each([
    ['guishan-island', 'guishan-island'],
    ['%E9%BE%9C%E5%B1%B1%E5%B3%B6', '%E9%BE%9C%E5%B1%B1%E5%B3%B6'],
    ['%E9%BE%9C%20x', '%E9%BE%9C%20x'],
  ])('slug=%s 永久轉址到 /trips/{只編碼一次}', async (rawSlug, expectedSeg) => {
    await LegacyTripRedirectPage({ params: Promise.resolve({ shopCode: 'demo', slug: rawSlug }) });
    expect(permanentRedirect).toHaveBeenCalledTimes(1);
    const target = permanentRedirect.mock.calls[0][0] as string;
    expect(target).toBe(`/s/demo/trips/${expectedSeg}`);
    expect(target).not.toContain('%25');
  });

  it.each(['%E0%A4%A', '%00', '%0A', ''])(
    '惡意或空 slug %j → notFound、不轉址',
    async (rawSlug) => {
      await expect(
        LegacyTripRedirectPage({ params: Promise.resolve({ shopCode: 'demo', slug: rawSlug }) }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
      expect(permanentRedirect).not.toHaveBeenCalled();
    },
  );

  it('shopCode 不符 SHOP_CODE_PATTERN 或解碼失敗 → notFound', async () => {
    for (const shopCode of ['a%20b', '%E0%A4%A', 'DEMO']) {
      await expect(
        LegacyTripRedirectPage({ params: Promise.resolve({ shopCode, slug: 'x' }) }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('trip-flex 產生的 CTA 路徑正好符合本相容路由 /s/[shopCode]/trip/[slug]', async () => {
    const slug = '龜山島 一日遊';
    const carousel = buildTripCarousel([source(slug)], 'https://example.com/s/demo', LABELS) as any;
    const uri: string = carousel.contents.contents[0].footer.contents[0].action.uri;
    const m = new URL(uri).pathname.match(/^\/s\/([^/]+)\/trip\/([^/]+)$/);
    expect(m).not.toBeNull();
    await LegacyTripRedirectPage({
      params: Promise.resolve({ shopCode: m![1], slug: m![2] }),
    });
    expect(permanentRedirect).toHaveBeenCalledWith(`/s/demo/trips/${encodeURIComponent(slug)}`);
  });
});
