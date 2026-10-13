// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown } | 'throw';
let result: Result = { data: null, error: null };

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (result === 'throw') throw new Error('boom');
            return result;
          },
        }),
      }),
    }),
  }),
}));

import { loadPublicShopTimeZone } from '@/server/public-tour-request';

describe('#917 loadPublicShopTimeZone', () => {
  beforeEach(() => { result = { data: null, error: null }; });

  it('讀取 tenant_settings.basic.timezone（陣列或物件形狀皆可）', async () => {
    result = { data: { tenant_settings: [{ basic: { timezone: 'America/Los_Angeles' } }] }, error: null };
    expect(await loadPublicShopTimeZone('shop')).toBe('America/Los_Angeles');
    result = { data: { tenant_settings: { basic: { timezone: 'Europe/London' } } }, error: null };
    expect(await loadPublicShopTimeZone('shop')).toBe('Europe/London');
  });

  it('缺值、無效時區、店家不存在、查詢錯誤、拋例外、shopCode 格式不符一律回退 Asia/Taipei', async () => {
    result = { data: { tenant_settings: [{ basic: {} }] }, error: null };
    expect(await loadPublicShopTimeZone('shop')).toBe('Asia/Taipei');
    result = { data: { tenant_settings: [{ basic: { timezone: 'bad/zone' } }] }, error: null };
    expect(await loadPublicShopTimeZone('shop')).toBe('Asia/Taipei');
    result = { data: null, error: null };
    expect(await loadPublicShopTimeZone('shop')).toBe('Asia/Taipei');
    result = { data: null, error: { message: 'x' } };
    expect(await loadPublicShopTimeZone('shop')).toBe('Asia/Taipei');
    result = 'throw';
    expect(await loadPublicShopTimeZone('shop')).toBe('Asia/Taipei');
    expect(await loadPublicShopTimeZone('BAD CODE!!')).toBe('Asia/Taipei');
  });
});
