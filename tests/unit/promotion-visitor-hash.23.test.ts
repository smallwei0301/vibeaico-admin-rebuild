/**
 * tests/unit/promotion-visitor-hash.23.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/server/promotion-visitor-hash.ts`（Issue #23）。Owner Decision
 * `docs/decisions/2026-09-14-promotion-anonymous-approximate-uv.md` 明文要求：
 * 同日同輸入同 hash、跨日 salt 改變則 hash 改變、且這一層完全不碰原始 IP 的
 * 持久化或 log。這三條都是這份測試要直接證明的，不是靠讀程式碼相信。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classifyUserAgent,
  computeVisitorHash,
  dailySalt,
  taipeiDateKey,
} from '@/server/promotion-visitor-hash';

describe('taipeiDateKey（issue #23）', () => {
  it('把 UTC 時間換算成台北曆日字串（+8 小時）', () => {
    // UTC 2026-09-14 20:00 → 台北 2026-09-15 04:00
    expect(taipeiDateKey(new Date('2026-09-14T20:00:00Z'))).toBe('2026-09-15');
    // UTC 2026-09-14 10:00 → 台北 2026-09-14 18:00（同一個台北曆日）
    expect(taipeiDateKey(new Date('2026-09-14T10:00:00Z'))).toBe('2026-09-14');
  });
});

describe('classifyUserAgent（issue #23：只存低敏分類桶，不存原始 UA）', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'MOBILE'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'MOBILE'],
    ['Mozilla/5.0 (Linux; U; Android 12) Line/13.0', 'MOBILE'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'DESKTOP'],
    ['Macintosh; Intel Mac OS X 10_15 Safari/605', 'DESKTOP'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'BOT'],
    ['facebookexternalhit/1.1', 'BOT'],
    ['', 'OTHER'],
    [undefined, 'OTHER'],
    [null, 'OTHER'],
  ])('%s → %s', (ua, expected) => {
    expect(classifyUserAgent(ua as string | null | undefined)).toBe(expected);
  });
});

describe('dailySalt（issue #23：每日輪替）', () => {
  it('同一天同一組密鑰 → 相同 salt；不同天 → 不同 salt', () => {
    const a1 = dailySalt('secret-a', '2026-09-14');
    const a2 = dailySalt('secret-a', '2026-09-14');
    const a3 = dailySalt('secret-a', '2026-09-15');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(a3);
  });

  it('不同密鑰即使同一天也算出不同 salt（避免密鑰洩漏時可預測）', () => {
    expect(dailySalt('secret-a', '2026-09-14')).not.toBe(dailySalt('secret-b', '2026-09-14'));
  });
});

describe('computeVisitorHash（issue #23 acceptance：daily-rotating salt determinism）', () => {
  const secret = 'test-secret-not-real';

  it('同一天 ＋ 同一組 (ip, userAgent) → 同一個 hash', () => {
    const input = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 Chrome/120', dateKey: '2026-09-14', secret };
    expect(computeVisitorHash(input)).toBe(computeVisitorHash({ ...input }));
  });

  it('同一天，同一支手機（同 IP／UA）造訪三次 → 三個 hash 完全相同（PV=3 時 UV 應可正確去重成 1）', () => {
    const input = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 iPhone', dateKey: '2026-09-14', secret };
    const hashes = new Set([computeVisitorHash(input), computeVisitorHash(input), computeVisitorHash(input)]);
    expect(hashes.size).toBe(1);
  });

  it('不同 IP → 不同 hash（同一天、同 UA）', () => {
    const base = { userAgent: 'Mozilla/5.0 Chrome/120', dateKey: '2026-09-14', secret };
    expect(computeVisitorHash({ ...base, ip: '203.0.113.7' }))
      .not.toBe(computeVisitorHash({ ...base, ip: '203.0.113.8' }));
  });

  it('跨日：即使 ip/userAgent 完全相同，dateKey 不同 → hash 不同（近似 UV 的來源，Owner Decision 已接受此誤差）', () => {
    const base = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 Chrome/120', secret };
    const day1 = computeVisitorHash({ ...base, dateKey: '2026-09-14' });
    const day2 = computeVisitorHash({ ...base, dateKey: '2026-09-15' });
    expect(day1).not.toBe(day2);
  });

  it('回傳值是 64 字元 hex（sha256 digest），不可能是原始 IP 或其明文變形', () => {
    const hash = computeVisitorHash({ ip: '198.51.100.23', userAgent: 'ua', dateKey: '2026-09-14', secret });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('198.51.100.23');
  });

  it('計算過程完全不呼叫 console.*，不可能意外把原始 IP 印進 log', () => {
    const spies = ['log', 'error', 'warn', 'info', 'debug'].map((m) =>
      vi.spyOn(console, m as 'log').mockImplementation(() => {}),
    );
    try {
      computeVisitorHash({ ip: '198.51.100.99', userAgent: 'ua', dateKey: '2026-09-14', secret });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
