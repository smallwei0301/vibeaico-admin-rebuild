import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __rateLimitBucketCountForTest, checkRateLimit } from '@/server/rate-limit';

const SHORT = { max: 2, windowMs: 10 * 60 * 1000 };
const LONG = { max: 2, windowMs: 60 * 60 * 1000 };
const MIN = 60 * 1000;

describe('rate-limit cleanup 依各 bucket 自身視窗過期（#957）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 跳到遠未來，確保第一次呼叫就會觸發 cleanup（距 lastCleanupAt 已逾 5 分鐘）。
    vi.setSystemTime(Date.now() + 1000 * 60 * MIN);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1 小時 bucket 不會被 10 分鐘視窗呼叫者的 cleanup 提前清掉', () => {
    const longKey = `long-${Math.random()}`;
    const shortKey = `short-${Math.random()}`;
    checkRateLimit('warmup-' + Math.random(), SHORT); // 觸發並重設 cleanup 計時
    expect(checkRateLimit(longKey, LONG)).toBe(true);
    expect(checkRateLimit(longKey, LONG)).toBe(true);
    expect(checkRateLimit(longKey, LONG)).toBe(false);
    expect(checkRateLimit(shortKey, SHORT)).toBe(true);

    vi.advanceTimersByTime(11 * MIN);
    // 10 分鐘視窗的呼叫觸發 cleanup；1 小時 bucket 仍應擋住。
    expect(checkRateLimit(`trigger-${Math.random()}`, SHORT)).toBe(true);
    expect(checkRateLimit(longKey, LONG)).toBe(false);

    vi.advanceTimersByTime(50 * MIN); // 累計 61 分鐘
    expect(checkRateLimit(longKey, LONG)).toBe(true);
  });

  it('10 分鐘 bucket 仍在 10 分鐘後過期並被清掉', () => {
    const shortKey = `short-${Math.random()}`;
    checkRateLimit('warmup-' + Math.random(), SHORT);
    checkRateLimit(shortKey, SHORT);
    checkRateLimit(shortKey, SHORT);
    expect(checkRateLimit(shortKey, SHORT)).toBe(false);
    const before = __rateLimitBucketCountForTest();

    vi.advanceTimersByTime(11 * MIN);
    expect(checkRateLimit(shortKey, SHORT)).toBe(true);
    expect(__rateLimitBucketCountForTest()).toBeLessThanOrEqual(before);
  });
});
