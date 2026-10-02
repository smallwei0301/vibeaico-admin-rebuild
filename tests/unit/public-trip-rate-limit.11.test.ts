import { beforeEach, describe, expect, it, vi } from 'vitest';

const loader = vi.fn();
vi.mock('@/server/public-cors', () => ({
  publicCorsHeaders: () => ({ 'X-Test-Cors': '1' }),
  publicCorsPreflightResponse: () => new Response(null, { status: 204 }),
}));
vi.mock('@/server/public-shop', () => ({
  loadPublicTripDetails: (...args: unknown[]) => loader(...args),
}));

import { GET } from '@/app/api/public/shops/[shopCode]/trips/[slug]/route';
import { consumePublicTripRateLimit } from '@/server/public-trip-rate-limit';
import { __rateLimitBucketCountForTest } from '@/server/rate-limit';

let ipCounter = 0;
const nextIp = () => `10.11.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
const call = (ip: string, shopCode: string, slug = 'hike') =>
  GET(
    new Request('http://localhost/api/public/shops/x/trips/y', { headers: { 'x-forwarded-for': ip } }),
    { params: Promise.resolve({ shopCode, slug }) },
  ) as Promise<Response>;

describe('#11 公開行程詳情節流（API 與頁面共用規則）', () => {
  beforeEach(() => { loader.mockReset(); loader.mockResolvedValue(null); });

  it('格式不合的 shopCode：404、不查 DB、不消耗任何節流額度（不建立 bucket）', async () => {
    const ip = nextIp();
    for (let i = 0; i < 400; i += 1) {
      const res = await call(ip, `Bad Code ${i}`);
      expect(res.status).toBe(404);
    }
    expect(loader).not.toHaveBeenCalled();
    // D6：格式不合的 404 也要帶 CORS header。
    expect((await call(ip, 'Bad Code')).headers.get('X-Test-Cors')).toBe('1');
    // 400 次隨機店碼後，同一 IP 的合法請求仍在額度內（來源級 bucket 沒被消耗）。
    const ok = await call(ip, 'demo');
    expect(ok.status).toBe(404); // loader 回 null → 找不到，但不是 429
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('同一 IP 換多個合法店碼：總量受來源級 300 次上限限制，之後回 429 且不查 DB', async () => {
    const ip = nextIp();
    let limited = 0;
    for (let i = 0; i < 320; i += 1) {
      const res = await call(ip, `shop-${i}`);
      if (res.status === 429) limited += 1;
    }
    expect(loader).toHaveBeenCalledTimes(300);
    expect(limited).toBe(20);
  });

  it('店家級上限仍然有效：同 IP 同店 61 次 → 第 61 次被擋', async () => {
    const ip = nextIp();
    for (let i = 0; i < 60; i += 1) expect(consumePublicTripRateLimit('api', ip, 'one')).toBe(true);
    expect(consumePublicTripRateLimit('api', ip, 'one')).toBe(false);
    // 頁面前綴獨立計數，但仍共用來源級額度。
    expect(consumePublicTripRateLimit('page', ip, 'one')).toBe(true);
  });

  it('同一 IP 用 1000 個隨機合法店碼：超過 300 次後不再新增 bucket', async () => {
    const ip = nextIp();
    const before = __rateLimitBucketCountForTest();
    let allowed = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (consumePublicTripRateLimit('api', ip, `rand-${i}`)) allowed += 1;
    }
    expect(allowed).toBe(300);
    const afterThreshold = __rateLimitBucketCountForTest();
    // 300 個店家級 bucket ＋ 1 個來源級 bucket；其餘 700 次被擋，不得再建 bucket。
    expect(afterThreshold - before).toBe(301);
    for (let i = 1000; i < 1100; i += 1) consumePublicTripRateLimit('api', ip, `rand-${i}`);
    expect(__rateLimitBucketCountForTest()).toBe(afterThreshold);
  });

  it('同一 IP 對同一家店打 100 次被擋後，換別家店仍可通過（CGNAT 情境）', () => {
    const ip = nextIp();
    for (let i = 0; i < 100; i += 1) consumePublicTripRateLimit('api', ip, 'busy-shop');
    expect(consumePublicTripRateLimit('api', ip, 'another-shop')).toBe(true);
  });

  it('同一 IP 對同一家店刷新被店家級擋下時，不會扣光來源級額度：換其他合法店家仍可通過', async () => {
    const ip = nextIp();
    for (let i = 0; i < 400; i += 1) consumePublicTripRateLimit('api', ip, 'busy');
    expect(consumePublicTripRateLimit('api', ip, 'other-shop')).toBe(true);
  });

  it('不同 IP 互不影響', async () => {
    const a = nextIp();
    const b = nextIp();
    for (let i = 0; i < 61; i += 1) consumePublicTripRateLimit('api', a, 'one');
    expect(consumePublicTripRateLimit('api', b, 'one')).toBe(true);
  });
});
