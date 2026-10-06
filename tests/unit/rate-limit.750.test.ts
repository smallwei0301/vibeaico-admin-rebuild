/**
 * tests/unit/rate-limit.750.test.ts — issue #750：clientIpFromHeaders 只採信平台附加的 IP。
 * 偽造的最左 x-forwarded-for 片段不得改變節流 bucket key。
 */
import { describe, expect, it } from 'vitest';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';

const h = (init: Record<string, string>) => new Headers(init);

describe('clientIpFromHeaders（issue #750）', () => {
  it('偽造的最左 XFF 片段不影響結果：取最右（平台附加）', () => {
    const a = clientIpFromHeaders(h({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }));
    const b = clientIpFromHeaders(h({ 'x-forwarded-for': '2.2.2.2, 203.0.113.9' }));
    expect(a).toBe('203.0.113.9');
    expect(b).toBe(a);
  });

  it('多層 XFF 取最右非空片段', () => {
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('x-vercel-forwarded-for 優先於偽造的 XFF 與 x-real-ip', () => {
    const ip = clientIpFromHeaders(
      h({
        'x-vercel-forwarded-for': '203.0.113.7',
        'x-real-ip': '6.6.6.6',
        'x-forwarded-for': '7.7.7.7, 5.5.5.5',
      }),
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('x-real-ip 優先於 x-forwarded-for', () => {
    expect(clientIpFromHeaders(h({ 'x-real-ip': ' 203.0.113.8 ', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.8');
  });

  it('空白與空片段被略過', () => {
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '1.1.1.1, 203.0.113.4, , ' }))).toBe('203.0.113.4');
    expect(clientIpFromHeaders(h({ 'x-vercel-forwarded-for': '  ', 'x-forwarded-for': '203.0.113.3' }))).toBe('203.0.113.3');
  });

  it('沒有任何標頭 → unknown-ip', () => {
    expect(clientIpFromHeaders(h({}))).toBe('unknown-ip');
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': ' , ' }))).toBe('unknown-ip');
  });

  it('輪換偽造的最左 XFF 仍落在同一個 bucket，被節流', () => {
    const base = `203.0.113.${Math.floor(Math.random() * 200)}`;
    const opts = { max: 3, windowMs: 60_000 };
    const results: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const ip = clientIpFromHeaders(h({ 'x-forwarded-for': `10.0.0.${i}, ${base}` }));
      results.push(checkRateLimit(`t750:${ip}`, opts));
    }
    expect(results).toEqual([true, true, true, false, false]);
  });
});
