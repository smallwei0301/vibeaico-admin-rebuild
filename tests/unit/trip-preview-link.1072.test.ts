import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPublicBookingUrl, buildPublicTripUrl } from '@/config/tenant-settings';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';

const src = readFileSync(resolve(__dirname, '../../src/app/tenant/trips/[id]/page.tsx'), 'utf8');

describe('issue #1072 行程預覽連結', () => {
  it('helper：base 去尾斜線並 encode shopCode/slug', () => {
    expect(buildPublicTripUrl('https://x.com/', 'shop', 'a-b')).toBe('https://x.com/s/shop/trips/a-b');
    expect(buildPublicTripUrl('https://x.com', 'sh op', 'a/b?c#d 中')).toBe(
      `https://x.com/s/sh%20op/trips/${encodeURIComponent('a/b?c#d 中')}`,
    );
    expect(
      buildPublicTripUrl('https://x.com/', 'shop', 's').startsWith(buildPublicBookingUrl('https://x.com/', 'shop')),
    ).toBe(true);
  });

  it('頁面：已發佈且有已儲存 slug → 行程頁；否則店家首頁＋提示', () => {
    expect(src).toContain("trip?.status === 'PUBLISHED'");
    expect(src).toContain('buildPublicTripUrl(APP_URL, currentTenant.shopCode, savedSlug)');
    expect(src).toContain('trip?.slug');
    expect(src).not.toMatch(/buildPublicTripUrl\([^)]*form\.slug/);
    expect(src).toContain('href={previewUrl}');
    expect(src).toContain('t.plans.quick.previewUnpublishedHint');
    expect(tripsPage.plans.quick.previewUnpublishedHint).toBe('發佈後才能預覽此行程的公開頁');
  });
});
