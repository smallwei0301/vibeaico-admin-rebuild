/**
 * tests/unit/rate-limit.46.test.ts — Final Risk F1 節流層的最小驗證。
 * `src/server/rate-limit.ts` 是全站第一個節流實作，補在
 * `POST /api/public/tour-requests`（issue #46 唯一的匿名寫入端點）前面。
 */
import { describe, expect, it } from 'vitest';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';

describe('checkRateLimit', () => {
  it('額度內的呼叫都通過', () => {
    const key = `test-key-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimit(key, { max: 5, windowMs: 60_000 })).toBe(true);
    }
  });

  it('超過額度的呼叫回 false', () => {
    const key = `test-key-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) checkRateLimit(key, { max: 3, windowMs: 60_000 });
    expect(checkRateLimit(key, { max: 3, windowMs: 60_000 })).toBe(false);
  });

  it('不同 key 互不影響', () => {
    const keyA = `test-key-a-${Math.random()}`;
    const keyB = `test-key-b-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) checkRateLimit(keyA, { max: 3, windowMs: 60_000 });
    expect(checkRateLimit(keyA, { max: 3, windowMs: 60_000 })).toBe(false);
    expect(checkRateLimit(keyB, { max: 3, windowMs: 60_000 })).toBe(true);
  });
});

describe('clientIpFromHeaders', () => {
  it('優先取 x-forwarded-for 的第一段', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(clientIpFromHeaders(headers)).toBe('1.2.3.4');
  });

  it('沒有 x-forwarded-for 時退回 x-real-ip', () => {
    const headers = new Headers({ 'x-real-ip': '9.9.9.9' });
    expect(clientIpFromHeaders(headers)).toBe('9.9.9.9');
  });

  it('兩者都沒有時退回固定字串，不拋例外', () => {
    const headers = new Headers();
    expect(clientIpFromHeaders(headers)).toBe('unknown-ip');
  });
});
