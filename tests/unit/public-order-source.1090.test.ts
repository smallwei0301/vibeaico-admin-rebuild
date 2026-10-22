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
  it('line-events 產生的公開連結皆經 withLineSource', () => {
    const src = readFileSync('src/server/line-events.ts', 'utf8');
    expect(src).toContain('withLineSource(buildShopUrl(appUrl, shopCode))');
    expect(src).toContain('withLineSource(`${buildShopUrl(APP_URL, ctx.tenant.shop_code)}/plans/');
    // 不得再有未經包裝直接使用原始 helper 的呼叫
    expect(src.match(/buildShopUrl\(/g)?.length).toBe(2);
  });
  it('公開建單 server 不再寫死 p_source: LINE', () => {
    for (const f of ['src/server/public-tour-request.ts', 'src/server/public-tour-booking.ts']) {
      const s = readFileSync(f, 'utf8');
      expect(s).not.toMatch(/p_source:\s*'LINE'/);
      expect(s).toContain('p_source: resolvePublicOrderSource(input.channel)');
    }
  });
});
