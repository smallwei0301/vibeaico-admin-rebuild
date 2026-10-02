import { beforeEach, describe, expect, it, vi } from 'vitest';

const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
const rate = vi.fn((..._args: unknown[]) => true);
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '1.2.3.4' }) }));
vi.mock('@/server/rate-limit', async () => ({
  checkRateLimit: (...args: unknown[]) => (rate as (...a: unknown[]) => boolean)(...args),
  clientIpFromHeaders: (h: Headers) => h.get('x-forwarded-for') ?? 'unknown-ip',
}));
const loader = vi.fn();
vi.mock('@/server/public-shop', () => ({
  loadPublicTripDetails: (...args: unknown[]) => loader(...args),
}));

import { buildPublicTripMetadata, loadPublicTripPage } from '@/server/public-trip-page';

const plan = { id: 'p1' };
const details = (over: Record<string, unknown> = {}) => ({
  shop: { name: '海島小舖' },
  trip: {
    title: '龜山島賞鯨', tagline: '', summary: '出海看鯨豚', coverImageUrl: 'https://cdn.example.com/c.jpg',
    plans: [plan], rawInternal: 'x', ...over,
  },
});
const p = (shopCode: string, slug: string) => Promise.resolve({ shopCode, slug });

describe('#11 詳情頁 server：404 與 props allowlist', () => {
  beforeEach(() => { notFound.mockClear(); loader.mockReset(); rate.mockReset(); rate.mockReturnValue(true); });

  it('可公開時只回 { shopCode, slug, initialData } 精確 key 集合，slug 已解碼，initialData 即 loader 輸出', async () => {
    const value = details();
    loader.mockResolvedValue(value);
    const props = await loadPublicTripPage(p('demo', '%E9%BE%9C%E5%B1%B1%E5%B3%B6'));
    expect(Object.keys(props).sort()).toEqual(['initialData', 'shopCode', 'slug']);
    expect(props.shopCode).toBe('demo');
    expect(props.slug).toBe('龜山島');
    expect(props.initialData).toBe(value);
    expect(loader).toHaveBeenCalledWith('demo', '龜山島');
  });

  it('已發布但無有效方案 → 不 404，仍回 props 讓頁面顯示無方案文案', async () => {
    loader.mockResolvedValue(details({ plans: [] }));
    const props = await loadPublicTripPage(p('demo', 'x'));
    expect(props.shopCode).toBe('demo');
    expect(notFound).not.toHaveBeenCalled();
  });

  it.each([
    ['店家／行程不存在或未發布', null],
  ])('%s → notFound()', async (_label, value) => {
    loader.mockResolvedValue(value);
    await expect(loadPublicTripPage(p('demo', 'x'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('頁面節流超限：不查 DB、不丟錯、不 notFound，props 不帶 initialData（client 改打 API）', async () => {
    rate.mockReturnValue(false);
    const props = await loadPublicTripPage(p('demo', 'x'));
    expect(props).toEqual({ shopCode: 'demo', slug: 'x' });
    expect(Object.keys(props)).not.toContain('initialData');
    expect(loader).not.toHaveBeenCalled();
    expect(notFound).not.toHaveBeenCalled();
    expect(rate.mock.calls.map((c) => c[0])).toEqual(['public-trip-ip:1.2.3.4']);
  });

  it('shopCode 格式不合 → notFound，且不建立節流 bucket、不查 DB', async () => {
    for (const bad of ['BAD CODE', 'a%2Fb', 'X'.repeat(80), 'UPPER']) {
      await expect(loadPublicTripPage(p(bad, 'x'))).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(rate).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
    expect(await buildPublicTripMetadata(p('BAD CODE', 'x'))).toMatchObject({ title: '行程詳情' });
    expect(rate).not.toHaveBeenCalled();
  });

  it('壞編碼 slug → notFound，且不查詢', async () => {
    await expect(loadPublicTripPage(p('demo', '%00'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('#11 詳情頁 generateMetadata', () => {
  beforeEach(() => { notFound.mockClear(); loader.mockReset(); rate.mockReset(); rate.mockReturnValue(true); });

  it('title＝行程標題＋店名、description 取摘要、og:image 取公開封面', async () => {
    loader.mockResolvedValue(details());
    const m = await buildPublicTripMetadata(p('demo', 'x'));
    expect(m.title).toBe('龜山島賞鯨｜海島小舖');
    expect(m.description).toBe('出海看鯨豚');
    expect(m.openGraph?.title).toBe('龜山島賞鯨｜海島小舖');
    expect(m.openGraph?.images).toEqual(['https://cdn.example.com/c.jpg']);
  });

  it('無有效方案時 metadata 仍使用行程標題', async () => {
    loader.mockResolvedValue(details({ plans: [] }));
    const m = await buildPublicTripMetadata(p('demo', 'x'));
    expect(m.title).toBe('龜山島賞鯨｜海島小舖');
  });

  it('沒有封面時不輸出 og:image；摘要超過 160 字截斷', async () => {
    loader.mockResolvedValue(details({ coverImageUrl: '', summary: '長'.repeat(300) }));
    const m = await buildPublicTripMetadata(p('demo', 'x'));
    expect(m.openGraph).not.toHaveProperty('images');
    expect(Array.from(String(m.description))).toHaveLength(160);
    expect(String(m.description).endsWith('…')).toBe(true);
  });

  it.each([null])('不可公開 → 一般預設值，不洩漏行程資訊，且不加 robots', async (value) => {
    loader.mockResolvedValue(value);
    const m = await buildPublicTripMetadata(p('demo', 'x'));
    expect(m).not.toHaveProperty('robots');
    expect(m).toEqual({ title: '行程詳情', description: '查看行程介紹、可選方案與近期出發資訊。' });
  });

  it('節流超限時 metadata 回預設值、noindex／nofollow 且不查 DB；一般不可公開不加 robots', async () => {
    rate.mockReturnValue(false);
    const m = await buildPublicTripMetadata(p('demo', 'x'));
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.title).toBe('行程詳情');
    expect(loader).not.toHaveBeenCalled();
  });

  it('loader 丟錯 → 預設值（不外洩錯誤）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loader.mockRejectedValue(new Error('PUBLIC_TRIP_DETAILS_QUERY_FAILED:trips'));
    expect(await buildPublicTripMetadata(p('demo', 'x'))).toEqual({
      title: '行程詳情', description: '查看行程介紹、可選方案與近期出發資訊。',
    });
    spy.mockRestore();
  });
});
