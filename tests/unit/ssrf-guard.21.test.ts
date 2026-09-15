/**
 * tests/unit/ssrf-guard.21.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/server/ssrf-guard.ts`（Issue #21）：拒絕 localhost／RFC1918／
 * link-local／IPv6 對應範圍／非 http(s) scheme；redirect 鏈跟隨每一跳都要
 * 重新驗證，解析到私網 IP 的那一跳必須被拒絕；合法公開 HTTPS URL 放行。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isBlockedIp, assertUrlIsFetchable, fetchTextWithSsrfGuard, SsrfBlockedError, MAX_REDIRECTS,
} from '@/server/ssrf-guard';

describe('isBlockedIp（issue #21）', () => {
  it('拒絕 IPv4 loopback / RFC1918 / link-local', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('127.255.255.255')).toBe(true);
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true); // 雲端 metadata endpoint
  });

  it('172.15.x.x / 172.32.x.x 不在 172.16.0.0/12 範圍內，不應被擋', () => {
    expect(isBlockedIp('172.15.0.1')).toBe(false);
    expect(isBlockedIp('172.32.0.1')).toBe(false);
  });

  it('拒絕 IPv6 loopback / link-local / unique-local', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('fd12:3456:789a::1')).toBe(true);
  });

  it('拒絕 IPv4-mapped IPv6 私網位址', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:192.168.1.1')).toBe(true);
  });

  it('接受合法公開 IP', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false);
  });

  it('無法辨識的格式 fail closed', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
});

describe('assertUrlIsFetchable（issue #21）', () => {
  it('拒絕非 http(s) scheme（file://）', async () => {
    await expect(assertUrlIsFetchable(new URL('file:///etc/passwd'))).rejects.toThrow(SsrfBlockedError);
  });

  it('拒絕 DNS 解析出私網 IP 的網域', async () => {
    const lookup = vi.fn(async () => [{ address: '10.0.0.5', family: 4 }]);
    await expect(assertUrlIsFetchable(new URL('https://internal.example'), lookup))
      .rejects.toThrow(SsrfBlockedError);
  });

  it('多址 DNS：只要其中一個位址落在私網就整個拒絕', async () => {
    const lookup = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);
    await expect(assertUrlIsFetchable(new URL('https://mixed.example'), lookup))
      .rejects.toThrow(SsrfBlockedError);
  });

  it('直接填 IP 字面值也要檢查（不需要 DNS 查詢）', async () => {
    const lookup = vi.fn();
    await expect(assertUrlIsFetchable(new URL('http://127.0.0.1/x'), lookup)).rejects.toThrow(SsrfBlockedError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('合法公開網域放行', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    await expect(assertUrlIsFetchable(new URL('https://calendar.example.com/basic.ics'), lookup))
      .resolves.toBeUndefined();
  });

  it('DNS 解析失敗 → 拒絕（fail closed，不是放行）', async () => {
    const lookup = vi.fn(async () => { throw new Error('ENOTFOUND'); });
    await expect(assertUrlIsFetchable(new URL('https://nowhere.invalid'), lookup))
      .rejects.toThrow(SsrfBlockedError);
  });
});

describe('fetchTextWithSsrfGuard（issue #21）', () => {
  it('合法公開 HTTPS URL：解析通過、fetch 成功 → 回傳內容', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const fetchImpl = vi.fn(async () => new Response('BEGIN:VCALENDAR', { status: 200 }));
    const text = await fetchTextWithSsrfGuard('https://calendar.example.com/basic.ics', { lookup, fetchImpl: fetchImpl as any });
    expect(text).toBe('BEGIN:VCALENDAR');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('redirect 鏈：新的 hop 一樣要重新驗證，解析到私網 IP 就整條鏈被拒絕', async () => {
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === 'public.example.com') return [{ address: '93.184.216.34', family: 4 }];
      if (hostname === 'internal.evil.com') return [{ address: '10.0.0.1', family: 4 }];
      throw new Error('unexpected host in test: ' + hostname);
    });
    const fetchImpl = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('public.example.com')) {
        return new Response(null, { status: 302, headers: { location: 'https://internal.evil.com/x.ics' } });
      }
      throw new Error('should not reach internal host');
    });
    await expect(
      fetchTextWithSsrfGuard('https://public.example.com/redirect', { lookup, fetchImpl: fetchImpl as any }),
    ).rejects.toThrow(SsrfBlockedError);
    // 第二個 host 從未真的被 fetch（在驗證階段就被擋下）。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('redirect 到另一個合法公開網址一樣可以正常跟隨', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 301, headers: { location: 'https://public.example.com/final.ics' } });
      return new Response('BEGIN:VCALENDAR', { status: 200 });
    });
    const text = await fetchTextWithSsrfGuard('https://public.example.com/start', { lookup, fetchImpl: fetchImpl as any });
    expect(text).toBe('BEGIN:VCALENDAR');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('redirect 次數超過上限直接拒絕', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://public.example.com/loop' } }));
    await expect(
      fetchTextWithSsrfGuard('https://public.example.com/loop', { lookup, fetchImpl: fetchImpl as any }),
    ).rejects.toThrow(SsrfBlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('非 2xx/3xx 的 HTTP 錯誤照樣被回報（不是靜默吞掉）', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    await expect(
      fetchTextWithSsrfGuard('https://public.example.com/missing.ics', { lookup, fetchImpl: fetchImpl as any }),
    ).rejects.toThrow('HTTP 404');
  });

  it('不合法的 URL 字串直接拒絕', async () => {
    await expect(fetchTextWithSsrfGuard('not a url')).rejects.toThrow(SsrfBlockedError);
  });
});
