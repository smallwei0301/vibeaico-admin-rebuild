import { describe, expect, it } from 'vitest';
import { __rateLimitBucketCountForTest, checkRateLimit, peekRateLimit } from '@/server/rate-limit';

const limit = { max: 3, windowMs: 60_000 };

describe('peekRateLimit', () => {
  it('不存在的 key → true，且不建立 bucket', () => {
    const before = __rateLimitBucketCountForTest();
    expect(peekRateLimit(`peek-${Math.random()}`, limit)).toBe(true);
    expect(__rateLimitBucketCountForTest()).toBe(before);
  });

  it('不增加計數：peek 多次後 checkRateLimit 仍可用滿 max 次', () => {
    const key = `peek-${Math.random()}`;
    for (let i = 0; i < 10; i += 1) expect(peekRateLimit(key, limit)).toBe(true);
    for (let i = 0; i < 3; i += 1) expect(checkRateLimit(key, limit)).toBe(true);
    expect(checkRateLimit(key, limit)).toBe(false);
  });

  it('額度用完 → false（與 checkRateLimit 一致），且 peek 不改變狀態', () => {
    const key = `peek-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) checkRateLimit(key, limit);
    const before = __rateLimitBucketCountForTest();
    expect(peekRateLimit(key, limit)).toBe(false);
    expect(peekRateLimit(key, limit)).toBe(false);
    expect(__rateLimitBucketCountForTest()).toBe(before);
    expect(checkRateLimit(key, limit)).toBe(false);
  });

  it('視窗過期 → true', () => {
    const key = `peek-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) checkRateLimit(key, { max: 3, windowMs: 1 });
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait for 1ms window to elapse */ }
    expect(peekRateLimit(key, { max: 3, windowMs: 1 })).toBe(true);
  });
});
