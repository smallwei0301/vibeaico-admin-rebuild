import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

import { resolvePublicTripDetailsParams } from '@/lib/public-route-params';

const resolve$ = (shopCode: string, slug: string) =>
  resolvePublicTripDetailsParams(Promise.resolve({ shopCode, slug }));

describe('#11 詳情頁 params 解碼（Next page params 不會自動解碼）', () => {
  beforeEach(() => { notFound.mockClear(); });

  it('頁面透過 loadPublicTripPage（內含 resolvePublicTripDetailsParams）取得解碼值再傳給 client', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/s/[shopCode]/trips/[slug]/page.tsx'), 'utf8');
    const server = readFileSync(resolve(process.cwd(), 'src/server/public-trip-page.ts'), 'utf8');
    expect(server).toContain('await resolvePublicTripDetailsParams(params)');
    expect(page).toContain('await loadPublicTripPage(params)');
    expect(page).toContain('<PublicTripDetailsClient shopCode={props.shopCode} slug={props.slug} />');
  });

  it('編碼的中文 slug 解碼後才傳給 client', async () => {
    expect(await resolve$('demo', '%E9%BE%9C%E5%B1%B1%E5%B3%B6')).toEqual({ shopCode: 'demo', slug: '龜山島' });
  });

  it('ASCII slug 不變', async () => {
    expect(await resolve$('demo', 'guishan-island')).toEqual({ shopCode: 'demo', slug: 'guishan-island' });
  });

  it.each(['%E0%A4%A', '%00', ''])('惡意或空 slug %j → notFound', async (slug) => {
    await expect(resolve$('demo', slug)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
